.pragma library

// Chart series shared by every line chart: `points` ascending by time plus
// the stats the charts and their captions read.
//   { points: [{ ts, value, date? }], min, max, firstTs, lastTs,
//     changeAbs, changePct }

function empty() {
  return { points: [], min: 0, max: 0, firstTs: 0, lastTs: 0, changeAbs: 0, changePct: null }
}

// `withPct` adds the first-to-last change as a percentage; leave it off for
// metrics without a natural denominator (a P/L can start at zero or below).
function fromPoints(points, withPct) {
  var pts = points.slice()
  pts.sort(function(a, b) { return a.ts - b.ts })
  if (pts.length === 0) return empty()
  var min = pts[0].value
  var max = pts[0].value
  for (var i = 1; i < pts.length; i++) {
    min = Math.min(min, pts[i].value)
    max = Math.max(max, pts[i].value)
  }
  var first = pts[0].value
  var last = pts[pts.length - 1].value
  return {
    points: pts,
    min: min,
    max: max,
    firstTs: pts[0].ts,
    lastTs: pts[pts.length - 1].ts,
    changeAbs: last - first,
    changePct: withPct && first > 0 ? ((last - first) / first) * 100 : null
  }
}

// Horizontal pixel of a timestamp in a chart `width` wide (1 px inset).
function xFor(series, ts, width) {
  var span = series.lastTs - series.firstTs
  if (span <= 0) span = 1
  return (ts - series.firstTs) / span * (width - 2) + 1
}

// Index of the point nearest to pixel `x`, or -1 for a series too short
// to hover.
function nearestIndex(series, x, width) {
  var pts = series.points
  if (!pts || pts.length < 2) return -1
  var best = -1
  var bestDist = Infinity
  for (var i = 0; i < pts.length; i++) {
    var dist = Math.abs(xFor(series, pts[i].ts, width) - x)
    if (dist < bestDist) {
      best = i
      bestDist = dist
    }
  }
  return best
}
