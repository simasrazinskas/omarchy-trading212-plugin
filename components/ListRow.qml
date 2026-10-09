import QtQuick
import qs.Commons
import qs.Ui

// Two-line list row: optional glyph, title + subtitle on the left, value +
// sub-value on the right. `hasCursor` paints the keyboard cursor; the row
// is clickable when `clickable` is set.
Item {
  id: root

  required property var theme
  property string icon: ""
  property color iconColor: theme.dim
  property string title: ""
  property string subtitle: ""
  property string value: ""
  property string subValue: ""
  property var subTone: null
  property var valueTone: null
  property string badge: ""
  property var badgeTone: null
  property bool hasCursor: false
  property bool clickable: false

  signal clicked()

  implicitHeight: Math.max(left.implicitHeight, right.implicitHeight) + Style.space(8)

  CursorSurface {
    anchors.fill: parent
    anchors.leftMargin: -Style.space(6)
    anchors.rightMargin: -Style.space(6)
    hasCursor: root.hasCursor || (root.clickable && mouse.containsMouse)
    foreground: root.theme.foreground
    accent: root.theme.accent
  }

  Text {
    id: glyph
    visible: root.icon !== ""
    anchors.left: parent.left
    anchors.verticalCenter: parent.verticalCenter
    width: visible ? Style.space(20) : 0
    text: root.icon
    color: root.iconColor
    font.family: root.theme.fontFamily
    font.pixelSize: Style.font.icon
  }

  Column {
    id: left
    anchors.left: glyph.right
    anchors.leftMargin: root.icon !== "" ? Style.space(6) : 0
    anchors.right: right.left
    anchors.rightMargin: Style.space(10)
    anchors.verticalCenter: parent.verticalCenter
    spacing: Style.space(2)

    Text {
      width: parent.width
      text: root.title
      color: root.theme.foreground
      font.family: root.theme.fontFamily
      font.pixelSize: Style.font.body
      elide: Text.ElideRight
    }

    Text {
      visible: text !== ""
      width: parent.width
      text: root.subtitle
      color: root.theme.dim
      font.family: root.theme.fontFamily
      font.pixelSize: Style.font.caption
      elide: Text.ElideRight
    }
  }

  Column {
    id: right
    anchors.right: parent.right
    anchors.verticalCenter: parent.verticalCenter
    spacing: Style.space(2)

    Row {
      anchors.right: parent.right
      spacing: Style.space(6)

      Text {
        visible: root.badge !== ""
        anchors.verticalCenter: parent.verticalCenter
        text: root.badge
        color: root.badgeTone === null ? root.theme.dim : root.theme.pl(root.badgeTone)
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.caption
      }

      Text {
        text: root.value
        color: root.valueTone === null ? root.theme.foreground : root.theme.pl(root.valueTone)
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.body
      }
    }

    Text {
      visible: text !== ""
      anchors.right: parent.right
      text: root.subValue
      color: root.subTone === null ? root.theme.dim : root.theme.pl(root.subTone)
      font.family: root.theme.fontFamily
      font.pixelSize: Style.font.caption
    }
  }

  MouseArea {
    id: mouse
    anchors.fill: parent
    enabled: root.clickable
    hoverEnabled: true
    cursorShape: Qt.PointingHandCursor
    onClicked: root.clicked()
  }
}
