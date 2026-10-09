import QtQuick
import qs.Commons
import "../lib/Format.js" as Format

// Stacked horizontal share bar plus a legend: `groups` is
// [{ key, value, weight }] as produced by Portfolio.allocation.
Column {
  id: root

  required property var theme
  property var groups: []
  property string symbol: ""
  property bool showValues: true
  property var labelFor: null

  spacing: Style.space(6)

  Row {
    width: root.width
    height: Style.space(8)
    spacing: 1

    Repeater {
      model: root.groups

      Rectangle {
        required property var modelData
        required property int index
        width: Math.max(1, (root.width - (root.groups.length - 1)) * modelData.weight / 100)
        height: parent.height
        radius: Math.min(2, height / 2)
        color: root.theme.series(index)
      }
    }
  }

  Repeater {
    model: root.groups

    Item {
      required property var modelData
      required property int index
      width: root.width
      implicitHeight: legendLabel.implicitHeight

      Rectangle {
        id: dot
        anchors.verticalCenter: parent.verticalCenter
        width: Style.space(7)
        height: width
        radius: width / 2
        color: root.theme.series(index)
      }

      Text {
        id: legendLabel
        anchors.left: dot.right
        anchors.leftMargin: Style.space(7)
        anchors.right: legendValue.left
        anchors.rightMargin: Style.space(8)
        text: root.labelFor ? root.labelFor(modelData) : modelData.key
        color: root.theme.foreground
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.caption
        elide: Text.ElideRight
      }

      Text {
        id: legendValue
        anchors.right: parent.right
        text: Format.formatWeight(modelData.weight) + (root.showValues ? "  " + Format.formatFull(modelData.value, root.symbol) : "")
        color: root.theme.dim
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.caption
      }
    }
  }
}
