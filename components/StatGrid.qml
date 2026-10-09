import QtQuick
import qs.Commons

// Equal-width grid of Stat cells: `stats` is [{ label, value, sub?, tone?,
// subTone? }]. Fixed columns keep numbers aligned across rows instead of
// wrapping raggedly like a Flow.
Grid {
  id: root

  required property var theme
  property var stats: []

  columns: 3
  columnSpacing: Style.space(12)
  rowSpacing: Style.space(12)

  readonly property real cellWidth: (width - columnSpacing * (columns - 1)) / columns

  Repeater {
    model: root.stats

    Stat {
      required property var modelData
      width: root.cellWidth
      theme: root.theme
      label: modelData.label
      value: modelData.value
      sub: modelData.sub || ""
      tone: modelData.tone === undefined ? null : modelData.tone
      subTone: modelData.subTone === undefined ? null : modelData.subTone
    }
  }
}
