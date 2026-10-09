import QtQuick
import QtQuick.Controls

// Vertical scroll container for a tab's content. `content` children go in a
// Column sized to the view's width; `scrollBy` backs j/k, `reveal` keeps a
// keyboard-selected row on screen.
Flickable {
  id: root

  default property alias content: column.data
  property alias spacing: column.spacing

  contentWidth: width
  contentHeight: column.implicitHeight
  clip: true
  boundsBehavior: Flickable.StopAtBounds
  flickableDirection: Flickable.VerticalFlick
  interactive: contentHeight > height
  ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

  function scrollBy(dy) {
    contentY = Math.max(0, Math.min(Math.max(0, contentHeight - height), contentY + dy))
  }

  function reveal(item) {
    if (!item) return
    var pos = item.mapToItem(column, 0, 0)
    if (pos.y < contentY) contentY = Math.max(0, pos.y - 8)
    else if (pos.y + item.height > contentY + height) contentY = Math.min(Math.max(0, contentHeight - height), pos.y + item.height - height + 8)
  }

  function toTop() {
    contentY = 0
  }

  Column {
    id: column
    width: root.width - 10
  }
}
