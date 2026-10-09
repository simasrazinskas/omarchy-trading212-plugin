import QtQuick
import QtQuick.Layouts
import Quickshell
import qs.Commons
import qs.Ui
import "../components"
import "../lib/Format.js" as Format
import "../lib/Bar.js" as Bar
import "../lib/Icons.js" as Icons

// The panel's contents: header with status line, tab bar, the active view
// and the keyboard map. Hosted by Panel.qml in the bar popup, and by the
// QML smoke test in a plain window.
//
// `panel` is whatever owns the widget's settings: it provides `settings`,
// `setting(name, fallback)`, `persistSetting(name, value)`, `close()` and
// `switchPanel(direction)`. Views receive this Dashboard as their `host`.
//
// A view may implement any of: move(dy), activate(), back() → bool,
// textKey(text) → bool, focusEditor(), and expose `editorFocused`. A view
// without move() scrolls if it is a Scroller.
Item {
  id: root

  required property var panel
  required property var service
  required property var theme
  property string mode: "invested"

  readonly property alias keyCatcher: keyCatcher
  // Full height for the tabs; the short setup form gets just what it needs
  // instead of a mostly empty panel.
  readonly property real fullHeight: Style.space(720)
  implicitHeight: setupShown && viewItem && viewItem.contentHeight > 0
    ? header.implicitHeight + layout.spacing + viewItem.contentHeight
    : fullHeight
  readonly property var settings: panel.settings

  readonly property var tabs: [
    { value: "overview", label: "Overview", icon: Icons.overview },
    { value: "holdings", label: "Holdings", icon: Icons.chart },
    { value: "cash", label: "Cash", icon: Icons.wallet },
    { value: "activity", label: "Activity", icon: Icons.list },
    { value: "insights", label: "Insights", icon: Icons.insights }
  ]

  property string tab: "overview"
  property bool settingsOpen: false
  property bool setupRequested: false

  readonly property bool needsSetup: service.keyMissing || service.authFailed
  readonly property bool setupShown: needsSetup || setupRequested
  readonly property string view: setupShown ? "setup" : settingsOpen ? "settings" : tab
  readonly property var viewItem: viewLoader.item
  readonly property bool editorFocused: viewItem !== null && viewItem.editorFocused === true

  readonly property string statusText: {
    if (service.keyMissing) return "API KEY REQUIRED"
    if (service.authFailed || (service.lastError !== "" && !service.refreshing)) return service.lastError.toUpperCase()
    if (service.refreshing) return "REFRESHING…"
    if (service.lastUpdated.getTime() > 0) {
      var parts = [service.environment.toUpperCase(), Bar.modeTitle(mode).toUpperCase(), Format.stamp(service.lastUpdated.getTime(), service.now)]
      if (service.activity.syncing) parts.push("SYNCING")
      return parts.join(" · ")
    }
    return "CONNECTING…"
  }
  readonly property bool statusIsError: service.authFailed || (service.lastError !== "" && !service.refreshing)

  // ---- Host API for the views.

  function setting(name, fallback) { return panel.setting(name, fallback) }
  function persistSetting(name, value) { panel.persistSetting(name, value) }
  function close() { panel.close() }

  function openUrl(url) {
    if (/^https:\/\//.test(String(url))) Quickshell.execDetached(["xdg-open", String(url)])
  }

  function selectTab(value) {
    settingsOpen = false
    setupRequested = false
    tab = value
  }

  function stepTab(direction) {
    var index = 0
    for (var i = 0; i < tabs.length; i++) if (tabs[i].value === tab) index = i
    selectTab(tabs[(index + direction + tabs.length) % tabs.length].value)
  }

  function hasTab(value) {
    for (var i = 0; i < tabs.length; i++) if (tabs[i].value === value) return true
    return false
  }

  function openPosition(rawTicker) {
    if (!rawTicker) return
    selectTab("holdings")
    Qt.callLater(function() { viewCall("open", rawTicker) })
  }

  function showSettings(show) {
    settingsOpen = show
    if (show) setupRequested = false
  }

  function showSetup(show) {
    setupRequested = show
    if (show) Qt.callLater(function() { viewCall("focusEditor") })
  }

  // Called when the popup opens: the key field when setup is due,
  // otherwise the keyboard map.
  function focusInitial() {
    if (setupShown && viewCall("focusEditor") !== undefined) return
    keyCatcher.forceActiveFocus()
  }

  // Calls an optional view hook; undefined when the view doesn't have it.
  function viewCall(name, arg) {
    var item = viewLoader.item
    if (!item || typeof item[name] !== "function") return undefined
    var result = item[name](arg)
    return result === undefined ? null : result
  }

  function moveView(dy) {
    if (viewCall("move", dy) !== undefined) return
    if (viewItem && typeof viewItem.scrollBy === "function") viewItem.scrollBy(dy * Style.space(48))
  }

  function handleText(text) {
    if (text === "\b" || text === "\u007f") {
      if (viewCall("back") === true) return
      if (settingsOpen) showSettings(false)
      return
    }
    if (viewCall("textKey", text) === true) return
    var digit = parseInt(text, 10)
    if (digit >= 1 && digit <= tabs.length) selectTab(tabs[digit - 1].value)
    else if (text === "r" || text === "R") service.refreshAll()
    else if (text === "," && !needsSetup) showSettings(!settingsOpen)
  }

  // ---- Views.
  Component { id: overviewView; OverviewView { service: root.service; theme: root.theme; host: root } }
  Component { id: holdingsView; HoldingsView { service: root.service; theme: root.theme; host: root } }
  Component { id: cashView; CashView { service: root.service; theme: root.theme; host: root } }
  Component { id: activityView; ActivityView { service: root.service; theme: root.theme; host: root } }
  Component { id: insightsView; InsightsView { service: root.service; theme: root.theme; host: root } }
  Component { id: settingsView; SettingsView { service: root.service; theme: root.theme; host: root } }
  Component { id: setupView; SetupView { service: root.service; theme: root.theme; host: root } }

  readonly property var components: ({
    overview: overviewView,
    holdings: holdingsView,
    cash: cashView,
    activity: activityView,
    insights: insightsView,
    settings: settingsView,
    setup: setupView
  })

  PanelKeyCatcher {
    id: keyCatcher
    anchors.fill: parent
    blocked: root.editorFocused
    onCloseRequested: root.close()
    onTabRequested: function(direction) { root.panel.switchPanel(direction) }
    onMoveRequested: function(dx, dy) {
      if (dy !== 0) root.moveView(dy)
      else if (dx !== 0 && !root.setupShown && !root.settingsOpen) root.stepTab(dx)
    }
    onActivateRequested: root.viewCall("activate")
    onTextKey: function(text) { root.handleText(text) }

    ColumnLayout {
      id: layout
      anchors.fill: parent
      spacing: Style.space(12)

      // ---- Header: title + status, settings and refresh on the right.
      Item {
        id: header
        Layout.fillWidth: true
        implicitHeight: Math.max(heroLabels.implicitHeight, headerButtons.implicitHeight)

        Column {
          id: heroLabels
          anchors.left: parent.left
          anchors.right: headerButtons.left
          anchors.rightMargin: Style.space(12)
          anchors.verticalCenter: parent.verticalCenter
          spacing: Style.space(3)

          Text {
            text: "Trading 212"
            color: root.theme.foreground
            font.family: root.theme.fontFamily
            font.pixelSize: Style.font.title
            font.bold: true
          }

          Text {
            width: parent.width
            text: root.statusText
            color: root.statusIsError ? root.theme.urgent : root.theme.dim
            font.family: root.theme.fontFamily
            font.pixelSize: Style.font.bodySmall
            elide: Text.ElideRight
          }
        }

        Row {
          id: headerButtons
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          spacing: Style.space(4)

          PanelActionButton {
            visible: !root.needsSetup
            iconText: Icons.settings
            tooltipText: "Settings (,)"
            foreground: root.theme.foreground
            fontFamily: root.theme.fontFamily
            onClicked: root.showSettings(!root.settingsOpen)
          }

          PanelActionButton {
            iconText: root.service.refreshing || root.service.activity.syncing ? Icons.sync : Icons.refresh
            tooltipText: "Refresh everything (r)"
            foreground: root.theme.foreground
            fontFamily: root.theme.fontFamily
            enabled: !root.service.refreshing
            onClicked: root.service.refreshAll()
          }
        }
      }

      // ---- Tabs.
      Row {
        id: tabBar
        visible: !root.setupShown && !root.settingsOpen
        Layout.fillWidth: true
        spacing: Style.space(4)

        readonly property real cellWidth: (width - spacing * (root.tabs.length - 1)) / root.tabs.length

        Repeater {
          model: root.tabs

          Button {
            required property var modelData
            required property int index
            width: tabBar.cellWidth
            text: modelData.label
            tooltipText: modelData.label + " (" + (index + 1) + ")"
            selected: root.tab === modelData.value
            bordered: true
            foreground: root.theme.foreground
            accent: root.theme.accent
            fontFamily: root.theme.fontFamily
            fontSize: Style.font.caption
            horizontalPadding: Style.space(4)
            verticalPadding: Style.space(4)
            onClicked: root.selectTab(modelData.value)
          }
        }
      }

      Loader {
        id: viewLoader
        Layout.fillWidth: true
        Layout.fillHeight: true
        sourceComponent: root.components[root.view] || overviewView
      }
    }
  }
}
