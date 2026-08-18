const test = require("node:test")
const assert = require("node:assert/strict")
const Model = require("../Model.js")

const summaryPayload = JSON.stringify({
  id: 12345678,
  currency: "EUR",
  cash: { availableToTrade: 148.02, inPies: 10.5, reservedForOrders: 0 },
  investments: {
    currentValue: 12772.42,
    totalCost: 12450.32,
    unrealizedProfitLoss: 322.1,
    realizedProfitLoss: 88.4
  },
  totalValue: 12930.94
})

function summaryData() {
  return Model.parseSummary(summaryPayload).data
}

test("formatBar keeps cents under 100, whole under 10k, compacts above", () => {
  assert.equal(Model.formatBar(99.89, "€"), "€99.89")
  assert.equal(Model.formatBar(9850.12, "€"), "€9,850")
  assert.equal(Model.formatBar(12450.32, "€"), "€12.5k")
  assert.equal(Model.formatBar(1234567, "€"), "€1.23M")
  assert.equal(Model.formatBar(1000000, "€"), "€1M")
  assert.equal(Model.formatBar(1200000, "€"), "€1.2M")
  assert.equal(Model.formatBar(9999.6, "€"), "€10k")
  assert.equal(Model.formatBar(-322.4, "€"), "-€322")
})

test("formatQuantity trims fractional shares, keeps whole counts plain", () => {
  assert.equal(Model.formatQuantity(0.79232076), "0.7923")
  assert.equal(Model.formatQuantity(2), "2")
  assert.equal(Model.formatQuantity(10.5), "10.5")
})

test("formatBarSigned always carries an explicit sign", () => {
  assert.equal(Model.formatBarSigned(0.04, "€"), "+€0.04")
  assert.equal(Model.formatBarSigned(-12.4, "€"), "-€12.40")
  assert.equal(Model.formatBarSigned(322.1, "€"), "+€322")
})

test("formatFull and formatSigned group thousands with two decimals", () => {
  assert.equal(Model.formatFull(12450.325, "€"), "€12,450.33")
  assert.equal(Model.formatFull(-1234.5, "$"), "-$1,234.50")
  assert.equal(Model.formatSigned(322.1, "€"), "+€322.10")
  assert.equal(Model.formatSigned(-12.4, "€"), "-€12.40")
})

test("formatPercent signs values and adds precision near zero", () => {
  assert.equal(Model.formatPercent(2.59), "+2.6%")
  assert.equal(Model.formatPercent(-0.043), "-0.04%")
  assert.equal(Model.formatPercent(null), "")
})

test("currencySymbol maps known codes and falls back to the code", () => {
  assert.equal(Model.currencySymbol("EUR"), "€")
  assert.equal(Model.currencySymbol("gbp"), "£")
  assert.equal(Model.currencySymbol("XYZ"), "XYZ ")
})

test("splitFetchOutput recognizes markers", () => {
  assert.equal(Model.splitFetchOutput("__T212_STATUS__ no_key").status, "no_key")
  assert.equal(Model.splitFetchOutput("__T212_STATUS__ curl_error").status, "curl_error")
  assert.equal(Model.splitFetchOutput("garbage with no marker").status, "curl_error")
  assert.equal(Model.splitFetchOutput("{}\n__T212_HTTP__ 000").status, "curl_error")

  const ok = Model.splitFetchOutput('{"a":1}\n__T212_HTTP__ 200')
  assert.equal(ok.status, "http")
  assert.equal(ok.http, 200)
  assert.equal(ok.body, '{"a":1}')
})

test("parseSummary reads the current account summary schema", () => {
  const result = Model.parseSummary(summaryPayload)
  assert.equal(result.ok, true)
  assert.equal(result.data.currency, "EUR")
  assert.equal(result.data.invested, 12450.32)
  assert.equal(result.data.value, 12772.42)
  assert.equal(result.data.pl, 322.1)
  assert.ok(Math.abs(result.data.plPct - 2.587) < 0.01)
  assert.equal(result.data.free, 148.02)
  assert.ok(Math.abs(result.data.total - 12930.94) < 0.001)
})

test("parseSummary maps the legacy cash schema", () => {
  const result = Model.parseSummary(JSON.stringify({
    free: 100, invested: 1000, ppl: 50, result: 7, total: 1150, pieCash: 0, blocked: 0
  }))
  assert.equal(result.ok, true)
  assert.equal(result.data.invested, 1000)
  assert.equal(result.data.pl, 50)
  assert.equal(result.data.value, 1050)
  assert.equal(result.data.total, 1150)
})

test("parseSummary rejects garbage", () => {
  assert.equal(Model.parseSummary("not json").ok, false)
  assert.equal(Model.parseSummary("{}").ok, false)
})

test("parsePositions reads the current schema, sorts by value", () => {
  const result = Model.parsePositions(JSON.stringify([
    {
      instrument: { ticker: "AAPL_US_EQ", name: "Apple", currency: "USD" },
      quantity: 2, averagePricePaid: 180, currentPrice: 190,
      walletImpact: { currency: "EUR", currentValue: 350, totalCost: 330, unrealizedProfitLoss: 20 }
    },
    {
      instrument: { ticker: "VUAA_EQ", name: "Vanguard S&P 500", currency: "EUR" },
      quantity: 10, averagePricePaid: 90, currentPrice: 95,
      walletImpact: { currency: "EUR", currentValue: 950, totalCost: 900, unrealizedProfitLoss: 50 }
    }
  ]))
  assert.equal(result.ok, true)
  assert.equal(result.items.length, 2)
  assert.equal(result.items[0].ticker, "VUAA")
  assert.equal(result.items[1].name, "Apple")
  assert.ok(Math.abs(result.items[1].plPct - 6.06) < 0.01)
})

test("parsePositions maps the legacy flat schema", () => {
  const result = Model.parsePositions(JSON.stringify([
    { ticker: "AAPL_US_EQ", quantity: 2, averagePrice: 180, currentPrice: 190, ppl: 18.5 }
  ]))
  assert.equal(result.ok, true)
  assert.equal(result.items[0].ticker, "AAPL")
  assert.equal(result.items[0].value, 380)
  assert.equal(result.items[0].pl, 18.5)
})

test("mode ring cycles through all five modes", () => {
  assert.equal(Model.nextMode("invested"), "daily")
  assert.equal(Model.nextMode("daily"), "percent")
  assert.equal(Model.nextMode("percent"), "total")
  assert.equal(Model.nextMode("total"), "privacy")
  assert.equal(Model.nextMode("privacy"), "invested")
  assert.equal(Model.normalizeMode("bogus"), "invested")
})

test("dailyChange uses the previous close, falling back to today's open", () => {
  const history = Model.parseHistory([
    '{"date":"2026-08-17","ts":1755400000,"value":100,"open":98}',
    '{"date":"2026-08-18","ts":1755500000,"value":103,"open":101}'
  ].join("\n"))

  const vsClose = Model.dailyChange(history, 105, "2026-08-18")
  assert.equal(vsClose.abs, 5)
  assert.ok(Math.abs(vsClose.pct - 5) < 0.001)
  assert.equal(vsClose.sinceOpen, false)

  const installDay = Model.dailyChange(history.slice(1), 105, "2026-08-18")
  assert.equal(installDay.abs, 4)
  assert.equal(installDay.sinceOpen, true)

  assert.equal(Model.dailyChange([], 105, "2026-08-18"), null)
  assert.equal(Model.dailyChange(history, null, "2026-08-18"), null)
})

test("openForDate reads today's open, old lines fall back to their value", () => {
  const history = Model.parseHistory([
    '{"date":"2026-08-17","ts":1755400000,"value":100}',
    '{"date":"2026-08-18","ts":1755500000,"value":103,"open":101}'
  ].join("\n"))
  assert.equal(Model.openForDate(history, "2026-08-18", 999), 101)
  assert.equal(Model.openForDate(history, "2026-08-17", 999), 100)
  assert.equal(Model.openForDate(history, "2026-08-19", 999), 999)
})

test("barLabel renders daily mode with a signed pair and a fallback", () => {
  const state = { data: summaryData(), daily: { abs: 12.4, pct: 0.52, baseline: 12760, sinceOpen: false } }
  assert.deepEqual(Model.barLabel("daily", state), { main: "+€12.40", delta: "+0.5%", sign: 1 })
  state.daily = { abs: -8, pct: -0.31, baseline: 12780, sinceOpen: false }
  assert.equal(Model.barLabel("daily", state).sign, -1)
  assert.deepEqual(Model.barLabel("daily", { data: summaryData() }), { main: "1D", delta: "—", sign: 0 })
})

test("barLabel renders each mode from summary data", () => {
  const state = { data: summaryData() }
  assert.deepEqual(Model.barLabel("invested", state), { main: "€12.8k", delta: "+€322", sign: 1 })
  assert.deepEqual(Model.barLabel("percent", state), { main: "", delta: "+2.6%", sign: 1 })
  assert.deepEqual(Model.barLabel("total", state), { main: "€12.9k", delta: "", sign: 0 })
  assert.deepEqual(Model.barLabel("privacy", state), { main: "T212", delta: "▲", sign: 1 })
})

test("barLabel shows the current worth and a signed loss", () => {
  const data = summaryData()
  data.pl = -500
  data.plPct = -4.0
  const label = Model.barLabel("invested", { data })
  assert.equal(label.main, "€12.8k")
  assert.equal(label.delta, "-€500")
  assert.equal(label.sign, -1)
  assert.equal(Model.barLabel("percent", { data }).delta, "-4.0%")
})

test("barLabel covers setup, auth, loading, and error states", () => {
  assert.deepEqual(Model.barLabel("invested", { keyMissing: true }), { main: "T212", delta: "setup", sign: 0 })
  assert.equal(Model.barLabel("invested", { authFailed: true }).sign, -1)
  assert.equal(Model.barLabel("invested", {}).delta, "…")
  assert.equal(Model.barLabel("invested", { error: "boom" }).delta, "—")
})

test("privacy tooltip and label never contain amounts", () => {
  const state = { data: summaryData() }
  const text = Model.tooltip("privacy", state, "live")
  assert.ok(!text.replace(/Trading 212/g, "").match(/\d/))
  assert.ok(!text.includes("€"))
  const label = Model.barLabel("privacy", state)
  assert.ok(!(label.main + label.delta).replace(/T212/g, "").match(/\d/))
})

test("data tooltip includes invested, value, and P/L", () => {
  const text = Model.tooltip("invested", { data: summaryData() }, "demo")
  assert.ok(text.includes("(demo)"))
  assert.ok(text.includes("€12,450.32"))
  assert.ok(text.includes("+€322.10"))
})

test("data tooltip appends the daily change when available", () => {
  const state = { data: summaryData(), daily: { abs: 12.4, pct: 0.52, baseline: 12760, sinceOpen: false } }
  assert.ok(Model.tooltip("invested", state, "live").includes("Today +€12.40 (+0.5%)"))
  assert.ok(!Model.tooltip("privacy", state, "live").includes("Today"))
})

test("validateCredential trims and rejects mangled pastes", () => {
  assert.deepEqual(Model.validateCredential("  KEY:SECRET\n"), { ok: true, cred: "KEY:SECRET", error: "" })
  assert.equal(Model.validateCredential("legacy-token").ok, true)
  assert.equal(Model.validateCredential("").ok, false)
  assert.equal(Model.validateCredential("KEY: SECRET").ok, false)
})

test("parseCache round-trips a saved summary and rejects garbage", () => {
  const saved = JSON.stringify({ savedAt: "2026-08-18T00:19:04.704Z", data: summaryData() })
  const result = Model.parseCache(saved)
  assert.equal(result.ok, true)
  assert.equal(result.savedAtMs, Date.parse("2026-08-18T00:19:04.704Z"))
  assert.equal(result.data.invested, 12450.32)
  assert.ok(Math.abs(result.data.plPct - 2.587) < 0.01)

  assert.equal(Model.parseCache("not json").ok, false)
  assert.equal(Model.parseCache("{}").ok, false)
  assert.equal(Model.parseCache(JSON.stringify({ data: { invested: "x" } })).ok, false)
})

test("parseHistory skips garbage, dedupes dates, sorts by time", () => {
  const raw = [
    '{"date":"2026-08-16","ts":1755300000,"value":100,"invested":90,"pl":10}',
    "not json",
    '{"date":"2026-08-15","ts":1755200000,"value":95,"invested":90,"pl":5}',
    '{"date":"2026-08-16","ts":1755310000,"value":102,"invested":90,"pl":12}',
    '{"date":"2026-08-17","value":"broken"}',
    ""
  ].join("\n")
  const history = Model.parseHistory(raw)
  assert.equal(history.length, 2)
  assert.equal(history[0].date, "2026-08-15")
  assert.equal(history[1].value, 102)
  assert.equal(history[1].ts, 1755310000000)
})

test("graphSeries appends the live point and computes the period change", () => {
  const history = Model.parseHistory([
    '{"date":"2026-08-15","ts":1755200000,"value":100}',
    '{"date":"2026-08-16","ts":1755300000,"value":110}'
  ].join("\n"))
  const series = Model.graphSeries(history, 121, 1755400000000)
  assert.equal(series.points.length, 3)
  assert.equal(series.points[2].value, 121)
  assert.equal(series.points[2].date, "")
  assert.equal(series.min, 100)
  assert.equal(series.max, 121)
  assert.equal(series.changeAbs, 21)
  assert.ok(Math.abs(series.changePct - 21) < 0.001)

  const empty = Model.graphSeries([], null, 0)
  assert.equal(empty.points.length, 0)
  assert.equal(empty.changePct, null)
})

test("snapshotLine is single-line JSON with rounded values and the open", () => {
  const line = Model.snapshotLine("2026-08-18", 1755500000000, summaryData(), 12700.456)
  assert.ok(!line.includes("\n"))
  const parsed = JSON.parse(line)
  assert.equal(parsed.date, "2026-08-18")
  assert.equal(parsed.invested, 12450.32)
  assert.equal(parsed.cash, 158.52)
  assert.equal(parsed.open, 12700.46)
  const noOpen = JSON.parse(Model.snapshotLine("2026-08-18", 1755500000000, summaryData()))
  assert.equal(noOpen.open, 12772.42)
})
