import QtQuick
import qs.Commons

// Area line chart over { points: [{ ts, value }], min, max, firstTs, lastTs }.
// Time is the x axis, so gaps between snapshots stay proportional. Hovering
// exposes the nearest point as `hoverIndex`; `sparkline` drops the fill,
// hover and padding for inline use.
Item {
  id: root

  required property var theme
  property var series: ({ points: [], min: 0, max: 0, firstTs: 0, lastTs: 0 })
  // Sign that picks the line color (gain/loss); null draws in accent.
  property var tone: null
  // Optional reference level drawn as a dashed line when in range (0 for
  // P/L series, the average buy price for a holding).
  property var referenceLevel: null
  property bool sparkline: false
  readonly property int hoverIndex: hoverIdx
  readonly property var hoverPoint: hoverIdx >= 0 && hoverIdx < series.points.length ? series.points[hoverIdx] : null

  property int hoverIdx: -1

  readonly property color lineColor: tone === null ? theme.accent : theme.pl(tone)

  function xFor(ts, w) {
    var span = series.lastTs - series.firstTs
    if (span <= 0) span = 1
    return (ts - series.firstTs) / span * (w - 2) + 1
  }

  function nearest(x) {
    var pts = series.points
    if (pts.length < 2) return -1
    var best = -1
    var bestDist = 1e9
    for (var i = 0; i < pts.length; i++) {
      var dist = Math.abs(xFor(pts[i].ts, width) - x)
      if (dist < bestDist) {
        best = i
        bestDist = dist
      }
    }
    return best
  }

  Canvas {
    id: canvas
    anchors.fill: parent

    onPaint: {
      var ctx = getContext("2d")
      ctx.clearRect(0, 0, width, height)
      var s = root.series
      var pts = s.points
      if (!pts || pts.length < 2) return

      var padY = root.sparkline ? 2 : 6
      var lo = s.min
      var hi = s.max
      var range = hi - lo
      if (range <= 0) range = Math.max(1, Math.abs(hi) * 0.01)
      function px(ts) { return root.xFor(ts, width) }
      function py(v) { return height - padY - (v - lo) / range * (height - padY * 2) }

      var c = root.lineColor

      if (!root.sparkline) {
        ctx.beginPath()
        ctx.moveTo(px(pts[0].ts), py(pts[0].value))
        for (var i = 1; i < pts.length; i++) ctx.lineTo(px(pts[i].ts), py(pts[i].value))
        ctx.lineTo(px(pts[pts.length - 1].ts), height)
        ctx.lineTo(px(pts[0].ts), height)
        ctx.closePath()
        ctx.fillStyle = Qt.rgba(c.r, c.g, c.b, 0.12)
        ctx.fill()
      }

      // Drawn only when it falls inside the data: stretching the axis to
      // reach a distant reference would flatten the line into noise.
      if (root.referenceLevel !== null && !root.sparkline && root.referenceLevel >= lo && root.referenceLevel <= hi) {
        var by = py(root.referenceLevel)
        ctx.strokeStyle = Qt.rgba(root.theme.foreground.r, root.theme.foreground.g, root.theme.foreground.b, 0.25)
        ctx.lineWidth = 1
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.moveTo(0, by)
        ctx.lineTo(width, by)
        ctx.stroke()
        ctx.setLineDash([])
      }

      ctx.beginPath()
      ctx.moveTo(px(pts[0].ts), py(pts[0].value))
      for (var j = 1; j < pts.length; j++) ctx.lineTo(px(pts[j].ts), py(pts[j].value))
      ctx.strokeStyle = c
      ctx.lineWidth = root.sparkline ? 1.5 : 2
      ctx.lineJoin = "round"
      ctx.stroke()

      var h = root.hoverIdx
      if (h >= 0 && h < pts.length) {
        var hx = px(pts[h].ts)
        var hy = py(pts[h].value)
        ctx.strokeStyle = Qt.rgba(root.theme.foreground.r, root.theme.foreground.g, root.theme.foreground.b, 0.25)
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(hx, 0)
        ctx.lineTo(hx, height)
        ctx.stroke()
        ctx.fillStyle = c
        ctx.beginPath()
        ctx.arc(hx, hy, 3, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    onWidthChanged: requestPaint()
    onHeightChanged: requestPaint()
    onVisibleChanged: if (visible) requestPaint()
  }

  onSeriesChanged: canvas.requestPaint()
  onLineColorChanged: canvas.requestPaint()
  onReferenceLevelChanged: canvas.requestPaint()
  onHoverIdxChanged: canvas.requestPaint()

  Connections {
    target: root.theme
    function onForegroundChanged() { canvas.requestPaint() }
  }

  MouseArea {
    anchors.fill: parent
    enabled: !root.sparkline
    hoverEnabled: true
    onPositionChanged: function(mouse) { root.hoverIdx = root.nearest(mouse.x) }
    onExited: root.hoverIdx = -1
  }
}
