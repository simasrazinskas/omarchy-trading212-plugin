import QtQuick
import qs.Commons

// Subtle grouped surface for a block of related content.
Rectangle {
  id: root

  required property var theme
  default property alias content: inner.data
  property real padding: Style.space(10)

  implicitHeight: inner.implicitHeight + padding * 2
  radius: Style.cornerRadius
  color: theme.surface
  border.width: 1
  border.color: theme.hairline

  Column {
    id: inner
    x: root.padding
    y: root.padding
    width: root.width - root.padding * 2
    spacing: Style.space(8)
  }
}
