// Pure data/formatting logic for the Trading 212 bar widget. No QML or
// Quickshell types in here so the whole file runs under `node --test` too.

var MODE_RING = ["invested", "percent", "total", "privacy"]

var CURRENCY_SYMBOLS = {
  EUR: "€",
  USD: "$",
  GBP: "£",
  GBX: "p",
  CHF: "CHF ",
  PLN: "zł",
  CZK: "Kč",
  SEK: "kr",
  NOK: "kr",
  DKK: "kr",
  HUF: "Ft",
  RON: "lei",
  JPY: "¥",
  CAD: "C$",
  AUD: "A$",
  BGN: "лв"
}

function currencySymbol(code) {
  var key = String(code || "").toUpperCase()
  if (CURRENCY_SYMBOLS[key] !== undefined) return CURRENCY_SYMBOLS[key]
  return key === "" ? "" : key + " "
}

function toNumber(value, fallback) {
  var n = Number(value)
  return isFinite(n) ? n : fallback
}

function groupThousands(intString) {
  return String(intString).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

// Panel-precision money: always two decimals, thousands-grouped.
function formatFull(value, symbol) {
  var n = toNumber(value, 0)
  var sign = n < 0 ? "-" : ""
  var fixed = Math.abs(n).toFixed(2)
  var parts = fixed.split(".")
  return sign + (symbol || "") + groupThousands(parts[0]) + "." + parts[1]
}

// Signed variant for P/L readouts: leading + on gains.
function formatSigned(value, symbol) {
  var n = toNumber(value, 0)
  return (n >= 0 ? "+" : "") + formatFull(n, symbol)
}

// Bar-precision money: whole units below 10k, then 12.5k / 1.23M.
function formatBar(value, symbol) {
  var n = toNumber(value, 0)
  var sign = n < 0 ? "-" : ""
  var abs = Math.abs(n)
  if (abs >= 1e6) {
    var m = abs / 1e6
    return sign + (symbol || "") + (m >= 100 ? Math.round(m) : m.toFixed(2).replace(/0$/, "")) + "M"
  }
  if (abs >= 1e4) {
    var k = (abs / 1e3).toFixed(1).replace(/\.0$/, "")
    return sign + (symbol || "") + k + "k"
  }
  return sign + (symbol || "") + groupThousands(Math.round(abs))
}

function formatPercent(pct) {
  if (pct === null || pct === undefined || !isFinite(Number(pct))) return ""
  var n = Number(pct)
  var digits = Math.abs(n) < 0.1 && n !== 0 ? 2 : 1
  return (n >= 0 ? "+" : "") + n.toFixed(digits) + "%"
}

// ---- Fetch-output handling. The fetch script prints the response body, then
//      a trailing "__T212_HTTP__ <code>" line; "__T212_STATUS__ <state>" marks
//      states that never reached the API (missing key, curl failure).
function splitFetchOutput(raw) {
  var text = String(raw || "")
  if (text.indexOf("__T212_STATUS__ no_key") !== -1) return { status: "no_key", http: 0, body: "" }

  var re = /__T212_HTTP__ (\d{3})/g
  var match = null
  var last = null
  while ((match = re.exec(text)) !== null) last = match
  if (!last || last[1] === "000" || text.indexOf("__T212_STATUS__ curl_error") !== -1)
    return { status: "curl_error", http: 0, body: "" }
  return { status: "http", http: parseInt(last[1], 10), body: text.slice(0, last.index).trim() }
}

// ---- /equity/account/summary. Current schema is `cash`+`investments`
//      objects; the legacy /equity/account/cash flat shape is mapped too so a
//      stale deployment degrades gracefully instead of erroring.
function parseSummary(raw) {
  var parsed
  try {
    parsed = JSON.parse(String(raw || ""))
  } catch (error) {
    return { ok: false, error: "Could not parse the Trading 212 response" }
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, error: "Unexpected Trading 212 response" }

  if (parsed.investments && typeof parsed.investments === "object") {
    var cash = parsed.cash && typeof parsed.cash === "object" ? parsed.cash : {}
    var invested = toNumber(parsed.investments.totalCost, 0)
    var value = toNumber(parsed.investments.currentValue, 0)
    var pl = toNumber(parsed.investments.unrealizedProfitLoss, value - invested)
    var free = toNumber(cash.availableToTrade, 0)
    var reserved = toNumber(cash.reservedForOrders, 0)
    var pieCash = toNumber(cash.inPies, 0)
    return {
      ok: true,
      data: {
        currency: String(parsed.currency || ""),
        invested: invested,
        value: value,
        pl: pl,
        plPct: invested > 0 ? (pl / invested) * 100 : null,
        free: free,
        reserved: reserved,
        pieCash: pieCash,
        realized: toNumber(parsed.investments.realizedProfitLoss, 0),
        total: value + free + reserved + pieCash
      }
    }
  }

  if (parsed.invested !== undefined && parsed.free !== undefined) {
    var legacyInvested = toNumber(parsed.invested, 0)
    var ppl = toNumber(parsed.ppl, 0)
    return {
      ok: true,
      data: {
        currency: "",
        invested: legacyInvested,
        value: legacyInvested + ppl,
        pl: ppl,
        plPct: legacyInvested > 0 ? (ppl / legacyInvested) * 100 : null,
        free: toNumber(parsed.free, 0),
        reserved: toNumber(parsed.blocked, 0),
        pieCash: toNumber(parsed.pieCash, 0),
        realized: toNumber(parsed.result, 0),
        total: toNumber(parsed.total, legacyInvested + ppl + toNumber(parsed.free, 0))
      }
    }
  }

  return { ok: false, error: "Unexpected Trading 212 response" }
}

// Proprietary tickers like AAPL_US_EQ read better as AAPL.
function displayTicker(ticker) {
  return String(ticker || "").split("_")[0]
}

// ---- /equity/positions. Current schema nests `instrument`+`walletImpact`;
//      the legacy /equity/portfolio flat shape is mapped as a fallback.
function parsePositions(raw) {
  var parsed
  try {
    parsed = JSON.parse(String(raw || ""))
  } catch (error) {
    return { ok: false, error: "Could not parse the Trading 212 positions response", items: [] }
  }
  if (!Array.isArray(parsed)) return { ok: false, error: "Unexpected Trading 212 positions response", items: [] }

  var items = []
  for (var i = 0; i < parsed.length; i++) {
    var p = parsed[i] || {}
    var item = null
    if (p.instrument && typeof p.instrument === "object") {
      var wallet = p.walletImpact && typeof p.walletImpact === "object" ? p.walletImpact : {}
      var cost = toNumber(wallet.totalCost, 0)
      var pl = toNumber(wallet.unrealizedProfitLoss, toNumber(wallet.currentValue, 0) - cost)
      item = {
        ticker: displayTicker(p.instrument.ticker),
        name: String(p.instrument.name || displayTicker(p.instrument.ticker)),
        quantity: toNumber(p.quantity, 0),
        avgPrice: toNumber(p.averagePricePaid, 0),
        price: toNumber(p.currentPrice, 0),
        instrumentCurrency: String(p.instrument.currency || ""),
        value: toNumber(wallet.currentValue, 0),
        pl: pl,
        plPct: cost > 0 ? (pl / cost) * 100 : null
      }
    } else if (p.ticker !== undefined) {
      var qty = toNumber(p.quantity, 0)
      var price = toNumber(p.currentPrice, 0)
      var legacyPl = toNumber(p.ppl, 0)
      var legacyValue = qty * price
      item = {
        ticker: displayTicker(p.ticker),
        name: displayTicker(p.ticker),
        quantity: qty,
        avgPrice: toNumber(p.averagePrice, 0),
        price: price,
        instrumentCurrency: "",
        value: legacyValue,
        pl: legacyPl,
        plPct: legacyValue - legacyPl > 0 ? (legacyPl / (legacyValue - legacyPl)) * 100 : null
      }
    }
    if (item && item.quantity !== 0) items.push(item)
  }

  items.sort(function(a, b) { return b.value - a.value })
  return { ok: true, items: items }
}

function normalizeMode(mode) {
  return MODE_RING.indexOf(String(mode)) === -1 ? MODE_RING[0] : String(mode)
}

function nextMode(mode) {
  var index = MODE_RING.indexOf(normalizeMode(mode))
  return MODE_RING[(index + 1) % MODE_RING.length]
}

// ---- Bar label. Returns { main, delta, sign } where sign drives the delta
//      color: 1 profit, -1 loss/problem, 0 neutral. Privacy mode never
//      includes an amount.
function barLabel(mode, state) {
  state = state || {}
  if (state.keyMissing) return { main: "T212", delta: "setup", sign: 0 }
  if (state.authFailed) return { main: "T212", delta: "key ✕", sign: -1 }

  var data = state.data
  if (!data) return { main: "T212", delta: state.error ? "—" : "…", sign: 0 }

  var symbol = currencySymbol(data.currency)
  var arrow = data.pl >= 0 ? "▲" : "▼"
  var sign = data.pl >= 0 ? 1 : -1
  var resolved = normalizeMode(mode)

  if (resolved === "invested")
    return { main: formatBar(data.invested, symbol), delta: arrow + " " + formatBar(Math.abs(data.pl), symbol), sign: sign }
  if (resolved === "percent")
    return { main: "", delta: arrow + " " + formatPercent(data.plPct).replace(/^\+/, ""), sign: sign }
  if (resolved === "total")
    return { main: formatBar(data.total, symbol), delta: "", sign: 0 }
  return { main: "T212", delta: arrow, sign: sign }
}

function modeTitle(mode) {
  var resolved = normalizeMode(mode)
  if (resolved === "invested") return "Invested + P/L"
  if (resolved === "percent") return "P/L percent"
  if (resolved === "total") return "Total value"
  return "Privacy"
}

// Bar tooltip. Privacy mode deliberately reveals nothing numeric.
function tooltip(mode, state, environment) {
  var envSuffix = environment === "demo" ? " (demo)" : ""
  var header = "Trading 212" + envSuffix
  var hints = "Left: details · Right: next mode · Middle: refresh"
  if (state.keyMissing) return header + " — API key required. Left-click for setup steps."
  if (state.authFailed) return header + " — API key rejected. Left-click for details."
  if (!state.data) return header + (state.error ? " — " + state.error : " — loading…") + "\n" + hints
  if (normalizeMode(mode) === "privacy") return header + " · Privacy mode\n" + hints

  var data = state.data
  var symbol = currencySymbol(data.currency)
  var pct = data.plPct === null ? "" : " (" + formatPercent(data.plPct) + ")"
  return header
    + " · Invested " + formatFull(data.invested, symbol)
    + " · Value " + formatFull(data.value, symbol)
    + " · P/L " + formatSigned(data.pl, symbol) + pct
    + "\n" + hints
}

// Sanity-check a pasted credential before it reaches the keyring. Accepts
// KEY:SECRET pairs and legacy single tokens; rejects empty input and inner
// whitespace (the usual sign of a mangled paste).
function validateCredential(text) {
  var cred = String(text || "").trim()
  if (cred === "") return { ok: false, cred: "", error: "Paste your API key first" }
  if (/\s/.test(cred)) return { ok: false, cred: "", error: "The key looks invalid — it contains spaces" }
  return { ok: true, cred: cred, error: "" }
}

// ---- Snapshot history → graph series. The history file is JSONL, one
//      line per day; bad lines are skipped, duplicate dates keep the last
//      write, output is ascending by time with millisecond timestamps.
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
    if (byDate[date] === undefined) dates.push(date)
    byDate[date] = {
      date: date,
      ts: isFinite(ts) && ts > 0 ? ts * 1000 : Date.parse(date),
      value: value,
      invested: toNumber(entry.invested, 0),
      pl: toNumber(entry.pl, 0)
    }
  }
  var out = []
  for (var j = 0; j < dates.length; j++) out.push(byDate[dates[j]])
  out.sort(function(a, b) { return a.ts - b.ts })
  return out
}

// Chart-ready series: daily snapshots plus a trailing live point (today's
// current value), so the graph moves intraday and works from day one.
function graphSeries(history, liveValue, nowMs) {
  var points = []
  for (var i = 0; i < history.length; i++)
    points.push({ ts: history[i].ts, value: history[i].value, date: history[i].date })
  if (liveValue !== null && liveValue !== undefined && isFinite(Number(liveValue)))
    points.push({ ts: nowMs, value: Number(liveValue), date: "" })
  points.sort(function(a, b) { return a.ts - b.ts })

  if (points.length === 0)
    return { points: [], min: 0, max: 0, changeAbs: 0, changePct: null, firstTs: 0, lastTs: 0 }

  var min = points[0].value
  var max = points[0].value
  for (var j = 1; j < points.length; j++) {
    if (points[j].value < min) min = points[j].value
    if (points[j].value > max) max = points[j].value
  }
  var first = points[0]
  var last = points[points.length - 1]
  var changeAbs = last.value - first.value
  return {
    points: points,
    min: min,
    max: max,
    changeAbs: changeAbs,
    changePct: first.value > 0 ? (changeAbs / first.value) * 100 : null,
    firstTs: first.ts,
    lastTs: last.ts
  }
}

// Disk-cached summary (written on every successful fetch, read at startup)
// so a shell restart shows the last known numbers instantly instead of a
// loading state. Returns { ok, savedAtMs, data } with coerced numbers.
function parseCache(raw) {
  var parsed
  try {
    parsed = JSON.parse(String(raw || ""))
  } catch (error) {
    return { ok: false }
  }
  if (!parsed || typeof parsed !== "object" || !parsed.data || typeof parsed.data !== "object") return { ok: false }
  var d = parsed.data
  if (!isFinite(Number(d.invested)) || !isFinite(Number(d.value))) return { ok: false }
  var invested = toNumber(d.invested, 0)
  var pl = toNumber(d.pl, 0)
  var savedAtMs = Date.parse(String(parsed.savedAt || ""))
  return {
    ok: true,
    savedAtMs: isFinite(savedAtMs) ? savedAtMs : 0,
    data: {
      currency: String(d.currency || ""),
      invested: invested,
      value: toNumber(d.value, 0),
      pl: pl,
      plPct: invested > 0 ? (pl / invested) * 100 : null,
      free: toNumber(d.free, 0),
      reserved: toNumber(d.reserved, 0),
      pieCash: toNumber(d.pieCash, 0),
      realized: toNumber(d.realized, 0),
      total: toNumber(d.total, 0)
    }
  }
}

// One JSONL line per day so a future graph has local history to draw from.
function snapshotLine(dateString, timestampMs, data) {
  return JSON.stringify({
    date: dateString,
    ts: Math.round(timestampMs / 1000),
    currency: data.currency,
    invested: Math.round(data.invested * 100) / 100,
    value: Math.round(data.value * 100) / 100,
    pl: Math.round(data.pl * 100) / 100,
    cash: Math.round((data.free + data.reserved + data.pieCash) * 100) / 100
  })
}

if (typeof module !== "undefined") {
  module.exports = {
    MODE_RING: MODE_RING,
    currencySymbol: currencySymbol,
    groupThousands: groupThousands,
    formatFull: formatFull,
    formatSigned: formatSigned,
    formatBar: formatBar,
    formatPercent: formatPercent,
    splitFetchOutput: splitFetchOutput,
    parseSummary: parseSummary,
    parsePositions: parsePositions,
    displayTicker: displayTicker,
    normalizeMode: normalizeMode,
    nextMode: nextMode,
    barLabel: barLabel,
    modeTitle: modeTitle,
    tooltip: tooltip,
    validateCredential: validateCredential,
    parseCache: parseCache,
    parseHistory: parseHistory,
    graphSeries: graphSeries,
    snapshotLine: snapshotLine
  }
}
