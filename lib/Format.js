.pragma library

// Number, money and date formatting shared by every view. Pure JavaScript:
// no Qt or Quickshell globals, so the node test harness runs it unchanged.

// Prefixes for the amount. Letter symbols carry a trailing space so they
// never run into the digits ("kr 1,234.00", "GBX 1,234.00" — pence read
// wrong as a "p" prefix).
var CURRENCY_SYMBOLS = {
  EUR: "€",
  USD: "$",
  GBP: "£",
  GBX: "GBX ",
  CHF: "CHF ",
  PLN: "zł ",
  CZK: "Kč ",
  SEK: "kr ",
  NOK: "kr ",
  DKK: "kr ",
  HUF: "Ft ",
  RON: "lei ",
  JPY: "¥",
  CAD: "C$",
  AUD: "A$",
  BGN: "лв "
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

// Every money formatter rounds to cents *before* picking a sign or a unit,
// so -0.004 reads "€0.00" (not "-€0.00") and 999,999.60 reads "€1M" (not
// "€1000k").

// Panel-precision money: always two decimals, thousands-grouped.
function formatFull(value, symbol) {
  var n = round2(value)
  var parts = Math.abs(n).toFixed(2).split(".")
  return (n < 0 ? "-" : "") + (symbol || "") + groupThousands(parts[0]) + "." + parts[1]
}

// Signed variant for P/L readouts: leading + on gains (and on zero).
function formatSigned(value, symbol) {
  return (round2(value) >= 0 ? "+" : "") + formatFull(value, symbol)
}

function trimZeros(fixed) {
  return fixed.replace(/\.?0+$/, "")
}

// Bar-precision money: cents below 100 (so small P/L never rounds to
// zero), whole units below 10k, then 12.5k / 1.23M.
function formatBar(value, symbol) {
  var n = round2(value)
  var abs = Math.abs(n)
  var prefix = (n < 0 ? "-" : "") + (symbol || "")
  if (Number((abs / 1e3).toFixed(1)) >= 1000) {
    var m = abs / 1e6
    return prefix + (m >= 100 ? Math.round(m) : trimZeros(m.toFixed(2))) + "M"
  }
  if (Math.round(abs) >= 1e4) return prefix + trimZeros((abs / 1e3).toFixed(1)) + "k"
  if (Number(abs.toFixed(2)) < 100) return prefix + abs.toFixed(2)
  return prefix + groupThousands(Math.round(abs))
}

// Signed bar-precision money: explicit + on gains, - on losses.
function formatBarSigned(value, symbol) {
  return (round2(value) >= 0 ? "+" : "") + formatBar(value, symbol)
}

// Signed percentage; two decimals near zero so a small move doesn't read
// as flat. The sign follows the rounded figure: -0.001 is "+0.00%".
function formatPercent(pct) {
  if (pct === null || pct === undefined || !isFinite(Number(pct))) return ""
  var n = Number(pct)
  var fixed = Math.abs(n).toFixed(Math.abs(n) < 0.1 && n !== 0 ? 2 : 1)
  return (n < 0 && Number(fixed) !== 0 ? "-" : "+") + fixed + "%"
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
      return (Math.abs(scaled) >= 100 ? Math.round(scaled) : trimZeros(scaled.toFixed(Math.abs(scaled) >= 10 ? 1 : 2))) + units[i][1]
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

// Copy of `obj` with `key` set to `value` (removed when `value` is
// undefined). QML only notices a var property change on reassignment, so
// map-shaped state is always replaced, never mutated in place.
function withKey(obj, key, value) {
  var out = {}
  for (var k in obj) if (k !== String(key)) out[k] = obj[k]
  if (value !== undefined) out[key] = value
  return out
}
