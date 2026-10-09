const test = require("node:test")
const assert = require("node:assert/strict")
const Portfolio = require("./harness").load("Portfolio.js")

const DAY = 86400000

function live(extra) {
  return Object.assign({ currency: "EUR", invested: 1000, value: 1050, pl: 50, realized: 20, cash: 5, pot: 100, total: 1155 }, extra || {})
}

test("parseHistory skips garbage, dedupes dates, sorts, and nulls unknown fields", () => {
  const history = Portfolio.parseHistory([
    '{"date":"2026-08-16","ts":1755300000,"value":100,"invested":90,"pl":10}',
    "not json",
    '{"date":"2026-08-15","ts":1755200000,"value":95,"invested":90,"pl":5,"cash":3}',
    '{"date":"2026-08-16","ts":1755310000,"value":102,"invested":90,"pl":12,"realized":4,"pot":50,"cash":1}',
    '{"date":"2026-08-17","value":"broken"}',
    ""
  ].join("\n"))
  assert.equal(history.length, 2)
  assert.equal(history[0].date, "2026-08-15")
  assert.equal(history[0].realized, null)
  assert.equal(history[0].total, null, "no pot recorded → total unknown")
  assert.equal(history[1].value, 102)
  assert.equal(history[1].ts, 1755310000000)
  assert.equal(history[1].realized, 4)
  assert.equal(history[1].total, 153)
})

test("snapshotLine records return and total, carrying today's opens", () => {
  const first = JSON.parse(Portfolio.snapshotLine("2026-09-29", 1790681343000, live(), null))
  assert.equal(first.open, 1050)
  assert.equal(first.openReturn, 70)
  assert.equal(first.openTotal, 1155)
  assert.equal(first.pot, 100)
  assert.equal(first.realized, 20)
  const entry = Portfolio.parseHistory(JSON.stringify(first))[0]
  const later = JSON.parse(Portfolio.snapshotLine("2026-09-29", 1790690000000, live({ value: 1060, pl: 60, total: 1165 }), entry))
  assert.equal(later.open, 1050)
  assert.equal(later.openReturn, 70)
  assert.equal(later.openTotal, 1155)
  assert.equal(later.value, 1060)
  assert.ok(!Portfolio.snapshotLine("d", 0, live(), null).includes("\n"))
})

test("dailyChange is profit-based: selling or depositing is not a gain", () => {
  // Yesterday: 3000 invested, P/L -200, realized 0. Today everything was
  // sold at that loss, so value collapsed to 0 but P/L didn't move.
  const history = Portfolio.parseHistory('{"date":"2026-09-28","ts":1790600000,"value":2800,"invested":3000,"pl":-200,"realized":0,"cash":0,"pot":0}')
  const today = live({ value: 0, invested: 0, pl: 0, realized: -200, total: 2800, pot: 2800, cash: 0 })
  const change = Portfolio.dailyChange(history, today, "2026-09-29", null)
  assert.equal(change.abs, 0)
  assert.equal(change.pct, 0)
  assert.equal(change.account, 0)
})

test("dailyChange measures return moves against yesterday's close", () => {
  const history = Portfolio.parseHistory('{"date":"2026-09-28","ts":1790600000,"value":1000,"invested":1000,"pl":0,"realized":20,"cash":5,"pot":100}')
  const change = Portfolio.dailyChange(history, live(), "2026-09-29", null)
  assert.equal(change.abs, 50)
  assert.ok(Math.abs(change.pct - 5) < 1e-9)
  assert.equal(change.sinceOpen, false)
  assert.equal(change.account, 1155 - 1105)
})

test("dailyChange prefers yesterday's close over today's own line", () => {
  const history = Portfolio.parseHistory([
    '{"date":"2026-09-28","ts":1790600000,"value":1000,"invested":1000,"pl":0,"realized":20,"cash":5,"pot":100}',
    '{"date":"2026-09-29","ts":1790680000,"value":1050,"open":1049,"pl":50,"realized":20,"openReturn":69,"openTotal":1154,"pot":100}'
  ].join("\n"))
  const change = Portfolio.dailyChange(history, live(), "2026-09-29", null)
  assert.equal(change.sinceOpen, false)
  assert.equal(change.abs, 50)
})

test("dailyChange falls back to realized from fills, then to today's open", () => {
  const legacy = Portfolio.parseHistory('{"date":"2026-09-28","ts":1790600000,"value":1000,"invested":1000,"pl":0}')
  const timeline = Portfolio.realizedTimeline([
    { filled: true, realized: 5, time: 1790500000000 },
    { filled: true, realized: 15, time: 1790650000000 }
  ], 20)
  const withFills = Portfolio.dailyChange(legacy, live(), "2026-09-29", timeline)
  assert.equal(withFills.abs, 70 - 5)
  assert.equal(withFills.account, null)
  const noFills = Portfolio.dailyChange(legacy, live(), "2026-09-29", null)
  assert.equal(noFills.abs, 50)

  const installDay = Portfolio.parseHistory('{"date":"2026-09-29","ts":1790640000,"value":1040,"open":1040,"pl":40,"realized":20,"openReturn":60,"openTotal":1150,"pot":100}')
  const sinceOpen = Portfolio.dailyChange(installDay, live(), "2026-09-29", null)
  assert.equal(sinceOpen.abs, 10)
  assert.equal(sinceOpen.sinceOpen, true)
  assert.equal(sinceOpen.account, 5)

  assert.equal(Portfolio.dailyChange([], live(), "2026-09-29", null), null)
  assert.equal(Portfolio.dailyChange(legacy, null, "2026-09-29", null), null)
})

test("realizedTimeline anchors fills to the live realized figure", () => {
  const t = Portfolio.realizedTimeline([
    { filled: true, realized: 10, time: 1000 },
    { filled: false, realized: 99, time: 1500 },
    { filled: true, realized: -4, time: 2000 },
    { filled: true, realized: null, time: 2500 }
  ], 16)
  assert.equal(t.offset, 10)
  assert.equal(Portfolio.realizedAt(t, 500), 10)
  assert.equal(Portfolio.realizedAt(t, 1000), 20)
  assert.equal(Portfolio.realizedAt(t, 3000), 16)
  assert.equal(Portfolio.realizedTimeline([], 5), null)
  assert.equal(Portfolio.realizedAt(null, 5), null)
})

test("series: return metric stays flat through a sell-off into cash", () => {
  const now = Date.parse("2026-09-29T12:00:00Z")
  const history = Portfolio.parseHistory([
    '{"date":"2026-09-20","ts":' + (now - 9 * DAY) / 1000 + ',"value":3000,"invested":3000,"pl":0}',
    '{"date":"2026-09-21","ts":' + (now - 8 * DAY) / 1000 + ',"value":0,"invested":0,"pl":0}'
  ].join("\n"))
  const timeline = Portfolio.realizedTimeline([{ filled: true, realized: 0, time: now - 8.5 * DAY }], 0)
  const current = live({ value: 1000, invested: 1000, pl: 0, realized: 0 })
  const ret = Portfolio.series(history, current, now, "return", "1M", timeline)
  assert.deepEqual(ret.points.map((p) => p.value), [0, 0, 0])
  assert.equal(ret.changePct, null)
  const value = Portfolio.series(history, current, now, "value", "1M", timeline)
  assert.deepEqual(value.points.map((p) => p.value), [3000, 0, 1000])
})

test("series: account metric skips days before the pot was recorded", () => {
  const now = Date.parse("2026-09-29T12:00:00Z")
  const history = Portfolio.parseHistory([
    '{"date":"2026-09-26","ts":' + (now - 3 * DAY) / 1000 + ',"value":1000,"cash":0}',
    '{"date":"2026-09-28","ts":' + (now - DAY) / 1000 + ',"value":1000,"cash":0,"pot":100,"total":1100}'
  ].join("\n"))
  const s = Portfolio.series(history, live(), now, "account", "ALL", null)
  assert.deepEqual(s.points.map((p) => p.value), [1100, 1155])
  assert.equal(s.changeAbs, 55)
  assert.ok(Math.abs(s.changePct - 5) < 1e-9)
})

test("series: range filtering, today's line superseded by the live point", () => {
  const now = Date.parse("2026-09-29T12:00:00Z")
  const lines = []
  for (let d = 60; d >= 0; d--) {
    const ts = now - d * DAY - 3600000
    const date = new Date(ts)
    const key = date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0")
    lines.push(JSON.stringify({ date: key, ts: ts / 1000, value: 1000 + d, pl: 0, realized: 0, cash: 0, pot: 0 }))
  }
  const history = Portfolio.parseHistory(lines.join("\n"))
  const week = Portfolio.series(history, live(), now, "value", "1W", null)
  assert.equal(week.points.length, 6 + 1)
  assert.equal(week.points[week.points.length - 1].value, 1050)
  const all = Portfolio.series(history, live(), now, "value", "ALL", null)
  assert.equal(all.points.length, 61)
  const empty = Portfolio.series([], null, now, "value", "1M", null)
  assert.equal(empty.points.length, 0)
  assert.equal(empty.changePct, null)
})

test("normalizers fall back to defaults", () => {
  assert.equal(Portfolio.normalizeMetric("bogus"), "return")
  assert.equal(Portfolio.normalizeRange("bogus"), "1M")
  assert.equal(Portfolio.metricTitle("return"), "Total return")
})

const positions = [
  { rawTicker: "NVDA_US_EQ", ticker: "NVDA", name: "Nvidia", value: 200, pl: 5, plPct: 2.5, instrumentCurrency: "USD" },
  { rawTicker: "AVGO_US_EQ", ticker: "AVGO", name: "Broadcom", value: 150, pl: -3, plPct: -2, instrumentCurrency: "USD" },
  { rawTicker: "VUSAl_EQ", ticker: "VUSA", name: "Vanguard", value: 50, pl: 1, plPct: null, instrumentCurrency: "GBX" }
]

test("allocation groups and weights, topGroups folds the tail", () => {
  const byCurrency = Portfolio.allocation(positions, (p) => p.instrumentCurrency)
  assert.equal(byCurrency[0].key, "USD")
  assert.equal(byCurrency[0].value, 350)
  assert.equal(byCurrency[0].weight, 87.5)
  const folded = Portfolio.topGroups(Portfolio.allocation(positions, (p) => p.ticker), 2)
  assert.equal(folded.length, 2)
  assert.equal(folded[1].key, "Other")
  assert.equal(folded[1].value, 200)
  const c = Portfolio.concentration(positions)
  assert.equal(c.count, 3)
  assert.equal(c.top1, 50)
  assert.equal(c.top3, 100)
})

test("movers back out the account-currency move from the percentage", () => {
  const quotes = { NVDA: { changePct: 25 }, AVGO: { changePct: -2 } }
  const list = Portfolio.movers(positions, (p) => quotes[p.ticker] || null)
  assert.equal(list.length, 2)
  assert.equal(list[0].ticker, "NVDA")
  assert.equal(list[0].abs, 40)
})

test("performance and sorting", () => {
  const perf = Portfolio.performance(live(), 3, 1.5)
  assert.equal(perf.gain, 73)
  assert.equal(Portfolio.performance(null, 0, 0), null)

  assert.deepEqual(Portfolio.sortPositions(positions, "pl", null).map((p) => p.ticker), ["NVDA", "VUSA", "AVGO"])
  assert.deepEqual(Portfolio.sortPositions(positions, "name", null).map((p) => p.ticker), ["AVGO", "NVDA", "VUSA"])
  const today = { NVDA: -1, AVGO: 3 }
  assert.deepEqual(Portfolio.sortPositions(positions, "today", (p) => today[p.ticker]).map((p) => p.ticker), ["AVGO", "NVDA", "VUSA"])
  assert.equal(Portfolio.nextSort("name"), "value")
})

test("composition splits the total and skips empty parts", () => {
  const parts = Portfolio.composition(live({ cash: 0.001 }))
  assert.deepEqual(parts.map((p) => p.key), ["Investments", "Spending pot"])
  assert.ok(Math.abs(parts[0].weight - 1050 / 1155 * 100) < 1e-9)
  assert.deepEqual(Portfolio.composition(null), [])
  assert.deepEqual(Portfolio.composition(live({ total: 0 })), [])
})

test("potSeries: recorded pot days, live point replaces today", () => {
  const now = new Date(2026, 8, 20, 15).getTime()
  const history = Portfolio.parseHistory([
    '{"date":"2026-09-18","ts":' + Math.round((now - 2 * DAY) / 1000) + ',"value":1,"cash":5,"pot":null}',
    '{"date":"2026-09-19","ts":' + Math.round((now - DAY) / 1000) + ',"value":1,"cash":5,"pot":90}',
    '{"date":"2026-09-20","ts":' + Math.round((now - 3600000) / 1000) + ',"value":1,"cash":5,"pot":95}'
  ].join("\n"))
  const s = Portfolio.potSeries(history, live(), now)
  assert.deepEqual(s.points.map((p) => p.value), [95, 105])
  assert.equal(s.changeAbs, 10)
  assert.equal(Portfolio.potSeries(history, null, now).points.length, 2)
})
