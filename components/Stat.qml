import QtQuick
import qs.Commons

// Label over value, with an optional small line under it. `tone` colors the
// value by sign (P/L); leave it null for neutral amounts.
Column {
  id: root

  required property var theme
  property string label: ""
  property string value: ""
  property string sub: ""
  property var tone: null
  property var subTone: null
  property bool large: false

  spacing: Style.space(3)

  Caption {
    theme: root.theme
    text: root.label
    width: Math.min(implicitWidth, root.width > 0 ? root.width : implicitWidth)
  }

  Text {
    text: root.value
    color: root.tone === null ? root.theme.foreground : root.theme.pl(root.tone)
    font.family: root.theme.fontFamily
    font.pixelSize: root.large ? Style.font.heading : Style.font.body
    font.bold: root.large
  }

  Text {
    visible: root.sub !== ""
    text: root.sub
    color: root.subTone === null ? root.theme.dim : root.theme.pl(root.subTone)
    font.family: root.theme.fontFamily
    font.pixelSize: Style.font.caption
  }
}
