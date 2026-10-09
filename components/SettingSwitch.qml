import QtQuick
import qs.Commons
import qs.Ui

// Theme-bound labeled toggle row for the settings view.
Toggle {
  required property var theme
  width: parent ? parent.width : 0
  foreground: theme.foreground
  accent: theme.accent
  fontFamily: theme.fontFamily
  titleSize: Style.font.body
}
