import QtQuick
import qs.Commons

// Offscreen stand-in for the shell's KeyboardPanel, which needs a Wayland
// layer-shell window. Same API surface as far as Panel.qml uses it; the
// content is parented to a plain Item so it still compiles and binds.
Item {
  id: root

  required property Item anchorItem
  required property QtObject bar
  property var owner: null
  property int padding: Style.spacing.popupPadding
  property int contentWidth: Style.space(280)
  property int contentHeight: Style.space(200)
  property bool open: false
  property Item focusTarget: null
  default property alias contentItem: contentHolder.children

  function close() {}
  function fittedContentWidth(width, cap) { return Math.min(Number(width) || 1, cap > 0 ? cap : Infinity) }
  function fittedContentHeight(implicitHeight, cap) { return Math.min((Number(implicitHeight) || 0) + padding * 2, cap > 0 ? cap : Infinity) }

  Item {
    id: contentHolder
    width: root.contentWidth - root.padding * 2
    height: root.contentHeight - root.padding * 2
  }
}
