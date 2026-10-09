const test = require("node:test")
const assert = require("node:assert/strict")
const T212 = require("./harness").load("T212.js")

const summaryPayload = JSON.stringify({
  id: 12345678,
  currency: "EUR",
  cash: { availableToTrade: 148.02, inPies: 10.5, reservedForOrders: 0 },
  investments: { currentValue: 12772.42, totalCost: 12450.32, unrealizedProfitLoss: 322.1, realizedProfitLoss: 88.4 },
  totalValue: 13430.94
})

test("splitFetchOutput recognizes markers", () => {
  assert.equal(T212.splitFetchOutput("__T212_STATUS__ no_key").status, "no_key")
  assert.equal(T212.splitFetchOutput("__T212_STATUS__ curl_error").status, "curl_error")
  assert.equal(T212.splitFetchOutput("garbage with no marker").status, "curl_error")
  assert.equal(T212.splitFetchOutput("{}\n__T212_HTTP__ 000").status, "curl_error")
  const ok = T212.splitFetchOutput('{"a":1}\n__T212_HTTP__ 200')
  assert.equal(ok.status, "http")
  assert.equal(ok.http, 200)
  assert.equal(ok.body, '{"a":1}')
})

test("classify separates auth, scope, rate, network and server failures", () => {
  assert.equal(T212.classify("__T212_STATUS__ no_key").kind, "no_key")
  assert.equal(T212.classify("__T212_STATUS__ curl_error").kind, "network")
  assert.equal(T212.classify("x\n__T212_HTTP__ 401").kind, "auth")
  assert.equal(T212.classify("x\n__T212_HTTP__ 403").kind, "scope")
  assert.equal(T212.classify("\n__T212_HTTP__ 429").kind, "rate")
  assert.equal(T212.classify("\n__T212_HTTP__ 502").kind, "http")
  const ok = T212.classify("[]\n__T212_HTTP__ 200")
  assert.equal(ok.kind, "ok")
  assert.equal(ok.body, "[]")
})

test("parseSummary derives cash, the spending pot and the account total", () => {
  const result = T212.parseSummary(summaryPayload)
  assert.equal(result.ok, true)
  const d = result.data
  assert.equal(d.currency, "EUR")
  assert.equal(d.invested, 12450.32)
  assert.equal(d.value, 12772.42)
  assert.equal(d.pl, 322.1)
  assert.equal(d.realized, 88.4)
  assert.ok(Math.abs(d.plPct - 2.587) < 0.01)
  assert.ok(Math.abs(d.cash - 158.52) < 0.001)
  assert.equal(d.pot, 500)
  assert.equal(d.total, 13430.94)
})

test("parseSummary without totalValue has no pot", () => {
  const d = T212.parseSummary(JSON.stringify({
    currency: "EUR", cash: { availableToTrade: 10 }, investments: { currentValue: 100, totalCost: 90 }
  })).data
  assert.equal(d.pot, 0)
  assert.equal(d.total, 110)
  assert.equal(d.pl, 10)
})

test("parseSummary maps the legacy cash schema and rejects garbage", () => {
  const result = T212.parseSummary(JSON.stringify({ free: 100, invested: 1000, ppl: 50, result: 7, total: 1150, pieCash: 0, blocked: 0 }))
  assert.equal(result.ok, true)
  assert.equal(result.data.value, 1050)
  assert.equal(result.data.total, 1150)
  assert.equal(T212.parseSummary("not json").ok, false)
  assert.equal(T212.parseSummary("{}").ok, false)
})

test("parseCache round-trips a saved summary, old caches included", () => {
  const data = T212.parseSummary(summaryPayload).data
  const result = T212.parseCache(JSON.stringify({ savedAt: "2026-08-18T00:19:04.704Z", data: data }))
  assert.equal(result.ok, true)
  assert.equal(result.savedAtMs, Date.parse("2026-08-18T00:19:04.704Z"))
  assert.equal(result.data.pot, 500)
  assert.equal(result.data.total, 13430.94)
  const old = T212.parseCache(JSON.stringify({ savedAt: "x", data: { invested: 10, value: 12, pl: 2, free: 1, total: 13 } }))
  assert.equal(old.ok, true)
  assert.equal(old.savedAtMs, 0)
  assert.equal(old.data.total, 13)
  assert.equal(T212.parseCache("not json").ok, false)
  assert.equal(T212.parseCache("{}").ok, false)
  assert.equal(T212.parseCache(JSON.stringify({ data: { invested: "x" } })).ok, false)
})

test("parsePositions reads the current schema with identity fields, sorts by value", () => {
  const result = T212.parsePositions(JSON.stringify([
    {
      instrument: { ticker: "AAPL_US_EQ", name: "Apple", currency: "USD", isin: "US0378331005" },
      quantity: 2, averagePricePaid: 180, currentPrice: 190, createdAt: "2026-01-02T10:00:00Z",
      walletImpact: { currency: "EUR", currentValue: 350, totalCost: 330, unrealizedProfitLoss: 20, fxImpact: -3 }
    },
    {
      instrument: { ticker: "VUAAm_EQ", name: "Vanguard S&P 500", currency: "EUR" },
      quantity: 10, averagePricePaid: 90, currentPrice: 95,
      walletImpact: { currency: "EUR", currentValue: 950, totalCost: 900, unrealizedProfitLoss: 50 }
    },
    { instrument: { ticker: "GONE_US_EQ" }, quantity: 0, walletImpact: {} }
  ]))
  assert.equal(result.ok, true)
  assert.equal(result.items.length, 2)
  assert.equal(result.items[0].ticker, "VUAA")
  const apple = result.items[1]
  assert.equal(apple.rawTicker, "AAPL_US_EQ")
  assert.equal(apple.isin, "US0378331005")
  assert.equal(apple.openedAt, Date.parse("2026-01-02T10:00:00Z"))
  assert.equal(apple.fxImpact, -3)
  assert.equal(apple.cost, 330)
  assert.ok(Math.abs(apple.plPct - 6.06) < 0.01)
})

test("parsePositions maps the legacy flat schema", () => {
  const result = T212.parsePositions(JSON.stringify([{ ticker: "AAPL_US_EQ", quantity: 2, averagePrice: 180, currentPrice: 190, ppl: 18.5 }]))
  assert.equal(result.items[0].ticker, "AAPL")
  assert.equal(result.items[0].value, 380)
  assert.equal(result.items[0].pl, 18.5)
})

test("normalizeOrder reads fill, wallet impact, realized P/L and fees", () => {
  const o = T212.normalizeOrder({
    order: {
      id: 57717958483, side: "SELL", status: "FILLED", type: "MARKET", initiatedFrom: "IOS", ticker: "SPCX_US_EQ",
      createdAt: "2026-09-22T00:22:00.000Z", instrument: { ticker: "SPCX_US_EQ", name: "SpaceX", currency: "USD" }
    },
    fill: {
      id: 1, quantity: -7.49175595, price: 152.81, type: "TRADE", filledAt: "2026-09-22T00:22:39.000Z",
      walletImpact: { currency: "EUR", netValue: 996.73, realisedProfitLoss: -0.27, fxRate: 1.1468,
        taxes: [{ name: "CURRENCY_CONVERSION_FEE", quantity: -1.5, currency: "EUR" }] }
    }
  })
  assert.equal(o.id, "57717958483")
  assert.equal(o.side, "SELL")
  assert.equal(o.ticker, "SPCX")
  assert.equal(o.filled, true)
  assert.equal(o.quantity, 7.49175595)
  assert.equal(o.value, 996.73)
  assert.equal(o.realized, -0.27)
  assert.equal(o.fees, 1.5)
  assert.deepEqual(o.feeNames, ["CURRENCY_CONVERSION_FEE"])
  assert.equal(o.time, Date.parse("2026-09-22T00:22:39.000Z"))

  const cancelled = T212.normalizeOrder({ order: { id: 5, side: "BUY", status: "CANCELLED", value: 10, createdAt: "2026-09-01T00:00:00Z", ticker: "X_US_EQ" } })
  assert.equal(cancelled.filled, false)
  assert.equal(cancelled.realized, null)
  assert.equal(cancelled.value, 10)
})

test("normalizeDividend and normalizeTransaction", () => {
  const d = T212.normalizeDividend({ ticker: "NVDA_US_EQ", instrument: { ticker: "NVDA_US_EQ", name: "Nvidia" }, reference: "r1",
    quantity: 1.5, amount: 0.01, grossAmountPerShare: 0.01, paidOn: "2025-10-02T17:12:08.000+03:00", type: "DIVIDEND" })
  assert.equal(d.id, "r1")
  assert.equal(d.ticker, "NVDA")
  assert.equal(d.amount, 0.01)
  assert.equal(d.time, Date.parse("2025-10-02T17:12:08.000+03:00"))

  const w = T212.normalizeTransaction({ type: "WITHDRAW", amount: 12.5, currency: "EUR", reference: "t1", dateTime: "2026-09-27T00:58:33.201Z" })
  assert.equal(w.amount, -12.5)
  assert.equal(w.id, "t1")
  const dep = T212.normalizeTransaction({ type: "DEPOSIT", amount: 100, reference: "t2", dateTime: "2026-09-28T00:00:00Z" })
  assert.equal(dep.amount, 100)
})

test("parsePage reads items and the next cursor path", () => {
  const page = T212.parsePage(JSON.stringify({ items: [{ a: 1 }], nextPagePath: "/api/v0/x?cursor=2" }))
  assert.equal(page.ok, true)
  assert.equal(page.next, "/api/v0/x?cursor=2")
  assert.equal(T212.parsePage(JSON.stringify({ items: [], nextPagePath: null })).next, "")
  assert.equal(T212.parsePage("nope").ok, false)
})

test("parsePies, parsePieDetail and mergePies", () => {
  const list = T212.parsePies(JSON.stringify([
    { id: 1, cash: 0.5, dividendDetails: { gained: 2 }, result: { priceAvgInvestedValue: 100, priceAvgValue: 110, priceAvgResult: 10, priceAvgResultCoef: 0.1 }, status: null },
    { id: 2, cash: 0, result: { priceAvgInvestedValue: 1000, priceAvgValue: 990 } }
  ]))
  assert.equal(list.ok, true)
  assert.equal(list.items[0].id, "2")
  assert.equal(list.items[0].result, -10)
  assert.ok(Math.abs(list.items[1].resultPct - 10) < 1e-9)
  const detail = T212.parsePieDetail(JSON.stringify({
    instruments: [{ ticker: "NVDA_US_EQ", currentShare: 0.3, expectedShare: 0.25, ownedQuantity: 1, result: { priceAvgValue: 30 } },
                  { ticker: "AVGO_US_EQ", currentShare: 0.7, expectedShare: 0.75, ownedQuantity: 2, result: { priceAvgValue: 70 } }],
    settings: { id: 2, name: "Tech", goal: 5000 }
  }))
  assert.equal(detail.name, "Tech")
  assert.equal(detail.instruments[0].ticker, "AVGO")
  assert.equal(detail.instruments[0].currentShare, 70)
  const merged = T212.mergePies(list.items, { "2": detail })
  assert.equal(merged[0].name, "Tech")
  assert.equal(merged[1].name, "Pie 1")
})

test("parsePendingOrders", () => {
  const result = T212.parsePendingOrders(JSON.stringify([
    { id: 9, side: "BUY", type: "LIMIT", status: "NEW", quantity: 2, limitPrice: 100, createdAt: "2026-09-28T00:00:00Z", instrument: { ticker: "INTC_US_EQ", name: "Intel", currency: "USD" } }
  ]))
  assert.equal(result.ok, true)
  assert.equal(result.items[0].ticker, "INTC")
  assert.equal(result.items[0].limitPrice, 100)
  assert.equal(T212.parsePendingOrders("{}").ok, false)
})

test("validateCredential trims and rejects mangled pastes", () => {
  assert.deepEqual(T212.validateCredential("  KEY:SECRET\n"), { ok: true, cred: "KEY:SECRET", error: "" })
  assert.equal(T212.validateCredential("legacy-token").ok, true)
  assert.equal(T212.validateCredential("").ok, false)
  assert.equal(T212.validateCredential("KEY: SECRET").ok, false)
})
