import QtQuick
import qs.Commons
import qs.Ui

// Labeled single-choice setting: caption, a ButtonGroup, optional hint.
Column {
  id: root

  required property var theme
  property string label: ""
  property string hint: ""
  property var options: []
  property string value: ""

  signal picked(string value)

  width: parent ? parent.width : 0
  spacing: Style.space(5)

  Caption { theme: root.theme; text: root.label; width: parent.width }

  ButtonGroup {
    focusable: false
    options: root.options
    value: root.value
    foreground: root.theme.foreground
    accent: root.theme.accent
    fontFamily: root.theme.fontFamily
    fontSize: Style.font.caption
    spacing: Style.space(4)
    onChanged: function(value) { root.picked(value) }
  }

  Note {
    visible: root.hint !== ""
    theme: root.theme
    font.italic: false
    text: root.hint
  }
}
