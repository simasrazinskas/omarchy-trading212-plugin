.pragma library
.import "Format.js" as Format
.import "Cash.js" as Cash
.import "Icons.js" as Icons

// The synced account history — orders, dividends, cash transactions — as a
// persisted, incrementally merged store plus the derived views: the unified
// activity timeline and dividend statistics.

var DAY_MS = 86400000

var FILTERS = ["all", "trades", "dividends", "cash"]

function emptyStore() {
  return { version: 1, orders: [], dividends: [], transactions: [], syncedAt: 0, complete: {}, cursors: {} }
}

// Restores a persisted store, dropping anything malformed.
function parseStore(raw) {
  var parsed
  try {
    parsed = JSON.parse(String(raw || ""))
  } catch (error) {
    return emptyStore()
  }
  if (!parsed || typeof parsed !== "object") return emptyStore()
  var store = emptyStore()
  var kinds = ["orders", "dividends", "transactions"]
  for (var i = 0; i < kinds.length; i++) {
    var list = Array.isArray(parsed[kinds[i]]) ? parsed[kinds[i]] : []
    for (var j = 0; j < list.length; j++)
      if (list[j] && typeof list[j] === "object" && list[j].id !== undefined && list[j].time > 0) store[kinds[i]].push(list[j])
  }
  store.syncedAt = Number(parsed.syncedAt) > 0 ? Number(parsed.syncedAt) : 0
  store.complete = parsed.complete && typeof parsed.complete === "object" ? parsed.complete : {}
  // Backfill resume points: kind → nextPagePath of the oldest page fetched.
  if (parsed.cursors && typeof parsed.cursors === "object")
    for (var kind in parsed.cursors) if (typeof parsed.cursors[kind] === "string" && parsed.cursors[kind] !== "") store.cursors[kind] = parsed.cursors[kind]
  return store
}

// Merges a freshly fetched page into a stored list, newest first. `overlap`
// counts rows already known — once a page overlaps, older pages are
// already stored and incremental sync can stop paging.
function merge(existing, incoming) {
  var byId = {}
  var out = []
  var overlap = 0
  var added = []
  for (var i = 0; i < existing.length; i++) byId[existing[i].id] = existing[i]
  for (var j = 0; j < incoming.length; j++) {
    var item = incoming[j]
    if (byId[item.id] !== undefined) overlap += 1
    else added.push(item)
    // Incoming wins: an order can move from NEW to FILLED between syncs.
    byId[item.id] = item
  }
  for (var id in byId) out.push(byId[id])
  out.sort(function(a, b) { return b.time - a.time })
  return { items: out, overlap: overlap, added: added }
}

function tradeTitle(order) {
  if (order.fillType && order.fillType !== "TRADE") return order.fillType.replace(/_/g, " ").toLowerCase()
  return order.side === "SELL" ? "Sold" : "Bought"
}

// Unified, newest-first timeline for the Activity tab. Only filled orders
// are trades; cancelled / rejected ones are noise here.
function timeline(store, filter, rules, limit) {
  var f = FILTERS.indexOf(filter) === -1 ? "all" : filter
  var rows = []
  if (f === "all" || f === "trades") {
    for (var i = 0; i < store.orders.length; i++) {
      var o = store.orders[i]
      if (!o.filled) continue
      rows.push({
        kind: "trade",
        id: "o" + o.id,
        time: o.time,
        icon: o.side === "SELL" ? Icons.sell : Icons.buy,
        title: tradeTitle(o) + " " + o.ticker,
        detail: Format.formatQuantity(o.quantity) + " @ " + Format.formatFull(o.price, Format.currencySymbol(o.instrumentCurrency))
          + (o.source === "AUTOINVEST" || o.source === "INSTRUMENT_AUTOINVEST" ? " · autoinvest" : ""),
        amount: o.side === "SELL" ? o.value : -o.value,
        // The API reports a zero realized P/L on buys; only sells realize.
        realized: o.side === "SELL" ? o.realized : null,
        fees: o.fees,
        ticker: o.ticker,
        rawTicker: o.rawTicker
      })
    }
  }
  if (f === "all" || f === "dividends") {
    for (var j = 0; j < store.dividends.length; j++) {
      var d = store.dividends[j]
      rows.push({
        kind: "dividend",
        id: "d" + d.id,
        time: d.time,
        icon: Icons.dividend,
        title: "Dividend " + d.ticker,
        detail: Format.formatQuantity(d.quantity) + " sh" + (d.type && d.type !== "DIVIDEND" && d.type !== "ORDINARY" ? " · " + d.type.replace(/_/g, " ").toLowerCase() : ""),
        amount: d.amount,
        realized: null,
        fees: 0,
        ticker: d.ticker,
        rawTicker: d.rawTicker
      })
    }
  }
  if (f === "all" || f === "cash") {
    for (var k = 0; k < store.transactions.length; k++) {
      var t = store.transactions[k]
      var cat = Cash.classify(t, rules)
      var meta = Cash.category(cat)
      rows.push({
        kind: "cash",
        category: cat,
        id: "t" + t.id,
        time: t.time,
        icon: meta.icon,
        title: meta.label,
        detail: "",
        amount: t.amount,
        realized: null,
        fees: 0,
        ticker: "",
        rawTicker: ""
      })
    }
  }
  rows.sort(function(a, b) { return b.time - a.time })
  return limit > 0 ? rows.slice(0, limit) : rows
}

// Groups timeline rows under day headers: [{ header, rows }].
function groupByDay(rows, nowMs) {
  var groups = []
  var current = null
  for (var i = 0; i < rows.length; i++) {
    var key = Format.localDate(rows[i].time)
    if (!current || current.key !== key) {
      var diff = Format.dayDiff(rows[i].time, nowMs)
      var header = diff === 0 ? "Today" : diff === 1 ? "Yesterday" : Format.longDate(rows[i].time)
      current = { key: key, header: header, rows: [], net: 0 }
      groups.push(current)
    }
    current.rows.push(rows[i])
    current.net += rows[i].amount
  }
  return groups
}

// Dividend income: totals, trailing-12-month, year-to-date, per holding.
function dividendStats(dividends, nowMs) {
  var year = new Date(nowMs).getFullYear()
  var out = { total: 0, last12m: 0, ytd: 0, count: dividends.length, byTicker: [] }
  var byTicker = {}
  for (var i = 0; i < dividends.length; i++) {
    var d = dividends[i]
    out.total += d.amount
    if (nowMs - d.time <= 365 * DAY_MS) out.last12m += d.amount
    if (new Date(d.time).getFullYear() === year) out.ytd += d.amount
    var key = d.ticker
    if (!byTicker[key]) byTicker[key] = { ticker: d.ticker, name: d.name, amount: 0, count: 0, last: 0 }
    byTicker[key].amount += d.amount
    byTicker[key].count += 1
    byTicker[key].last = Math.max(byTicker[key].last, d.time)
  }
  for (var t in byTicker) out.byTicker.push(byTicker[t])
  out.byTicker.sort(function(a, b) { return b.amount - a.amount })
  return out
}

function tradingStats(orders, nowMs) {
  var out = { buys: 0, sells: 0, bought: 0, sold: 0, fees: 0, last30: 0, autoinvest: 0 }
  for (var i = 0; i < orders.length; i++) {
    var o = orders[i]
    if (!o.filled) continue
    if (o.side === "SELL") { out.sells += 1; out.sold += o.value }
    else { out.buys += 1; out.bought += o.value }
    out.fees += o.fees || 0
    if (nowMs - o.time <= 30 * DAY_MS) out.last30 += 1
    if (o.source === "AUTOINVEST" || o.source === "INSTRUMENT_AUTOINVEST") out.autoinvest += 1
  }
  return out
}

function forTicker(list, rawTicker, limit) {
  var out = []
  for (var i = 0; i < list.length && (limit <= 0 || out.length < limit); i++)
    if (list[i].rawTicker === rawTicker && (list[i].filled === undefined || list[i].filled)) out.push(list[i])
  return out
}

function sumAmounts(list) {
  var sum = 0
  for (var i = 0; i < list.length; i++) sum += Number(list[i].amount) || 0
  return sum
}

function orderFees(orders) {
  var sum = 0
  for (var i = 0; i < orders.length; i++) sum += orders[i].fees || 0
  return sum
}

function filterTitle(filter) {
  if (filter === "trades") return "Trades"
  if (filter === "dividends") return "Dividends"
  if (filter === "cash") return "Cash"
  return "All"
}
