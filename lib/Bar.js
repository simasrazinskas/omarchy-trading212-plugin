.pragma library
.import "Format.js" as Format

// What the bar itself shows: the display-mode ring, the label pieces and
// the hover tooltip. Privacy mode never includes an amount anywhere.

var MODE_RING = ["invested", "daily", "percent", "total", "spend", "privacy"]

function normalizeMode(mode) {
  return MODE_RING.indexOf(String(mode)) === -1 ? MODE_RING[0] : String(mode)
}

function nextMode(mode) {
  var index = MODE_RING.indexOf(normalizeMode(mode))
  return MODE_RING[(index + 1) % MODE_RING.length]
}

function modeTitle(mode) {
  var resolved = normalizeMode(mode)
  if (resolved === "invested") return "Value + P/L"
  if (resolved === "daily") return "Daily change"
  if (resolved === "percent") return "P/L percent"
  if (resolved === "total") return "Account value"
  if (resolved === "spend") return "Spent this month"
  return "Privacy"
}

// Returns { main, delta, sign }; sign is 1 profit, -1 loss/problem, 0
// neutral. state: { keyMissing, authFailed, error, data, daily, spend,
// spendUnavailable }.
function label(mode, state) {
  state = state || {}
  if (state.keyMissing) return { main: "T212", delta: "setup", sign: 0 }
  if (state.authFailed) return { main: "T212", delta: "key ✕", sign: -1 }

  var data = state.data
  if (!data) return { main: "T212", delta: state.error ? "—" : "…", sign: 0 }

  var symbol = Format.currencySymbol(data.currency)
  var sign = data.pl >= 0 ? 1 : -1
  var resolved = normalizeMode(mode)

  if (resolved === "invested")
    return { main: Format.formatBar(data.value, symbol), delta: Format.formatBarSigned(data.pl, symbol), sign: sign }
  if (resolved === "daily") {
    var daily = state.daily
    if (!daily) return { main: "1D", delta: "—", sign: 0 }
    return {
      main: Format.formatBarSigned(daily.abs, symbol),
      delta: daily.pct === null ? "" : Format.formatPercent(daily.pct),
      sign: daily.abs >= 0 ? 1 : -1
    }
  }
  if (resolved === "percent")
    return { main: "", delta: data.plPct === null ? "—" : Format.formatPercent(data.plPct), sign: sign }
  if (resolved === "total")
    return { main: Format.formatBar(data.total, symbol), delta: "", sign: 0 }
  if (resolved === "spend") {
    if (state.spend === null || state.spend === undefined) return { main: "Spent", delta: state.spendUnavailable ? "—" : "…", sign: 0 }
    return { main: "Spent", delta: Format.formatBar(state.spend, symbol), sign: 0 }
  }
  return { main: "T212", delta: data.pl >= 0 ? "▲" : "▼", sign: sign }
}

// Vertical bars have no room for amounts: a compact direction badge.
function verticalLabel(state) {
  var privacy = label("privacy", state)
  return { main: "212", delta: privacy.delta === "▲" || privacy.delta === "▼" ? privacy.delta : "", sign: privacy.sign }
}

function tooltip(mode, state, environment) {
  state = state || {}
  var header = "Trading 212" + (environment === "demo" ? " (demo)" : "")
  var hints = "Left: details · Right: next mode · Middle: refresh"
  if (state.keyMissing) return header + " — API key required. Left-click for setup steps."
  if (state.authFailed) return header + " — API key rejected. Left-click for details."
  if (!state.data) return header + (state.error ? " — " + state.error : " — loading…") + "\n" + hints
  if (normalizeMode(mode) === "privacy") return header + " · Privacy mode\n" + hints

  var data = state.data
  var symbol = Format.currencySymbol(data.currency)
  var lines = [header]
  lines.push("Account " + Format.formatFull(data.total, symbol)
    + " · Investments " + Format.formatFull(data.value, symbol)
    + (data.pot > 0 ? " · Pot " + Format.formatFull(data.pot, symbol) : "")
    + (data.cash > 0 ? " · Cash " + Format.formatFull(data.cash, symbol) : ""))
  var pct = data.plPct === null ? "" : " (" + Format.formatPercent(data.plPct) + ")"
  var daily = state.daily
  lines.push("P/L " + Format.formatSigned(data.pl, symbol) + pct
    + (daily ? " · Today " + Format.formatSigned(daily.abs, symbol) + (daily.pct === null ? "" : " (" + Format.formatPercent(daily.pct) + ")") : "")
    + (state.spend !== null && state.spend !== undefined ? " · Spent this month " + Format.formatFull(state.spend, symbol) : ""))
  lines.push(hints)
  return lines.join("\n")
}
