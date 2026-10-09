.pragma library

// Number, money and date formatting shared by every view. Pure JavaScript:
// no Qt or Quickshell globals, so the node test harness runs it unchanged.

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

var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
var DAY_MS = 86400000

function currencySymbol(code) {
  var key = String(code || "").toUpperCase()
  if (CURRENCY_SYMBOLS[key] !== undefined) return CURRENCY_SYMBOLS[key]
  return key === "" ? "" : key + " "
}

function toNumber(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback
  var n = Number(value)
  return isFinite(n) ? n : fallback
}

// Scraped quote fields arrive as display strings: "$1,234.50", "+0.69%",
// "1,383,810.61", "N/A". Returns null for anything without a number in it.
function parseLooseNumber(text) {
  if (typeof text === "number") return isFinite(text) ? text : null
  var cleaned = String(text === null || text === undefined ? "" : text).replace(/[^0-9.+-]/g, "")
  if (cleaned === "" || cleaned === "+" || cleaned === "-" || cleaned === ".") return null
  var n = parseFloat(cleaned)
  return isFinite(n) ? n : null
}

function round2(value) {
  return Math.round(toNumber(value, 0) * 100) / 100
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

// Bar-precision money: cents below 100 (so small P/L never rounds to
// zero), whole units below 10k, then 12.5k / 1.23M.
function formatBar(value, symbol) {
  var n = toNumber(value, 0)
  var sign = n < 0 ? "-" : ""
  var abs = Math.abs(n)
  if (abs >= 1e6) {
    var m = abs / 1e6
    return sign + (symbol || "") + (m >= 100 ? Math.round(m) : m.toFixed(2).replace(/\.?0+$/, "")) + "M"
  }
  // Rounded threshold so 9,999.60 renders as €10k, not a sudden €10,000.
  if (Math.round(abs) >= 1e4) {
    var k = (abs / 1e3).toFixed(1).replace(/\.0$/, "")
    return sign + (symbol || "") + k + "k"
  }
  if (abs < 100) return sign + (symbol || "") + abs.toFixed(2)
  return sign + (symbol || "") + groupThousands(Math.round(abs))
}

// Signed bar-precision money: explicit + on gains, - on losses.
function formatBarSigned(value, symbol) {
  var n = toNumber(value, 0)
  return (n >= 0 ? "+" : "") + formatBar(n, symbol)
}

function formatPercent(pct) {
  if (pct === null || pct === undefined || !isFinite(Number(pct))) return ""
  var n = Number(pct)
  var digits = Math.abs(n) < 0.1 && n !== 0 ? 2 : 1
  return (n >= 0 ? "+" : "") + n.toFixed(digits) + "%"
}

// Unsigned share-of-whole percentages (allocation weights, yields).
function formatWeight(pct) {
  if (pct === null || pct === undefined || !isFinite(Number(pct))) return ""
  var n = Number(pct)
  return (n > 0 && n < 0.1 ? "<0.1" : n.toFixed(n >= 10 ? 0 : 1)) + "%"
}

// Share quantities: fractional holdings trimmed to four decimals, whole
// counts shown plain (0.79232076 → "0.7923", 2 → "2").
function formatQuantity(quantity) {
  var n = toNumber(quantity, 0)
  return String(parseFloat(n.toFixed(4)))
}

// Large plain numbers (market caps): 1.69T, 812B, 45.2M.
function formatCompact(value) {
  var n = toNumber(value, null)
  if (n === null) return ""
  var abs = Math.abs(n)
  var units = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "k"]]
  for (var i = 0; i < units.length; i++) {
    if (abs >= units[i][0]) {
      var scaled = n / units[i][0]
      return (Math.abs(scaled) >= 100 ? Math.round(scaled) : scaled.toFixed(Math.abs(scaled) >= 10 ? 1 : 2).replace(/\.?0+$/, "")) + units[i][1]
    }
  }
  return String(Math.round(n))
}

function pad2(n) {
  return n < 10 ? "0" + n : String(n)
}

// Local calendar date of a timestamp as yyyy-MM-dd — the key every daily
// bucket (snapshots, spending) is grouped by.
function localDate(ms) {
  var d = new Date(ms)
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate())
}

function localMonth(ms) {
  return localDate(ms).slice(0, 7)
}

// Local midnight of a yyyy-MM-dd key.
function dateStartMs(dateKey) {
  var parts = String(dateKey).split("-")
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2] || 1)).getTime()
}

function shortDate(ms) {
  var d = new Date(ms)
  return d.getDate() + " " + MONTHS[d.getMonth()]
}

function longDate(ms) {
  var d = new Date(ms)
  return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear()
}

function clock(ms) {
  var d = new Date(ms)
  return pad2(d.getHours()) + ":" + pad2(d.getMinutes())
}

// "2026-09" → "Sep" (or "Sep 2026" with the year).
function monthLabel(monthKey, withYear) {
  var parts = String(monthKey).split("-")
  var label = MONTHS[Math.max(0, Math.min(11, Number(parts[1]) - 1))]
  return withYear ? label + " " + parts[0] : label
}

// Status-line stamp: time today, date + time otherwise.
function stamp(ms, nowMs) {
  if (!(ms > 0)) return ""
  return localDate(ms) === localDate(nowMs) ? clock(ms) : shortDate(ms) + " " + clock(ms)
}

// Whole calendar days between two timestamps, by local date.
function dayDiff(fromMs, toMs) {
  return Math.round((dateStartMs(localDate(toMs)) - dateStartMs(localDate(fromMs))) / DAY_MS)
}

// "today", "tomorrow", "in 12d", "yesterday", "3d ago".
function relativeDay(ms, nowMs) {
  var diff = dayDiff(nowMs, ms)
  if (diff === 0) return "today"
  if (diff === 1) return "tomorrow"
  if (diff === -1) return "yesterday"
  return diff > 0 ? "in " + diff + "d" : -diff + "d ago"
}

// Coarse age for news and activity rows: "5m", "3h", "2d", then a date.
function age(ms, nowMs) {
  var diff = Math.max(0, nowMs - ms)
  if (diff < 3600000) return Math.max(1, Math.round(diff / 60000)) + "m"
  if (diff < DAY_MS) return Math.round(diff / 3600000) + "h"
  if (diff < 7 * DAY_MS) return Math.round(diff / DAY_MS) + "d"
  return shortDate(ms)
}

// "1 payment", "3 payments".
function plural(count, word) {
  return count + " " + word + (count === 1 ? "" : "s")
}

// Proprietary tickers like AAPL_US_EQ read better as AAPL; European
// listings carry a lowercase exchange letter (VUSAl_EQ → VUSA).
function displayTicker(ticker) {
  var base = String(ticker || "").split("_")[0]
  return /^[A-Z0-9.]+[a-z]$/.test(base) ? base.slice(0, -1) : base
}
