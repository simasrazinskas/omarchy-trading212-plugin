.pragma library
.import "Format.js" as Format
.import "Series.js" as Series

// Public market data that enriches the Trading 212 numbers. Sources were
// picked for working without an API key from a plain curl:
//   - Nasdaq (api.nasdaq.com): quotes, profile, earnings date, price chart —
//     US listings only, values arrive as display strings ("$230.43").
//   - Frankfurter (ECB reference rates): FX, daily.
//   - CNN Fear & Greed: market mood.
//   - Google News RSS: headlines per holding.
// Yahoo Finance is only used for "open in browser" links: its JSON API is
// aggressively rate-limited against residential IPs.

var DAY_MS = 86400000
var parseNum = Format.parseLooseNumber

var MONTH_INDEX = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }

// T212 suffix → Yahoo suffix, for the non-US listings T212 marks with a
// lowercase exchange letter (VUSAl_EQ) or a country code (SHOP_CA_EQ).
var YAHOO_LETTER = { l: ".L", d: ".DE", p: ".PA", a: ".AS", e: ".MC", m: ".MI", s: ".SW" }
var YAHOO_COUNTRY = { US: "", CA: ".TO", AT: ".VI", BE: ".BR", PT: ".LS" }

// "Sep 21, 2026", "09/21/2026", "2026-09-21" → local-midnight ms, or 0.
function parseDate(text) {
  var s = String(text || "").trim()
  var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s)
  if (m) return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2])).getTime()
  m = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})/.exec(s)
  if (m && MONTH_INDEX[m[1].toLowerCase()] !== undefined)
    return new Date(Number(m[3]), MONTH_INDEX[m[1].toLowerCase()], Number(m[2])).getTime()
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
  return 0
}

function isUsListing(position) {
  var raw = String(position.rawTicker || "")
  if (/_US_EQ$/.test(raw)) return true
  // Bare tickers carry no exchange marker; only trust them when priced in USD.
  return raw.indexOf("_") === -1 && String(position.instrumentCurrency).toUpperCase() === "USD"
}

// Nasdaq's API symbol for a position, or "" when it isn't a US listing.
function nasdaqSymbol(position) {
  if (!position || !isUsListing(position)) return ""
  return Format.displayTicker(position.rawTicker).replace(/\//g, ".").toUpperCase()
}

function yahooSymbol(rawTicker) {
  var raw = String(rawTicker || "")
  var parts = raw.split("_")
  var base = parts[0]
  if (parts.length >= 3 && YAHOO_COUNTRY[parts[1]] !== undefined)
    return (parts[1] === "US" ? base.replace(/\./g, "-") : base) + YAHOO_COUNTRY[parts[1]]
  var letter = /^([A-Z0-9.]+)([a-z])$/.exec(base)
  if (letter && YAHOO_LETTER[letter[2]]) return letter[1] + YAHOO_LETTER[letter[2]]
  return base
}

function quoteUrl(position) {
  return "https://finance.yahoo.com/quote/" + encodeURIComponent(yahooSymbol(position.rawTicker))
}

function parseJson(raw) {
  try {
    return JSON.parse(String(raw || ""))
  } catch (error) {
    return null
  }
}

function nasdaqData(raw) {
  var parsed = parseJson(raw)
  return parsed && parsed.data && typeof parsed.data === "object" ? parsed.data : null
}

// "164.27 - 236.54" / "$495/$289.96" → { low, high } whichever order.
function parseRange(text) {
  var nums = String(text || "").match(/-?\d[\d,]*\.?\d*/g)
  if (!nums || nums.length < 2) return null
  var a = parseNum(nums[0])
  var b = parseNum(nums[1])
  if (a === null || b === null) return null
  return { low: Math.min(a, b), high: Math.max(a, b) }
}

// ---- /api/quote/{sym}/info. Outside regular hours `primaryData` is the
//      extended-hours quote and `secondaryData` the last regular close, so
//      the session decides which is "the day's move".
function parseQuote(raw, nowMs) {
  var data = nasdaqData(raw)
  if (!data || !data.primaryData) return null
  var primary = data.primaryData
  var secondary = data.secondaryData && parseNum(data.secondaryData.lastSalePrice) !== null ? data.secondaryData : null
  var status = String(data.marketStatus || "")
  var regular = /^open$/i.test(status) || !secondary
  var day = regular ? primary : secondary
  var stats = data.keyStats || {}
  var range = stats.fiftyTwoWeekHighLow ? parseRange(stats.fiftyTwoWeekHighLow.value) : null
  return {
    symbol: String(data.symbol || ""),
    name: String(data.companyName || ""),
    exchange: String(data.exchange || ""),
    marketStatus: status,
    price: parseNum(day.lastSalePrice),
    change: parseNum(day.netChange),
    changePct: parseNum(day.percentageChange),
    extPrice: regular ? null : parseNum(primary.lastSalePrice),
    extChangePct: regular ? null : parseNum(primary.percentageChange),
    low52: range ? range.low : null,
    high52: range ? range.high : null,
    fetchedAt: nowMs
  }
}

// ---- /api/quote/{sym}/summary: sector, fundamentals, dividend dates.
//      Stocks and ETFs use different keys; everything is optional.
function parseProfile(raw, nowMs) {
  var data = nasdaqData(raw)
  if (!data || !data.summaryData) return null
  var s = data.summaryData
  function val(key) { return s[key] && s[key].value !== undefined ? String(s[key].value) : "" }
  function num(key) { var v = val(key); return /n\/a/i.test(v) ? null : parseNum(v) }
  var range = parseRange(val("FiftTwoWeekHighLow"))
  var yieldText = val("Yield") || val("CurrentYield")
  return {
    sector: val("Sector") && !/n\/a/i.test(val("Sector")) ? val("Sector") : "",
    industry: val("Industry") && !/n\/a/i.test(val("Industry")) ? val("Industry") : "",
    exchange: val("Exchange"),
    marketCap: num("MarketCap"),
    target: num("OneYrTarget"),
    pe: num("PERatio"),
    eps: num("EarningsPerShare"),
    annualDividend: num("AnnualizedDividend"),
    yieldPct: /n\/a/i.test(yieldText) ? null : parseNum(yieldText),
    exDividend: parseDate(val("ExDividendDate")),
    dividendPayment: parseDate(val("DividendPaymentDate")),
    previousClose: num("PreviousClose"),
    low52: range ? range.low : null,
    high52: range ? range.high : null,
    fetchedAt: nowMs
  }
}

// ---- /api/analyst/{sym}/earnings-date: free text from Zacks, e.g.
//      "…is estimated to report earnings on 11/18/2026 … consensus EPS
//      forecast for the quarter is $2.47."
function parseEarnings(raw, nowMs) {
  var data = nasdaqData(raw)
  if (!data) return null
  var text = String(data.reportText || "")
  var date = /(\d{1,2}\/\d{1,2}\/\d{4})/.exec(text)
  var eps = /consensus EPS forecast[^$]*\$(-?[\d.]+)/i.exec(text)
  return {
    time: date ? parseDate(date[1]) : 0,
    estimated: /estimated/i.test(text),
    epsForecast: eps ? parseNum(eps[1]) : null,
    fetchedAt: nowMs
  }
}

// ---- /api/quote/{sym}/chart: daily closes as { x: ms, y: close }.
function parseChart(raw, nowMs) {
  var data = nasdaqData(raw)
  if (!data || !Array.isArray(data.chart)) return null
  var points = []
  for (var i = 0; i < data.chart.length; i++) {
    var p = data.chart[i] || {}
    var ts = Number(p.x)
    var close = parseNum(p.y)
    if (isFinite(ts) && ts > 0 && close !== null) points.push({ ts: ts, value: close })
  }
  points.sort(function(a, b) { return a.ts - b.ts })
  return { points: points, previousClose: parseNum(data.previousClose), fetchedAt: nowMs }
}

var CHART_RANGES = ["1M", "3M", "6M", "1Y"]

// A price chart cut to `range` (1M…1Y), with the live price appended as a
// final point once it is newer than the last daily close.
function chartWindow(chart, range, livePrice, nowMs) {
  var days = range === "1M" ? 31 : range === "3M" ? 92 : range === "6M" ? 183 : 366
  var cutoff = nowMs - days * DAY_MS
  var source = chart && chart.points ? chart.points : []
  var points = []
  for (var i = 0; i < source.length; i++) if (source[i].ts >= cutoff) points.push(source[i])
  if (livePrice !== null && livePrice !== undefined && isFinite(Number(livePrice)) && points.length > 0 && nowMs > points[points.length - 1].ts)
    points.push({ ts: nowMs, value: Number(livePrice) })
  return Series.fromPoints(points, true)
}

// Where the price sits in its 52-week range, 0…1 (null without a range).
function rangePosition(price, low, high) {
  if (price === null || low === null || high === null || !(high > low)) return null
  return Math.max(0, Math.min(1, (price - low) / (high - low)))
}

// ---- Frankfurter: { base, date, rates: { USD: 1.13, … } }.
function parseFx(raw, nowMs) {
  var parsed = parseJson(raw)
  if (!parsed || !parsed.rates || typeof parsed.rates !== "object") return null
  var rates = {}
  for (var code in parsed.rates) {
    var n = Number(parsed.rates[code])
    if (isFinite(n) && n > 0) rates[code] = n
  }
  return { base: String(parsed.base || ""), date: String(parsed.date || ""), rates: rates, fetchedAt: nowMs }
}

// Units of `code` per one unit of the FX table's base, the way the ECB
// quotes it (EUR → USD 1.09); GBX (pence) is GBP × 100. Null when unknown.
function perBase(code, fx) {
  var c = String(code || "").toUpperCase()
  if (!fx) return null
  if (c === fx.base) return 1
  if (c === "GBX") return fx.base === "GBP" ? 100 : fx.rates.GBP ? fx.rates.GBP * 100 : null
  return fx.rates[c] || null
}

// Converts `amount` from one currency to another through the FX table's
// base (ECB rates are all quoted against EUR). Null when either rate is
// unknown; same-currency amounts pass through even without a table.
function convert(amount, from, to, fx) {
  var f = String(from || "").toUpperCase()
  var t = String(to || "").toUpperCase()
  if (f === t) return amount
  var fromRate = perBase(f, fx)
  var toRate = perBase(t, fx)
  return fromRate === null || toRate === null ? null : amount / fromRate * toRate
}

// Price of one `from` in `to` (EUR/USD 1.09 → crossRate("EUR", "USD")).
function crossRate(from, to, fx) {
  return convert(1, from, to, fx)
}

// ---- CNN Fear & Greed.
function parseFearGreed(raw, nowMs) {
  var parsed = parseJson(raw)
  var fg = parsed && parsed.fear_and_greed
  if (!fg || !isFinite(Number(fg.score))) return null
  return {
    score: Number(fg.score),
    rating: String(fg.rating || ""),
    previousClose: Format.toNumber(fg.previous_close, null),
    weekAgo: Format.toNumber(fg.previous_1_week, null),
    monthAgo: Format.toNumber(fg.previous_1_month, null),
    fetchedAt: nowMs
  }
}

function moodLabel(rating) {
  return String(rating || "").replace(/(^|\s)\S/g, function(c) { return c.toUpperCase() })
}

// ---- Google News RSS.
function decodeEntities(text) {
  return String(text || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, function(_, hex) { return String.fromCharCode(parseInt(hex, 16)) })
    .replace(/&#(\d+);/g, function(_, dec) { return String.fromCharCode(parseInt(dec, 10)) })
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
}

function tag(block, name) {
  var m = new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + name + ">", "i").exec(block)
  return m ? decodeEntities(m[1]).trim() : ""
}

function parseNews(xml, limit) {
  var items = []
  var re = /<item>([\s\S]*?)<\/item>/gi
  var m
  while ((m = re.exec(String(xml || ""))) !== null && items.length < (limit || 8)) {
    var block = m[1]
    var title = tag(block, "title")
    var source = tag(block, "source")
    // Google appends " - Publisher" to every headline.
    if (source !== "" && title.slice(-(source.length + 3)) === " - " + source)
      title = title.slice(0, -(source.length + 3))
    var link = tag(block, "link")
    var time = Date.parse(tag(block, "pubDate"))
    if (title === "" || link === "") continue
    items.push({ title: title, link: link, source: source, time: isFinite(time) ? time : 0 })
  }
  return items
}

function newsQuery(position) {
  var name = String(position.name || "").replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim()
  var ticker = Format.displayTicker(position.rawTicker)
  if (isUsListing(position)) return "\"" + name + "\" OR " + ticker + " stock"
  return "\"" + name + "\""
}

function newsUrl(position) {
  return "https://news.google.com/rss/search?q=" + encodeURIComponent(newsQuery(position)) + "+when:14d&hl=en-US&gl=US&ceid=US:en"
}

// ---- Derived views.

// Upcoming earnings / ex-dividend / payment dates for held symbols within
// `horizonDays`, soonest first.
function upcomingEvents(positions, profiles, earnings, nowMs, horizonDays) {
  var events = []
  var today = Format.dateStartMs(Format.localDate(nowMs))
  var until = today + horizonDays * DAY_MS
  for (var i = 0; i < positions.length; i++) {
    var p = positions[i]
    var sym = nasdaqSymbol(p)
    if (sym === "") continue
    var e = earnings[sym]
    if (e && e.time >= today && e.time <= until)
      events.push({ ticker: p.ticker, rawTicker: p.rawTicker, name: p.name, kind: "earnings", time: e.time, estimated: e.estimated })
    var prof = profiles[sym]
    if (prof && prof.exDividend >= today && prof.exDividend <= until)
      events.push({ ticker: p.ticker, rawTicker: p.rawTicker, name: p.name, kind: "exdiv", time: prof.exDividend, estimated: false })
    if (prof && prof.dividendPayment >= today && prof.dividendPayment <= until)
      events.push({ ticker: p.ticker, rawTicker: p.rawTicker, name: p.name, kind: "payment", time: prof.dividendPayment, estimated: false })
  }
  events.sort(function(a, b) { return a.time - b.time })
  return events
}

function eventTitle(kind) {
  if (kind === "earnings") return "Earnings"
  if (kind === "exdiv") return "Ex-dividend"
  return "Dividend payment"
}

// Forward annual dividend income: annualized dividend per share × shares,
// converted from the instrument currency into the account currency.
function projectedIncome(positions, profiles, fx, accountCurrency) {
  var total = 0
  var covered = 0
  for (var i = 0; i < positions.length; i++) {
    var p = positions[i]
    var prof = profiles[nasdaqSymbol(p)]
    if (!prof || !(prof.annualDividend > 0)) continue
    var converted = convert(prof.annualDividend * p.quantity, p.instrumentCurrency || "USD", accountCurrency, fx)
    if (converted === null) continue
    total += converted
    covered += 1
  }
  return { total: total, payers: covered }
}

// The US session state, from whichever quote is freshest.
function usMarketStatus(quotes) {
  var best = null
  for (var sym in quotes) {
    var q = quotes[sym]
    if (q && q.marketStatus && (!best || q.fetchedAt > best.fetchedAt)) best = q
  }
  return best ? best.marketStatus : ""
}

function isStale(entry, maxAgeMs, nowMs) {
  return !entry || !(entry.fetchedAt > 0) || nowMs - entry.fetchedAt >= maxAgeMs
}
