import QtQuick
import qs.Commons

// Dim italic helper / empty-state text.
Text {
  required property var theme
  width: parent ? parent.width : implicitWidth
  color: theme.dim
  font.family: theme.fontFamily
  font.pixelSize: Style.font.caption
  font.italic: true
  wrapMode: Text.Wrap
}
