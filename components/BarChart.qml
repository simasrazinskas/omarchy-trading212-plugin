import QtQuick
import qs.Commons

// Vertical bars over `values: [{ label, value }]`, scaled to the max. The
// hovered bar is exposed as `hoverIndex`; `highlightLast` accents the final
// bar (the current day / month).
Item {
  id: root

  required property var theme
  property var values: []
  property bool highlightLast: true
  property color barColor: theme.accent
  readonly property int hoverIndex: hoverIdx

  property int hoverIdx: -1

  readonly property real maxValue: {
    var m = 0
    for (var i = 0; i < values.length; i++) m = Math.max(m, Number(values[i].value) || 0)
    return m
  }
  readonly property real gap: values.length > 20 ? Style.space(2) : Style.space(4)
  readonly property real barWidth: values.length > 0 ? Math.max(1, (width - gap * (values.length - 1)) / values.length) : 0

  Row {
    anchors.fill: parent
    spacing: root.gap

    Repeater {
      model: root.values

      Item {
        required property var modelData
        required property int index
        width: root.barWidth
        height: root.height

        Rectangle {
          anchors.bottom: parent.bottom
          width: parent.width
          height: root.maxValue > 0 ? Math.max(modelData.value > 0 ? 2 : 1, (Number(modelData.value) || 0) / root.maxValue * parent.height) : 1
          radius: Math.min(2, width / 2)
          color: {
            var hot = index === root.hoverIdx || (root.highlightLast && index === root.values.length - 1)
            if (!(modelData.value > 0)) return root.theme.hairline
            return hot ? root.barColor : Qt.alpha(root.barColor, 0.45)
          }
        }

        MouseArea {
          anchors.fill: parent
          hoverEnabled: true
          onEntered: root.hoverIdx = index
          onExited: if (root.hoverIdx === index) root.hoverIdx = -1
        }
      }
    }
  }
}
