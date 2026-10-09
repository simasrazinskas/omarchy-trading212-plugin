import QtQuick
import qs.Commons

// The panel's palette and type, resolved once from the bar and handed to
// every view. Gains use the theme accent, losses the urgent color, so P/L
// reads correctly on any Omarchy theme; `series(i)` spreads further hues
// around the accent for allocation charts.
QtObject {
  id: theme

  property color foreground: Color.foreground
  property color urgent: Color.urgent
  property color accent: Color.accent
  property string fontFamily: Style.font.family

  readonly property color profit: accent
  // Alpha-dimmed rather than darkened: darkening a dark foreground on a
  // light theme would raise contrast instead of lowering it.
  readonly property color dim: Qt.alpha(foreground, 0.6)
  readonly property color faint: Qt.alpha(foreground, 0.35)
  readonly property color hairline: Qt.alpha(foreground, 0.12)
  readonly property color surface: Qt.alpha(foreground, 0.045)
  readonly property color hover: Qt.alpha(foreground, 0.08)

  function pl(value) {
    return Number(value) >= 0 ? profit : urgent
  }

  function alpha(color, a) {
    return Qt.alpha(color, a)
  }

  function series(index) {
    if (index === 0) return accent
    var hue = accent.hslHue < 0 ? 0.58 : accent.hslHue
    var sat = Math.max(0.45, accent.hslSaturation)
    var light = Math.min(0.72, Math.max(0.5, accent.hslLightness))
    return Qt.hsla((hue + index * 0.137) % 1, sat, index % 2 === 0 ? light : light - 0.08, 1)
  }
}
