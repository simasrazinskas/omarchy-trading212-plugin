const test = require("node:test")
const assert = require("node:assert/strict")
const Series = require("./harness").load("Series.js")

test("fromPoints sorts and derives min, max and the change", () => {
  const s = Series.fromPoints([{ ts: 3, value: 90 }, { ts: 1, value: 100 }, { ts: 2, value: 120 }], true)
  assert.deepEqual(s.points.map((p) => p.ts), [1, 2, 3])
  assert.equal(s.min, 90)
  assert.equal(s.max, 120)
  assert.equal(s.changeAbs, -10)
  assert.equal(s.changePct, -10)
  assert.equal(Series.fromPoints([{ ts: 1, value: 0 }, { ts: 2, value: 5 }], true).changePct, null)
  assert.equal(Series.fromPoints([{ ts: 1, value: 1 }, { ts: 2, value: 5 }], false).changePct, null)
  assert.deepEqual(Series.fromPoints([], true), Series.empty())
})

test("nearestIndex maps a pixel to the closest point in time", () => {
  const s = Series.fromPoints([{ ts: 0, value: 1 }, { ts: 10, value: 1 }, { ts: 100, value: 1 }], false)
  assert.equal(Series.nearestIndex(s, 0, 102), 0)
  assert.equal(Series.nearestIndex(s, 15, 102), 1)
  assert.equal(Series.nearestIndex(s, 90, 102), 2)
  assert.equal(Series.nearestIndex(Series.fromPoints([{ ts: 0, value: 1 }], false), 0, 100), -1)
})
