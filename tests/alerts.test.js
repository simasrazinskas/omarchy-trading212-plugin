const test = require("node:test")
const assert = require("node:assert/strict")
const Alerts = require("./harness").load("Alerts.js")

const now = new Date(2026, 8, 29, 16).getTime()
const summary = { currency: "EUR" }
const positions = [{ rawTicker: "NVDA_US_EQ", ticker: "NVDA", name: "Nvidia", value: 200 }]

function run(state, log, overrides) {
  return Alerts.evaluate(Object.assign({ summary: summary, positions: positions }, state), log || { seededAt: 0, fired: {} },
    Object.assign(Alerts.settingsFrom({}), overrides || {}), now)
}

test("portfolio move alerts once per threshold band", () => {
  const first = run({ daily: { abs: -50, pct: -2.3, sinceOpen: false } })
  assert.equal(first.alerts.length, 1)
  assert.ok(first.alerts[0].title.includes("down"))
  assert.equal(first.alerts[0].urgency, "critical")
  assert.equal(run({ daily: { abs: -50, pct: -2.9, sinceOpen: false } }, first.log).alerts.length, 0)
  assert.equal(run({ daily: { abs: -90, pct: -4.1, sinceOpen: false } }, first.log).alerts.length, 1)
  assert.equal(run({ daily: { abs: 5, pct: 0.5, sinceOpen: false } }).alerts.length, 0)
  assert.equal(run({ daily: { abs: 50, pct: 3, sinceOpen: true } }).alerts.length, 0)
})

test("position moves need a fresh regular-session quote", () => {
  const fresh = { NVDA: { changePct: 6.2, marketStatus: "Open", fetchedAt: now } }
  assert.equal(run({ quotes: fresh }).alerts.length, 1)
  const closed = { NVDA: { changePct: 6.2, marketStatus: "Closed", fetchedAt: now } }
  assert.equal(run({ quotes: closed }).alerts.length, 0)
  const small = { NVDA: { changePct: 1, marketStatus: "Open", fetchedAt: now } }
  assert.equal(run({ quotes: small }).alerts.length, 0)
})

test("history alerts seed silently, then fire for new items only", () => {
  const activity = {
    orders: [{ id: "1", filled: true, side: "BUY", ticker: "NVDA", quantity: 1, price: 200, value: 180, realized: null, time: now - 100 * 86400000 }],
    dividends: [{ id: "d0", ticker: "NVDA", amount: 1, time: now - 50 * 86400000 }]
  }
  const seeded = run({ activity: activity, activityLoaded: true })
  assert.equal(seeded.alerts.length, 0)
  assert.equal(seeded.log.seededAt, now)

  activity.orders.unshift({ id: "2", filled: true, side: "SELL", ticker: "NVDA", quantity: 1, price: 210, value: 190, realized: 10, time: now })
  activity.dividends.unshift({ id: "d1", ticker: "NVDA", amount: 0.25, time: now })
  const next = run({ activity: activity, activityLoaded: true }, seeded.log)
  assert.deepEqual(next.alerts.map((a) => a.id).sort(), ["div:d1", "fill:2"])
  assert.ok(next.alerts.find((a) => a.id === "fill:2").body.includes("realized +€10.00"))
  assert.equal(run({ activity: activity, activityLoaded: true }, next.log).alerts.length, 0)
})

test("seeding swallows recent history too, not just old items", () => {
  const activity = {
    orders: [{ id: "y", filled: true, side: "BUY", ticker: "SPCX", quantity: 1, price: 1, value: 1, realized: null, time: now - 20 * 3600000 }],
    dividends: []
  }
  const seeded = run({ activity: activity, activityLoaded: true })
  assert.equal(seeded.alerts.length, 0)
  assert.equal(run({ activity: activity, activityLoaded: true }, seeded.log).alerts.length, 0)
})

test("earnings alerts fire the day before and on the day", () => {
  const tomorrow = new Date(2026, 8, 30).getTime()
  const r = run({ earnings: { NVDA: { time: tomorrow, estimated: false, epsForecast: 2.47 } } })
  assert.equal(r.alerts.length, 1)
  assert.ok(r.alerts[0].title.includes("tomorrow"))
  assert.equal(run({ earnings: { NVDA: { time: tomorrow + 5 * 86400000 } } }).alerts.length, 0)
})

test("disabled alerts and settings parsing", () => {
  assert.equal(run({ daily: { abs: -50, pct: -9, sinceOpen: false } }, null, { enabled: false }).alerts.length, 0)
  const s = Alerts.settingsFrom({ alerts: false, alertPortfolioPct: "3", alertPositionPct: -1 })
  assert.equal(s.enabled, false)
  assert.equal(s.portfolioPct, 3)
  assert.equal(s.positionPct, 5)
  assert.deepEqual(Alerts.parseLog("junk"), { seededAt: 0, fired: {} })
})

test("fired log entries expire", () => {
  const old = { seededAt: 1, fired: { "x": now - 60 * 86400000, "y": now - 86400000 } }
  const r = run({}, old)
  assert.deepEqual(Object.keys(r.log.fired), ["y"])
})
