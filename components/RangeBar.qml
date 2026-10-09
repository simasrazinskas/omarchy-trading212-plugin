import QtQuick
import qs.Commons

// Where a value sits between a low and a high (52-week range, pie goal
// progress): a track with a marker, and the bounds as captions.
Column {
  id: root

  required property var theme
  property var position: null
  property string lowText: ""
  property string highText: ""
  property bool filled: false

  spacing: Style.space(4)
  visible: position !== null

  Item {
    width: root.width
    height: Style.space(8)

    Rectangle {
      anchors.verticalCenter: parent.verticalCenter
      width: parent.width
      height: Style.space(3)
      radius: height / 2
      color: root.theme.hairline
    }

    Rectangle {
      visible: root.filled
      anchors.verticalCenter: parent.verticalCenter
      width: parent.width * (root.position || 0)
      height: Style.space(3)
      radius: height / 2
      color: root.theme.accent
    }

    Rectangle {
      visible: !root.filled
      x: Math.max(0, Math.min(parent.width - width, parent.width * (root.position || 0) - width / 2))
      anchors.verticalCenter: parent.verticalCenter
      width: Style.space(8)
      height: width
      radius: width / 2
      color: root.theme.accent
    }
  }

  Item {
    width: root.width
    implicitHeight: lowLabel.implicitHeight

    Text {
      id: lowLabel
      text: root.lowText
      color: root.theme.dim
      font.family: root.theme.fontFamily
      font.pixelSize: Style.font.caption
    }

    Text {
      anchors.right: parent.right
      text: root.highText
      color: root.theme.dim
      font.family: root.theme.fontFamily
      font.pixelSize: Style.font.caption
    }
  }
}
