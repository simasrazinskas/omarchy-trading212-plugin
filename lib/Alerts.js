.pragma library
.import "Format.js" as Format
.import "Market.js" as Market

// Desktop-notification rules. Pure decision logic: given the current state
// and the log of what already fired, returns the notifications to send and
// the updated log. Every alert has a stable id, so each event notifies once
// no matter how often it is evaluated.
//
// History-driven alerts (fills, dividends) only fire for items that arrive
// after the log was seeded — the first sync of a years-long history must
// not produce hundreds of notifications.

var DAY_MS = 86400000
var LOG_TTL_MS = 45 * DAY_MS

function defaults() {
  return {
    enabled: true,
    portfolioPct: 2,
    positionPct: 5,
    fills: true,
    dividends: true,
    earnings: true
  }
}

function settingsFrom(raw) {
  raw = raw || {}
  var d = defaults()
  function num(v, fallback) { var n = Number(v); return isFinite(n) && n > 0 ? n : fallback }
  return {
    enabled: raw.alerts === undefined ? d.enabled : raw.alerts === true,
    portfolioPct: num(raw.alertPortfolioPct, d.portfolioPct),
    positionPct: num(raw.alertPositionPct, d.positionPct),
    fills: raw.alertFills === undefined ? d.fills : raw.alertFills === true,
    dividends: raw.alertDividends === undefined ? d.dividends : raw.alertDividends === true,
    earnings: raw.alertEarnings === undefined ? d.earnings : raw.alertEarnings === true
  }
}

function parseLog(raw) {
  var parsed
  try {
    parsed = JSON.parse(String(raw || ""))
  } catch (error) {
    parsed = null
  }
  if (!parsed || typeof parsed !== "object" || typeof parsed.fired !== "object" || parsed.fired === null)
    return { seededAt: 0, fired: {} }
  return { seededAt: Number(parsed.seededAt) || 0, fired: parsed.fired }
}

// state: { summary, daily, positions, quotes, earnings, activity, activityLoaded }
function evaluate(state, log, settings, nowMs) {
  var fired = {}
  for (var id in log.fired) if (nowMs - Number(log.fired[id]) < LOG_TTL_MS) fired[id] = log.fired[id]
  var seededAt = log.seededAt
  var out = []
  var today = Format.localDate(nowMs)
  var symbol = state.summary ? Format.currencySymbol(state.summary.currency) : ""

  function emit(alertId, title, body, urgency) {
    if (fired[alertId] !== undefined) return
    fired[alertId] = nowMs
    out.push({ id: alertId, title: title, body: body, urgency: urgency || "normal" })
  }

  if (!settings.enabled) return { alerts: [], log: { seededAt: seededAt, fired: fired } }

  // Portfolio move: one alert per whole multiple of the threshold, so a
  // 2% day alerts once and a later slide to 4% alerts again.
  var daily = state.daily
  if (daily && daily.pct !== null && !daily.sinceOpen && settings.portfolioPct > 0) {
    var band = Math.floor(Math.abs(daily.pct) / settings.portfolioPct)
    if (band >= 1) {
      var up = daily.pct >= 0
      emit("day:" + today + ":" + (up ? "up" : "down") + ":" + band,
        "Portfolio " + (up ? "up " : "down ") + Format.formatPercent(daily.pct) + " today",
        Format.formatSigned(daily.abs, symbol) + " since yesterday's close",
        up ? "normal" : "critical")
    }
  }

  var positions = state.positions || []
  var quotes = state.quotes || {}
  if (settings.positionPct > 0) {
    for (var i = 0; i < positions.length; i++) {
      var p = positions[i]
      var q = quotes[Market.nasdaqSymbol(p)]
      // Only regular-session quotes from today count; a stale close from
      // Friday must not alert again on Monday morning.
      if (!q || q.changePct === null || !/^open$/i.test(q.marketStatus) || Format.localDate(q.fetchedAt) !== today) continue
      if (Math.abs(q.changePct) < settings.positionPct) continue
      var dir = q.changePct >= 0 ? "up" : "down"
      emit("move:" + p.rawTicker + ":" + today + ":" + dir,
        p.ticker + " " + Format.formatPercent(q.changePct) + " today",
        p.name + " · your position " + Format.formatFull(p.value, symbol))
    }
  }

  var activity = state.activity
  if (state.activityLoaded && activity) {
    if (seededAt === 0) {
      // First complete sync: everything already there is history. Marking
      // it all as fired (not just stamping the seed time) keeps the grace
      // window below from replaying yesterday's fills on the next pass.
      seededAt = nowMs
      for (var s = 0; s < activity.orders.length; s++) if (activity.orders[s].filled) fired["fill:" + activity.orders[s].id] = nowMs
      for (var t = 0; t < activity.dividends.length; t++) fired["div:" + activity.dividends[t].id] = nowMs
    } else {
      if (settings.fills) {
        for (var j = 0; j < activity.orders.length; j++) {
          var o = activity.orders[j]
          if (!o.filled || o.time < seededAt - DAY_MS) continue
          emit("fill:" + o.id,
            (o.side === "SELL" ? "Sold " : "Bought ") + o.ticker,
            Format.formatQuantity(o.quantity) + " @ " + Format.formatFull(o.price, Format.currencySymbol(o.instrumentCurrency))
              + " · " + Format.formatFull(o.value, symbol)
              + (o.realized !== null && o.side === "SELL" ? " · realized " + Format.formatSigned(o.realized, symbol) : ""))
        }
      }
      if (settings.dividends) {
        for (var k = 0; k < activity.dividends.length; k++) {
          var d = activity.dividends[k]
          if (d.time < seededAt - DAY_MS) continue
          emit("div:" + d.id, "Dividend from " + d.ticker, Format.formatFull(d.amount, symbol) + " paid out")
        }
      }
    }
  }

  if (settings.earnings && state.earnings) {
    var tomorrow = Format.localDate(nowMs + DAY_MS)
    for (var m = 0; m < positions.length; m++) {
      var e = state.earnings[Market.nasdaqSymbol(positions[m])]
      if (!e || !(e.time > 0)) continue
      var when = Format.localDate(e.time)
      if (when !== today && when !== tomorrow) continue
      emit("earn:" + positions[m].rawTicker + ":" + when,
        positions[m].ticker + " reports earnings " + (when === today ? "today" : "tomorrow"),
        positions[m].name + (e.estimated ? " (estimated date)" : "")
          + (e.epsForecast !== null ? " · consensus EPS $" + e.epsForecast : ""))
    }
  }

  return { alerts: out, log: { seededAt: seededAt, fired: fired } }
}
