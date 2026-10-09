const test = require("node:test")
const assert = require("node:assert/strict")
const Cash = require("./harness").load("Cash.js")

const now = new Date(2026, 8, 20, 12).getTime()
function at(y, m, d) { return new Date(y, m - 1, d, 10).getTime() }
function tx(type, amount, time, id) { return { id: id || type + time + amount, type: type, amount: amount, time: time } }

test("classify separates card spend, bank withdrawals, cashback and top-ups", () => {
  const rules = Cash.rulesFrom({})
  assert.equal(Cash.classify(tx("WITHDRAW", -12.4, 0), rules), "spend")
  assert.equal(Cash.classify(tx("WITHDRAW", -20, 0), rules), "spend", "small round amounts are still card payments")
  assert.equal(Cash.classify(tx("WITHDRAW", -1000, 0), rules), "transfer_out")
  assert.equal(Cash.classify(tx("WITHDRAW", -150.5, 0), rules), "spend")
  assert.equal(Cash.classify(tx("DEPOSIT", 0.08, 0), rules), "cashback")
  assert.equal(Cash.classify(tx("DEPOSIT", 500, 0), rules), "topup")
  assert.equal(Cash.classify(tx("FEE", -7, 0), rules), "fee")
  assert.equal(Cash.classify(tx("INTEREST_ON_FREE_CASH", 1.2, 0), rules), "interest")
  assert.equal(Cash.classify(tx("SOMETHING_NEW", 1, 0), rules), "other")
  assert.equal(Cash.classify(tx("WITHDRAW", -50, 0), Cash.rulesFrom({ transferMin: 50 })), "transfer_out")
})

test("analyze builds month, day and pace figures", () => {
  const transactions = [
    tx("WITHDRAW", -10, at(2026, 9, 2)),
    tx("WITHDRAW", -30, at(2026, 9, 18)),
    tx("WITHDRAW", -1000, at(2026, 9, 5)),
    tx("DEPOSIT", 0.45, at(2026, 9, 18)),
    tx("DEPOSIT", 500, at(2026, 9, 1)),
    tx("FEE", -7, at(2026, 9, 3)),
    tx("WITHDRAW", -20, at(2026, 8, 10)),
    tx("WITHDRAW", -60, at(2026, 8, 25)),
    tx("WITHDRAW", -90, at(2026, 7, 3))
  ]
  const orders = [{ fees: 1.5, time: at(2026, 9, 10) }, { fees: 0, time: at(2026, 9, 11) }]
  const a = Cash.analyze(transactions, orders, now, Cash.rulesFrom({}))
  assert.equal(a.thisMonth.spend, 40)
  assert.equal(a.thisMonth.count, 2)
  assert.equal(a.thisMonth.biggest.amount, 30)
  assert.equal(a.thisMonth.withdrawals, 1000)
  assert.equal(a.thisMonth.topUps, 500)
  assert.equal(a.thisMonth.cashback, 0.45)
  assert.equal(a.thisMonth.fees, 8.5)
  assert.equal(a.lastMonth.spend, 80)
  assert.equal(a.lastMonthToDate, 20)
  assert.equal(Cash.paceVsLastMonth(a), 100)
  assert.equal(a.months.length, 12)
  assert.equal(a.months[11].key, "2026-09")
  assert.equal(a.months[11].spend, 40)
  assert.equal(a.months[10].spend, 80)
  assert.equal(a.avgMonthly, (80 + 90) / 2)
  assert.equal(a.days.length, 30)
  assert.equal(a.days[29].key, "2026-09-20")
  assert.equal(a.days.find((d) => d.key === "2026-09-18").spend, 30)
  assert.equal(a.largest[0].amount, 60)
  assert.equal(a.totals.spend, 210)
  assert.ok(Math.abs(a.thisMonth.projected - 40 / 20 * 30) < 1e-9)
})

test("analyze on an empty history", () => {
  const a = Cash.analyze([], [], now, Cash.rulesFrom({}))
  assert.equal(a.thisMonth.spend, 0)
  assert.equal(a.avgMonthly, null)
  assert.equal(Cash.paceVsLastMonth(a), null)
  assert.equal(a.cashbackRate, null)
})
