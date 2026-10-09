.pragma library
.import "Format.js" as Format

// Trading 212 public API response handling: fetch-script output framing,
// then one normalizer per endpoint. Every normalizer tolerates missing
// fields (the API is beta and has reshaped responses before) and returns
// plain objects the views and the other model files can rely on.

var toNumber = Format.toNumber

// ---- Fetch-output framing. The fetch scripts print the response body, then
//      a trailing "__T212_HTTP__ <code>" line; "__T212_STATUS__ <state>"
//      marks states that never reached the server (missing key, curl error).
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

// Classifies a framed response into what the caller should do with it.
// kind: "ok" | "no_key" | "auth" | "scope" | "rate" | "network" | "http"
function classify(raw) {
  var result = splitFetchOutput(raw)
  if (result.status === "no_key") return { kind: "no_key", http: 0, body: "" }
  if (result.status === "curl_error") return { kind: "network", http: 0, body: "" }
  var http = result.http
  if (http === 401) return { kind: "auth", http: http, body: result.body }
  // 403 is a missing permission scope on an otherwise valid key; it only
  // disables the feature that needs it rather than the whole widget.
  if (http === 403) return { kind: "scope", http: http, body: result.body }
  if (http === 429) return { kind: "rate", http: http, body: "" }
  if (http < 200 || http >= 300) return { kind: "http", http: http, body: result.body }
  return { kind: "ok", http: http, body: result.body }
}

function parseJson(raw) {
  try {
    return { ok: true, value: JSON.parse(String(raw || "")) }
  } catch (error) {
    return { ok: false, value: null }
  }
}

function timeMs(value) {
  if (value === null || value === undefined || value === "") return 0
  var ms = Date.parse(String(value))
  return isFinite(ms) ? ms : 0
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

// ---- /equity/account/summary. `totalValue` is the whole account, which
//      also holds money outside investments and trading cash (the card
//      spending pot). The API reports that only inside the total, so the pot
//      is derived as the remainder. The legacy /equity/account/cash flat
//      shape is still mapped so an old response degrades gracefully.
function summaryData(fields) {
  var cash = fields.free + fields.reserved + fields.pieCash
  var total = fields.totalValue !== null ? fields.totalValue : fields.value + cash
  var pot = Math.max(0, Math.round((total - fields.value - cash) * 100) / 100)
  return {
    currency: fields.currency,
    invested: fields.invested,
    value: fields.value,
    pl: fields.pl,
    plPct: fields.invested > 0 ? (fields.pl / fields.invested) * 100 : null,
    realized: fields.realized,
    free: fields.free,
    reserved: fields.reserved,
    pieCash: fields.pieCash,
    cash: cash,
    pot: pot,
    total: total
  }
}

function parseSummary(raw) {
  var parsed = parseJson(raw)
  if (!parsed.ok) return { ok: false, error: "Could not parse the Trading 212 response" }
  var p = parsed.value
  if (!isObject(p)) return { ok: false, error: "Unexpected Trading 212 response" }

  if (isObject(p.investments)) {
    var cash = isObject(p.cash) ? p.cash : {}
    var invested = toNumber(p.investments.totalCost, 0)
    var value = toNumber(p.investments.currentValue, 0)
    return {
      ok: true,
      data: summaryData({
        currency: String(p.currency || ""),
        invested: invested,
        value: value,
        pl: toNumber(p.investments.unrealizedProfitLoss, value - invested),
        realized: toNumber(p.investments.realizedProfitLoss, 0),
        free: toNumber(cash.availableToTrade, 0),
        reserved: toNumber(cash.reservedForOrders, 0),
        pieCash: toNumber(cash.inPies, 0),
        totalValue: toNumber(p.totalValue, null)
      })
    }
  }

  if (p.invested !== undefined && p.free !== undefined) {
    var legacyInvested = toNumber(p.invested, 0)
    var ppl = toNumber(p.ppl, 0)
    return {
      ok: true,
      data: summaryData({
        currency: "",
        invested: legacyInvested,
        value: legacyInvested + ppl,
        pl: ppl,
        realized: toNumber(p.result, 0),
        free: toNumber(p.free, 0),
        reserved: toNumber(p.blocked, 0),
        pieCash: toNumber(p.pieCash, 0),
        totalValue: toNumber(p.total, null)
      })
    }
  }

  return { ok: false, error: "Unexpected Trading 212 response" }
}

// Disk-cached summary (written on every successful fetch, read at startup)
// so a shell restart shows the last known numbers instantly instead of a
// loading state. Accepts caches written before the pot existed.
function parseCache(raw) {
  var parsed = parseJson(raw)
  if (!parsed.ok || !isObject(parsed.value) || !isObject(parsed.value.data)) return { ok: false }
  var d = parsed.value.data
  if (!isFinite(Number(d.invested)) || !isFinite(Number(d.value))) return { ok: false }
  var savedAtMs = timeMs(parsed.value.savedAt)
  return {
    ok: true,
    savedAtMs: savedAtMs,
    data: summaryData({
      currency: String(d.currency || ""),
      invested: toNumber(d.invested, 0),
      value: toNumber(d.value, 0),
      pl: toNumber(d.pl, 0),
      realized: toNumber(d.realized, 0),
      free: toNumber(d.free, 0),
      reserved: toNumber(d.reserved, 0),
      pieCash: toNumber(d.pieCash, 0),
      totalValue: toNumber(d.total, null)
    })
  }
}

// ---- /equity/positions. Current schema nests `instrument`+`walletImpact`;
//      the legacy /equity/portfolio flat shape is mapped as a fallback.
//      Prices are in the instrument currency, walletImpact in the account's.
function parsePositions(raw) {
  var parsed = parseJson(raw)
  if (!parsed.ok) return { ok: false, error: "Could not parse the Trading 212 positions response", items: [] }
  if (!Array.isArray(parsed.value)) return { ok: false, error: "Unexpected Trading 212 positions response", items: [] }

  var items = []
  for (var i = 0; i < parsed.value.length; i++) {
    var p = parsed.value[i] || {}
    var item = null
    if (isObject(p.instrument)) {
      var wallet = isObject(p.walletImpact) ? p.walletImpact : {}
      var cost = toNumber(wallet.totalCost, 0)
      var pl = toNumber(wallet.unrealizedProfitLoss, toNumber(wallet.currentValue, 0) - cost)
      var rawTicker = String(p.instrument.ticker || "")
      item = {
        rawTicker: rawTicker,
        ticker: Format.displayTicker(rawTicker),
        name: String(p.instrument.name || Format.displayTicker(rawTicker)),
        isin: String(p.instrument.isin || ""),
        instrumentCurrency: String(p.instrument.currency || ""),
        quantity: toNumber(p.quantity, 0),
        quantityInPies: toNumber(p.quantityInPies, 0),
        avgPrice: toNumber(p.averagePricePaid, 0),
        price: toNumber(p.currentPrice, 0),
        openedAt: timeMs(p.createdAt),
        cost: cost,
        value: toNumber(wallet.currentValue, 0),
        pl: pl,
        plPct: cost > 0 ? (pl / cost) * 100 : null,
        fxImpact: toNumber(wallet.fxImpact, null)
      }
    } else if (p.ticker !== undefined) {
      var qty = toNumber(p.quantity, 0)
      var price = toNumber(p.currentPrice, 0)
      var legacyPl = toNumber(p.ppl, 0)
      var legacyValue = qty * price
      item = {
        rawTicker: String(p.ticker),
        ticker: Format.displayTicker(p.ticker),
        name: Format.displayTicker(p.ticker),
        isin: "",
        instrumentCurrency: "",
        quantity: qty,
        quantityInPies: toNumber(p.pieQuantity, 0),
        avgPrice: toNumber(p.averagePrice, 0),
        price: price,
        openedAt: timeMs(p.initialFillDate),
        cost: legacyValue - legacyPl,
        value: legacyValue,
        pl: legacyPl,
        plPct: legacyValue - legacyPl > 0 ? (legacyPl / (legacyValue - legacyPl)) * 100 : null,
        fxImpact: toNumber(p.fxPpl, null)
      }
    }
    if (item && item.quantity !== 0) items.push(item)
  }

  items.sort(function(a, b) { return b.value - a.value })
  return { ok: true, items: items }
}

// ---- Paginated /equity/history/* responses: { items, nextPagePath }.
function parsePage(raw) {
  var parsed = parseJson(raw)
  if (!parsed.ok || !isObject(parsed.value) || !Array.isArray(parsed.value.items))
    return { ok: false, items: [], next: "" }
  var next = parsed.value.nextPagePath
  return { ok: true, items: parsed.value.items, next: typeof next === "string" ? next : "" }
}

function instrumentFields(order, instrument) {
  instrument = isObject(instrument) ? instrument : {}
  var rawTicker = String(instrument.ticker || order.ticker || "")
  return {
    rawTicker: rawTicker,
    ticker: Format.displayTicker(rawTicker),
    name: String(instrument.name || Format.displayTicker(rawTicker)),
    isin: String(instrument.isin || ""),
    instrumentCurrency: String(instrument.currency || "")
  }
}

// One historical order + its fill. `value` is the fill's net wallet impact
// in the account currency (always positive; `side` says which way it
// moved), `fees` the sum of the fill's taxes (FX conversion, stamp duty…).
function normalizeOrder(entry) {
  entry = isObject(entry) ? entry : {}
  var order = isObject(entry.order) ? entry.order : entry
  var fill = isObject(entry.fill) ? entry.fill : null
  var wallet = fill && isObject(fill.walletImpact) ? fill.walletImpact : {}
  var taxes = Array.isArray(wallet.taxes) ? wallet.taxes : []
  var fees = 0
  var feeNames = []
  for (var i = 0; i < taxes.length; i++) {
    fees += Math.abs(toNumber(taxes[i] && taxes[i].quantity, 0))
    if (taxes[i] && taxes[i].name) feeNames.push(String(taxes[i].name))
  }
  var inst = instrumentFields(order, order.instrument)
  var quantity = fill ? toNumber(fill.quantity, 0) : toNumber(order.filledQuantity, toNumber(order.quantity, 0))
  var side = String(order.side || (quantity < 0 ? "SELL" : "BUY")).toUpperCase()
  return {
    id: String(order.id !== undefined ? order.id : (fill ? fill.id : "")),
    rawTicker: inst.rawTicker,
    ticker: inst.ticker,
    name: inst.name,
    isin: inst.isin,
    instrumentCurrency: inst.instrumentCurrency,
    side: side,
    status: String(order.status || ""),
    type: String(order.type || ""),
    source: String(order.initiatedFrom || ""),
    fillType: fill ? String(fill.type || "TRADE") : "",
    createdAt: timeMs(order.createdAt),
    time: fill ? timeMs(fill.filledAt) || timeMs(order.createdAt) : timeMs(order.createdAt),
    filled: fill !== null,
    quantity: Math.abs(quantity),
    price: fill ? toNumber(fill.price, 0) : toNumber(order.limitPrice, 0),
    value: Math.abs(toNumber(wallet.netValue, toNumber(order.filledValue, toNumber(order.value, 0)))),
    realized: toNumber(wallet.realisedProfitLoss, null),
    fxRate: toNumber(wallet.fxRate, null),
    fees: Math.round(fees * 100) / 100,
    feeNames: feeNames
  }
}

function normalizeDividend(entry) {
  entry = isObject(entry) ? entry : {}
  var inst = instrumentFields(entry, entry.instrument)
  var paid = timeMs(entry.paidOn)
  return {
    id: String(entry.reference || (inst.rawTicker + ":" + paid)),
    rawTicker: inst.rawTicker,
    ticker: inst.ticker,
    name: inst.name,
    amount: toNumber(entry.amount, 0),
    grossPerShare: toNumber(entry.grossAmountPerShare, null),
    quantity: toNumber(entry.quantity, 0),
    type: String(entry.type || "DIVIDEND"),
    time: paid
  }
}

// Cash movements. `amount` is signed as the API sends it: deposits and
// interest positive, withdrawals and fees negative.
function normalizeTransaction(entry) {
  entry = isObject(entry) ? entry : {}
  var time = timeMs(entry.dateTime)
  var type = String(entry.type || "").toUpperCase()
  var amount = toNumber(entry.amount, 0)
  // Defensive: outflow types are always negative whatever the sign sent.
  if ((type === "WITHDRAW" || type === "FEE") && amount > 0) amount = -amount
  return {
    id: String(entry.reference || (type + ":" + time + ":" + amount)),
    type: type,
    amount: amount,
    currency: String(entry.currency || ""),
    time: time
  }
}

// ---- /equity/orders (pending). Same Order object as the history, no fill.
function parsePendingOrders(raw) {
  var parsed = parseJson(raw)
  if (!parsed.ok || !Array.isArray(parsed.value)) return { ok: false, items: [] }
  var items = []
  for (var i = 0; i < parsed.value.length; i++) {
    var o = parsed.value[i] || {}
    var inst = instrumentFields(o, o.instrument)
    var quantity = toNumber(o.quantity, 0)
    items.push({
      id: String(o.id || ""),
      rawTicker: inst.rawTicker,
      ticker: inst.ticker,
      name: inst.name,
      instrumentCurrency: inst.instrumentCurrency,
      side: String(o.side || (quantity < 0 ? "SELL" : "BUY")).toUpperCase(),
      type: String(o.type || ""),
      status: String(o.status || ""),
      quantity: Math.abs(quantity),
      value: toNumber(o.value, null),
      limitPrice: toNumber(o.limitPrice, null),
      stopPrice: toNumber(o.stopPrice, null),
      createdAt: timeMs(o.createdAt)
    })
  }
  items.sort(function(a, b) { return b.createdAt - a.createdAt })
  return { ok: true, items: items }
}

// ---- /equity/pies (list) and /equity/pies/{id} (detail). The list has no
//      names; they come from the detail call and are merged in by id.
function parsePies(raw) {
  var parsed = parseJson(raw)
  if (!parsed.ok || !Array.isArray(parsed.value)) return { ok: false, items: [] }
  var items = []
  for (var i = 0; i < parsed.value.length; i++) {
    var p = parsed.value[i] || {}
    var result = isObject(p.result) ? p.result : {}
    var dividends = isObject(p.dividendDetails) ? p.dividendDetails : {}
    var invested = toNumber(result.priceAvgInvestedValue, 0)
    var value = toNumber(result.priceAvgValue, 0)
    var coef = toNumber(result.priceAvgResultCoef, null)
    items.push({
      id: String(p.id),
      cash: toNumber(p.cash, 0),
      invested: invested,
      value: value,
      result: toNumber(result.priceAvgResult, value - invested),
      resultPct: coef === null ? (invested > 0 ? ((value - invested) / invested) * 100 : null) : coef * 100,
      dividendsGained: toNumber(dividends.gained, 0),
      dividendsReinvested: toNumber(dividends.reinvested, 0),
      dividendsInCash: toNumber(dividends.inCash, 0),
      progress: toNumber(p.progress, null),
      status: p.status ? String(p.status) : ""
    })
  }
  items.sort(function(a, b) { return b.value - a.value })
  return { ok: true, items: items }
}

function parsePieDetail(raw) {
  var parsed = parseJson(raw)
  if (!parsed.ok || !isObject(parsed.value)) return { ok: false }
  var d = parsed.value
  var settings = isObject(d.settings) ? d.settings : {}
  var instruments = []
  var list = Array.isArray(d.instruments) ? d.instruments : []
  for (var i = 0; i < list.length; i++) {
    var inst = list[i] || {}
    var result = isObject(inst.result) ? inst.result : {}
    instruments.push({
      rawTicker: String(inst.ticker || ""),
      ticker: Format.displayTicker(inst.ticker),
      currentShare: toNumber(inst.currentShare, 0) * 100,
      expectedShare: toNumber(inst.expectedShare, 0) * 100,
      quantity: toNumber(inst.ownedQuantity, 0),
      value: toNumber(result.priceAvgValue, 0),
      result: toNumber(result.priceAvgResult, 0)
    })
  }
  instruments.sort(function(a, b) { return b.currentShare - a.currentShare })
  return {
    ok: true,
    id: String(settings.id !== undefined ? settings.id : ""),
    name: String(settings.name || ""),
    icon: String(settings.icon || ""),
    goal: toNumber(settings.goal, null),
    endDate: timeMs(settings.endDate),
    createdAt: timeMs(settings.creationDate),
    instruments: instruments
  }
}

// Merges pie details (name, goal, composition) into the list rows.
function mergePies(list, details) {
  var out = []
  for (var i = 0; i < list.length; i++) {
    var pie = list[i]
    var detail = details && details[pie.id]
    var merged = {}
    for (var key in pie) merged[key] = pie[key]
    merged.name = detail && detail.name ? detail.name : "Pie " + pie.id
    merged.goal = detail ? detail.goal : null
    merged.instruments = detail ? detail.instruments : []
    out.push(merged)
  }
  return out
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
