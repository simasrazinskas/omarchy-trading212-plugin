import QtQuick
import qs.Commons

// Small uppercase section / stat label.
Text {
  required property var theme
  color: theme.dim
  font.family: theme.fontFamily
  font.pixelSize: Style.font.caption
  font.letterSpacing: 1
  font.capitalization: Font.AllUppercase
  elide: Text.ElideRight
}
