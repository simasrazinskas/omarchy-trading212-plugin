const test = require("node:test")
const assert = require("node:assert/strict")
const { load } = require("./harness")
const Activity = load("Activity.js")
const Cash = load("Cash.js")

const now = new Date(2026, 8, 29, 12).getTime()
const H = 3600000

const store = {
  orders: [
    { id: "1", filled: true, side: "BUY", ticker: "NVDA", rawTicker: "NVDA_US_EQ", instrumentCurrency: "USD", quantity: 0.5, price: 200, value: 90, realized: null, fees: 0, source: "AUTOINVEST", time: now - H, fillType: "TRADE" },
    { id: "2", filled: true, side: "SELL", ticker: "INTC", rawTicker: "INTC_US_EQ", instrumentCurrency: "USD", quantity: 2, price: 30, value: 52, realized: 4, fees: 0.1, source: "IOS", time: now - 30 * H, fillType: "TRADE" },
    { id: "3", filled: false, side: "BUY", ticker: "X", rawTicker: "X_US_EQ", quantity: 1, price: 0, value: 5, realized: null, fees: 0, time: now - 2 * H }
  ],
  dividends: [{ id: "d1", ticker: "NVDA", rawTicker: "NVDA_US_EQ", name: "Nvidia", amount: 0.5, quantity: 1, type: "DIVIDEND", time: now - 5 * H }],
  transactions: [
    { id: "t1", type: "WITHDRAW", amount: -12.5, time: now - 3 * H },
    { id: "t2", type: "DEPOSIT", amount: 0.1, time: now - 50 * H }
  ]
}

test("merge dedupes by id, newest first, reports overlap and additions", () => {
  const merged = Activity.merge([{ id: "a", time: 1 }, { id: "b", time: 2 }], [{ id: "b", time: 2, v: 2 }, { id: "c", time: 3 }])
  assert.deepEqual(merged.items.map((i) => i.id), ["c", "b", "a"])
  assert.equal(merged.items[1].v, 2)
  assert.equal(merged.overlap, 1)
  assert.deepEqual(merged.added.map((i) => i.id), ["c"])
})

test("parseStore restores valid rows and survives garbage", () => {
  const restored = Activity.parseStore(JSON.stringify({ orders: [{ id: "1", time: 5 }, { nope: 1 }], syncedAt: 9 }))
  assert.equal(restored.orders.length, 1)
  assert.equal(restored.syncedAt, 9)
  assert.deepEqual(Activity.parseStore("garbage").orders, [])
})

test("timeline merges trades, dividends and cash; skips unfilled orders", () => {
  const rows = Activity.timeline(store, "all", Cash.rulesFrom({}), 0)
  assert.deepEqual(rows.map((r) => r.id), ["o1", "tt1", "dd1", "o2", "tt2"])
  assert.equal(rows[0].amount, -90)
  assert.ok(rows[0].detail.includes("autoinvest"))
  assert.equal(rows[1].category, "spend")
  assert.equal(rows[3].amount, 52)
  assert.equal(Activity.timeline(store, "trades", null, 0).length, 2)
  assert.equal(Activity.timeline(store, "cash", null, 1).length, 1)
})

test("groupByDay adds headers and daily net", () => {
  const groups = Activity.groupByDay(Activity.timeline(store, "all", null, 0), now)
  assert.equal(groups[0].header, "Today")
  assert.equal(groups[0].rows.length, 3)
  assert.ok(Math.abs(groups[0].net - (-90 - 12.5 + 0.5)) < 1e-9)
})

test("dividendStats, tradingStats, forTicker", () => {
  const stats = Activity.dividendStats(store.dividends, now)
  assert.equal(stats.total, 0.5)
  assert.equal(stats.last12m, 0.5)
  assert.equal(stats.byTicker[0].ticker, "NVDA")
  const trading = Activity.tradingStats(store.orders, now)
  assert.equal(trading.buys, 1)
  assert.equal(trading.sells, 1)
  assert.equal(trading.autoinvest, 1)
  assert.ok(Math.abs(trading.fees - 0.1) < 1e-9)
  assert.equal(Activity.forTicker(store.orders, "X_US_EQ", 0).length, 0)
  assert.equal(Activity.forTicker(store.orders, "NVDA_US_EQ", 0).length, 1)
})

test("parseStore keeps backfill cursors and drops junk ones", () => {
  const store = Activity.parseStore(JSON.stringify({ orders: [], cursors: { orders: "/api/v0/x?cursor=9", dividends: "", transactions: 5 } }))
  assert.deepEqual(store.cursors, { orders: "/api/v0/x?cursor=9" })
  assert.deepEqual(Activity.parseStore("junk").cursors, {})
})

test("only sells carry realized P/L in the timeline", () => {
  const store = Activity.emptyStore()
  store.orders = [
    { id: "b", filled: true, side: "BUY", ticker: "A", rawTicker: "A_US_EQ", quantity: 1, price: 1, value: 1, realized: 0, fees: 0, time: 2 },
    { id: "s", filled: true, side: "SELL", ticker: "A", rawTicker: "A_US_EQ", quantity: 1, price: 2, value: 2, realized: 1, fees: 0, time: 1 }
  ]
  const rows = Activity.timeline(store, "trades", null, 0)
  assert.deepEqual(rows.map((r) => r.realized), [null, 1])
})
