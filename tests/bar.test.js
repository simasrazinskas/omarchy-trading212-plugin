const test = require("node:test")
const assert = require("node:assert/strict")
const { load } = require("./harness")
const Bar = load("Bar.js")
const T212 = load("T212.js")

function summaryData() {
  return T212.parseSummary(JSON.stringify({
    currency: "EUR",
    cash: { availableToTrade: 148.02, inPies: 10.5, reservedForOrders: 0 },
    investments: { currentValue: 12772.42, totalCost: 12450.32, unrealizedProfitLoss: 322.1, realizedProfitLoss: 88.4 },
    totalValue: 13430.94
  })).data
}

test("mode ring cycles through all six modes", () => {
  assert.equal(Bar.nextMode("invested"), "daily")
  assert.equal(Bar.nextMode("daily"), "percent")
  assert.equal(Bar.nextMode("percent"), "total")
  assert.equal(Bar.nextMode("total"), "spend")
  assert.equal(Bar.nextMode("spend"), "privacy")
  assert.equal(Bar.nextMode("privacy"), "invested")
  assert.equal(Bar.normalizeMode("bogus"), "invested")
})

test("label renders each mode from summary data", () => {
  const state = { data: summaryData(), spend: 234.5 }
  assert.deepEqual(Bar.label("invested", state), { main: "€12.8k", delta: "+€322", sign: 1 })
  assert.deepEqual(Bar.label("percent", state), { main: "", delta: "+2.6%", sign: 1 })
  assert.deepEqual(Bar.label("total", state), { main: "€13.4k", delta: "", sign: 0 })
  assert.deepEqual(Bar.label("spend", state), { main: "Spent", delta: "€235", sign: 0 })
  assert.deepEqual(Bar.label("spend", { data: summaryData() }), { main: "Spent", delta: "…", sign: 0 })
  assert.deepEqual(Bar.label("privacy", state), { main: "T212", delta: "▲", sign: 1 })
})

test("label renders daily mode with a signed pair and a fallback", () => {
  const state = { data: summaryData(), daily: { abs: 12.4, pct: 0.52, sinceOpen: false } }
  assert.deepEqual(Bar.label("daily", state), { main: "+€12.40", delta: "+0.5%", sign: 1 })
  state.daily = { abs: -8, pct: -0.31, sinceOpen: false }
  assert.equal(Bar.label("daily", state).sign, -1)
  assert.deepEqual(Bar.label("daily", { data: summaryData() }), { main: "1D", delta: "—", sign: 0 })
})

test("label shows a signed loss", () => {
  const data = summaryData()
  data.pl = -500
  data.plPct = -4.0
  assert.deepEqual(Bar.label("invested", { data }), { main: "€12.8k", delta: "-€500", sign: -1 })
  assert.equal(Bar.label("percent", { data }).delta, "-4.0%")
})

test("label covers setup, auth, loading, and error states", () => {
  assert.deepEqual(Bar.label("invested", { keyMissing: true }), { main: "T212", delta: "setup", sign: 0 })
  assert.equal(Bar.label("invested", { authFailed: true }).sign, -1)
  assert.equal(Bar.label("invested", {}).delta, "…")
  assert.equal(Bar.label("invested", { error: "boom" }).delta, "—")
  assert.deepEqual(Bar.verticalLabel({ data: summaryData() }), { main: "212", delta: "▲", sign: 1 })
  assert.deepEqual(Bar.verticalLabel({ keyMissing: true }), { main: "212", delta: "", sign: 0 })
})

test("privacy tooltip and label never contain amounts", () => {
  const state = { data: summaryData(), spend: 99, daily: { abs: 1, pct: 1 } }
  const text = Bar.tooltip("privacy", state, "live")
  assert.ok(!text.replace(/Trading 212/g, "").match(/\d/))
  assert.ok(!text.includes("€"))
  const label = Bar.label("privacy", state)
  assert.ok(!(label.main + label.delta).replace(/T212/g, "").match(/\d/))
})

test("data tooltip includes account split, P/L, today and spend", () => {
  const state = { data: summaryData(), daily: { abs: 12.4, pct: 0.52, sinceOpen: false }, spend: 234.5 }
  const text = Bar.tooltip("invested", state, "demo")
  assert.ok(text.includes("(demo)"))
  assert.ok(text.includes("Account €13,430.94"))
  assert.ok(text.includes("Pot €500.00"))
  assert.ok(text.includes("+€322.10"))
  assert.ok(text.includes("Today +€12.40 (+0.5%)"))
  assert.ok(text.includes("Spent this month €234.50"))
})

test("spend mode distinguishes loading from unavailable", () => {
  const data = { currency: "EUR", value: 1, pl: 0, plPct: 0, total: 1 }
  assert.equal(Bar.label("spend", { data }).delta, "…")
  assert.equal(Bar.label("spend", { data, spendUnavailable: true }).delta, "—")
  assert.equal(Bar.label("spend", { data, spend: 42.5 }).delta, "€42.50")
})
