.pragma library
.import "Format.js" as Format
.import "Series.js" as Series

// Portfolio math over the plugin's own daily snapshots, the live summary and
// the synced order history: the graph series, the daily change, allocation
// and performance breakdowns.
//
// Performance is measured on *return* (unrealized + realized P/L), never on
// raw value: buying, selling, depositing and card spending all move value
// without being a gain or loss, and a value-based graph reads a sell-off
// into cash as a crash.

var toNumber = Format.toNumber
var DAY_MS = 86400000

var METRICS = ["account", "return", "value"]
var RANGES = ["1W", "1M", "3M", "YTD", "1Y", "ALL"]

// Return is the default: it has meaningful history from the first day,
// while the account total only accrues once the pot is being recorded.
function normalizeMetric(metric) {
  return METRICS.indexOf(String(metric)) === -1 ? "return" : String(metric)
}

function normalizeRange(range) {
  return RANGES.indexOf(String(range)) === -1 ? "1M" : String(range)
}

function metricTitle(metric) {
  var m = normalizeMetric(metric)
  if (m === "account") return "Account value"
  if (m === "return") return "Total return"
  return "Investments"
}

function optionalNumber(value) {
  return value === undefined || value === null || !isFinite(Number(value)) ? null : Number(value)
}

// ---- Snapshot history. JSONL, one line per day; bad lines are skipped,
//      duplicate dates keep the last write, output ascends by time with
//      millisecond timestamps. Lines written before a field existed come
//      back with that field null, and consumers decide how to fall back.
function parseHistory(raw) {
  var lines = String(raw || "").split("\n")
  var byDate = {}
  var dates = []
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim()
    if (line === "") continue
    var entry
    try {
      entry = JSON.parse(line)
    } catch (error) {
      continue
    }
    if (!entry || typeof entry !== "object") continue
    var value = Number(entry.value)
    var date = String(entry.date || "")
    if (!isFinite(value) || date === "") continue
    var ts = Number(entry.ts)
    var cash = toNumber(entry.cash, 0)
    var pot = optionalNumber(entry.pot)
    if (byDate[date] === undefined) dates.push(date)
    byDate[date] = {
      date: date,
      ts: isFinite(ts) && ts > 0 ? ts * 1000 : Date.parse(date),
      value: value,
      // Lines written before the open field existed fall back to the
      // day's (latest) value — a one-day approximation on upgrade.
      open: toNumber(entry.open, value),
      invested: toNumber(entry.invested, 0),
      pl: toNumber(entry.pl, 0),
      realized: optionalNumber(entry.realized),
      cash: cash,
      pot: pot,
      // Before the pot was recorded the total is unknown, not value+cash:
      // treating it as known would draw every pot transfer as a swing.
      total: pot === null ? null : toNumber(entry.total, value + cash + pot),
      openReturn: optionalNumber(entry.openReturn),
      openTotal: optionalNumber(entry.openTotal)
    }
  }
  var out = []
  for (var j = 0; j < dates.length; j++) out.push(byDate[dates[j]])
  out.sort(function(a, b) { return a.ts - b.ts })
  return out
}

function entryForDate(history, date) {
  for (var i = history.length - 1; i >= 0; i--)
    if (history[i].date === date) return history[i]
  return null
}

function returnOf(data) {
  return toNumber(data.pl, 0) + toNumber(data.realized, 0)
}

// One JSONL line per day. The `open*` fields are the day's first reading,
// carried forward as the line is replaced through the day; the rest end up
// as the day's close.
function snapshotLine(dateString, timestampMs, data, todayEntry) {
  var liveReturn = returnOf(data)
  var open = todayEntry ? todayEntry.open : data.value
  var openReturn = todayEntry && todayEntry.openReturn !== null ? todayEntry.openReturn : liveReturn
  var openTotal = todayEntry && todayEntry.openTotal !== null ? todayEntry.openTotal : data.total
  return JSON.stringify({
    date: dateString,
    ts: Math.round(timestampMs / 1000),
    currency: data.currency,
    open: Format.round2(open),
    invested: Format.round2(data.invested),
    value: Format.round2(data.value),
    pl: Format.round2(data.pl),
    realized: Format.round2(data.realized),
    cash: Format.round2(data.cash),
    pot: Format.round2(data.pot),
    total: Format.round2(data.total),
    openReturn: Format.round2(openReturn),
    openTotal: Format.round2(openTotal)
  })
}

// ---- Realized P/L over time, rebuilt from order fills. Snapshots written
//      before `realized` was recorded get their value from here, so the
//      return series covers the whole history. `offset` absorbs anything
//      realized before the synced order history begins, anchoring the
//      timeline to the live summary.
function realizedTimeline(orders, liveRealized) {
  var fills = []
  for (var i = 0; i < orders.length; i++) {
    var o = orders[i]
    if (o.filled && o.realized !== null && o.realized !== undefined && o.time > 0)
      fills.push({ ts: o.time, amount: Number(o.realized) })
  }
  if (fills.length === 0) return null
  fills.sort(function(a, b) { return a.ts - b.ts })
  var steps = []
  var cum = 0
  for (var j = 0; j < fills.length; j++) {
    cum += fills[j].amount
    steps.push({ ts: fills[j].ts, cum: cum })
  }
  var live = optionalNumber(liveRealized)
  return { steps: steps, offset: live === null ? 0 : live - cum }
}

function realizedAt(timeline, ts) {
  if (!timeline) return null
  var cum = 0
  for (var i = 0; i < timeline.steps.length; i++) {
    if (timeline.steps[i].ts > ts) break
    cum = timeline.steps[i].cum
  }
  return cum + timeline.offset
}

function entryReturn(entry, timeline) {
  if (entry.realized !== null) return entry.pl + entry.realized
  var realized = realizedAt(timeline, entry.ts)
  return realized === null ? null : entry.pl + realized
}

function metricOf(entry, metric, timeline) {
  if (metric === "return") return entryReturn(entry, timeline)
  if (metric === "account") return entry.total
  return entry.value
}

function rangeStart(range, nowMs) {
  var r = normalizeRange(range)
  if (r === "ALL") return -Infinity
  if (r === "YTD") return new Date(new Date(nowMs).getFullYear(), 0, 1).getTime()
  var days = r === "1W" ? 7 : r === "1M" ? 30 : r === "3M" ? 91 : 365
  return nowMs - days * DAY_MS
}

// Chart-ready series for one metric over one range: daily snapshots plus a
// trailing live point, so the graph moves intraday and works from day one.
function series(history, live, nowMs, metric, range, timeline) {
  var m = normalizeMetric(metric)
  var start = rangeStart(range, nowMs)
  var today = Format.localDate(nowMs)
  var points = []
  for (var i = 0; i < history.length; i++) {
    var e = history[i]
    // Today's line is superseded by the live point.
    if (e.ts < start || (live && e.date === today)) continue
    var v = metricOf(e, m, timeline)
    if (v !== null) points.push({ ts: e.ts, value: v, date: e.date })
  }
  if (live) {
    var liveValue = m === "return" ? returnOf(live) : m === "account" ? live.total : live.value
    points.push({ ts: nowMs, value: liveValue, date: "" })
  }
  // A change in return has no natural denominator; the value metrics do.
  var out = Series.fromPoints(points, m !== "return")
  out.metric = m
  return out
}

// Money outside investments (spending pot + trading cash) over time: the
// snapshots that recorded the pot, then the live reading in place of today.
function potSeries(history, live, nowMs) {
  var today = Format.localDate(nowMs)
  var points = []
  for (var i = 0; i < history.length; i++) {
    var e = history[i]
    if (e.pot !== null && !(live && e.date === today)) points.push({ ts: e.ts, value: e.pot + e.cash, date: e.date })
  }
  if (live) points.push({ ts: nowMs, value: live.pot + live.cash, date: "" })
  return Series.fromPoints(points, false)
}

// The account total split into investments / spending pot / cash, as
// allocation groups. Parts below a cent are left out.
function composition(summary) {
  if (!summary || !(summary.total > 0)) return []
  var parts = [
    { key: "Investments", value: summary.value },
    { key: "Spending pot", value: summary.pot },
    { key: "Cash", value: summary.cash }
  ]
  var out = []
  for (var i = 0; i < parts.length; i++)
    if (parts[i].value > 0.005) out.push({ key: parts[i].key, value: parts[i].value, weight: parts[i].value / summary.total * 100 })
  return out
}

// ---- Daily change: live return against the previous day's closing
//      return, as a percentage of that day's closing investment value.
//      With no prior day on record (install day) the baseline falls back to
//      today's opening return. `account` is the plain total-value change
//      (spending and transfers included) when both ends are known.
function dailyChange(history, live, todayDate, timeline) {
  if (!live) return null
  var liveReturn = returnOf(live)
  var todayEntry = null
  for (var i = history.length - 1; i >= 0; i--) {
    var e = history[i]
    if (e.date === todayDate) {
      todayEntry = e
      continue
    }
    if (e.date > todayDate) continue
    var base = entryReturn(e, timeline)
    // No realized figure for that day at all: assume nothing was sold
    // since, which is exact unless a sale happened today.
    if (base === null) base = e.pl + toNumber(live.realized, 0)
    var abs = liveReturn - base
    return {
      abs: abs,
      pct: e.value > 0 ? (abs / e.value) * 100 : null,
      sinceOpen: false,
      account: e.total === null ? null : live.total - e.total
    }
  }
  if (todayEntry && todayEntry.openReturn !== null) {
    var fromOpen = liveReturn - todayEntry.openReturn
    return {
      abs: fromOpen,
      pct: todayEntry.open > 0 ? (fromOpen / todayEntry.open) * 100 : null,
      sinceOpen: true,
      account: todayEntry.openTotal === null ? null : live.total - todayEntry.openTotal
    }
  }
  return null
}

// ---- Allocation. Groups positions by `keyFn`, largest first, each with
//      its weight of the grouped total.
function allocation(positions, keyFn) {
  var groups = {}
  var order = []
  var total = 0
  for (var i = 0; i < positions.length; i++) {
    var p = positions[i]
    var key = String(keyFn(p) || "Other")
    if (groups[key] === undefined) {
      groups[key] = { key: key, value: 0, count: 0 }
      order.push(key)
    }
    groups[key].value += p.value
    groups[key].count += 1
    total += p.value
  }
  var out = []
  for (var j = 0; j < order.length; j++) {
    var g = groups[order[j]]
    g.weight = total > 0 ? (g.value / total) * 100 : 0
    out.push(g)
  }
  out.sort(function(a, b) { return b.value - a.value })
  return out
}

// Collapses the tail of an allocation into "Other" so bars stay legible.
function topGroups(groups, limit) {
  if (groups.length <= limit) return groups
  var head = groups.slice(0, limit - 1)
  var rest = { key: "Other", value: 0, count: 0, weight: 0 }
  for (var i = limit - 1; i < groups.length; i++) {
    rest.value += groups[i].value
    rest.count += groups[i].count
    rest.weight += groups[i].weight
  }
  head.push(rest)
  return head
}

function weightOf(position, positions) {
  var total = 0
  for (var i = 0; i < positions.length; i++) total += positions[i].value
  return total > 0 ? (position.value / total) * 100 : 0
}

// Top-1 / top-3 / top-5 weights — a quick read on concentration risk.
function concentration(positions) {
  var groups = allocation(positions, function(p) { return p.rawTicker || p.ticker })
  function top(n) {
    var sum = 0
    for (var i = 0; i < Math.min(n, groups.length); i++) sum += groups[i].weight
    return sum
  }
  return { count: groups.length, top1: top(1), top3: top(3), top5: top(5) }
}

// ---- Today's movers from market quotes. `quoteFor(position)` returns a
//      quote with `changePct` (or null). The account-currency move is
//      backed out of the current value: value × pct / (100 + pct).
function movers(positions, quoteFor) {
  var out = []
  for (var i = 0; i < positions.length; i++) {
    var p = positions[i]
    var q = quoteFor(p)
    if (!q || q.changePct === null || q.changePct === undefined) continue
    var pct = Number(q.changePct)
    out.push({
      ticker: p.ticker,
      rawTicker: p.rawTicker,
      name: p.name,
      pct: pct,
      abs: 100 + pct !== 0 ? p.value * pct / (100 + pct) : 0
    })
  }
  out.sort(function(a, b) { return b.pct - a.pct })
  return out
}

// Headline performance breakdown. Every component is in the account
// currency; `gain` is what the account earned all-in.
function performance(summary, dividendsTotal, feesTotal) {
  if (!summary) return null
  var dividends = toNumber(dividendsTotal, 0)
  var gain = summary.pl + summary.realized + dividends
  return {
    unrealized: summary.pl,
    realized: summary.realized,
    dividends: dividends,
    fees: toNumber(feesTotal, 0),
    gain: gain
  }
}

// Sort orders for the holdings list.
var SORTS = ["value", "pl", "plPct", "today", "name"]

function normalizeSort(sort) {
  return SORTS.indexOf(String(sort)) === -1 ? "value" : String(sort)
}

function nextSort(sort) {
  return SORTS[(SORTS.indexOf(normalizeSort(sort)) + 1) % SORTS.length]
}

function sortTitle(sort) {
  var s = normalizeSort(sort)
  if (s === "value") return "Value"
  if (s === "pl") return "P/L"
  if (s === "plPct") return "P/L %"
  if (s === "today") return "Today"
  return "Name"
}

function sortPositions(positions, sort, todayPctFor) {
  var s = normalizeSort(sort)
  var copy = positions.slice()
  function num(v) { return v === null || v === undefined || !isFinite(v) ? -Infinity : v }
  copy.sort(function(a, b) {
    if (s === "name") return String(a.name).localeCompare(String(b.name))
    if (s === "pl") return b.pl - a.pl
    if (s === "plPct") return num(b.plPct) - num(a.plPct)
    if (s === "today") return num(todayPctFor(b)) - num(todayPctFor(a))
    return b.value - a.value
  })
  return copy
}
