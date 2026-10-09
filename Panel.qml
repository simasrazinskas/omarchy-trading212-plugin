import QtQuick
import QtQuick.Layouts
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "components"
import "views"
import "lib/Format.js" as Format
import "lib/Bar.js" as Bar
import "lib/Icons.js" as Icons

// Trading 212 bar widget. The bar shows one of six display modes (right
// click cycles, middle click refreshes); left click opens a tabbed panel:
// Overview · Holdings · Cash · Activity · Insights, plus Settings.
//
// This file is the host: bar label, panel frame, tab routing, keyboard map
// and IPC. Data lives in Service.qml, presentation in views/, reusable
// pieces in components/, and all pure logic in lib/ (node-tested).
Panel {
  id: root
  moduleName: "io.github.simasrazinskas.trading212"
  ipcTarget: "io.github.simasrazinskas.trading212"
  manageIpc: false

  readonly property var tabs: [
    { value: "overview", label: "Overview", icon: Icons.overview },
    { value: "holdings", label: "Holdings", icon: Icons.chart },
    { value: "cash", label: "Cash", icon: Icons.wallet },
    { value: "activity", label: "Activity", icon: Icons.list },
    { value: "insights", label: "Insights", icon: Icons.insights }
  ]

  // Named handles for the view Components, where a bare `service: service`
  // would resolve to the view's own property rather than the id here.
  readonly property var dataService: service
  readonly property var panelTheme: theme

  property string tab: "overview"
  property bool settingsOpen: false
  property bool setupRequested: false

  readonly property string mode: Bar.normalizeMode(setting("mode", "invested"))
  readonly property bool needsSetup: service.keyMissing || service.authFailed
  readonly property bool setupShown: needsSetup || setupRequested
  readonly property string view: setupShown ? "setup" : settingsOpen ? "settings" : tab
  readonly property bool editorFocused: viewLoader.item && viewLoader.item.editorFocused === true

  readonly property var barState: ({
    keyMissing: service.keyMissing,
    authFailed: service.authFailed,
    error: service.lastError,
    data: service.summary,
    daily: service.daily,
    spend: service.spending ? service.spending.thisMonth.spend : null
  })

  // Vertical bars have no room for amounts: a compact direction badge.
  readonly property var pieces: button.vertical ? Bar.verticalLabel(barState) : Bar.label(mode, barState)

  readonly property string statusText: {
    if (service.keyMissing) return "API KEY REQUIRED"
    if (service.authFailed) return service.lastError.toUpperCase()
    if (service.refreshing) return "REFRESHING…"
    if (service.lastError !== "") return service.lastError.toUpperCase()
    if (service.lastUpdated.getTime() > 0) {
      var parts = [service.environment.toUpperCase(), Bar.modeTitle(mode).toUpperCase(), Format.stamp(service.lastUpdated.getTime(), service.now)]
      if (service.activity.syncing) parts.push("SYNCING")
      return parts.join(" · ")
    }
    return "CONNECTING…"
  }

  Theme {
    id: theme
    foreground: root.bar ? root.bar.foreground : Color.foreground
    urgent: root.bar ? root.bar.urgent : Color.urgent
    accent: Color.accent
    fontFamily: root.bar ? root.bar.fontFamily : Style.font.family
  }

  // ---- Host API used by the views.

  function cycleMode() {
    persistSetting("mode", Bar.nextMode(mode))
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

  function openPosition(rawTicker) {
    if (!rawTicker) return
    selectTab("holdings")
    Qt.callLater(function() {
      if (viewLoader.item && typeof viewLoader.item.open === "function") viewLoader.item.open(rawTicker)
    })
  }

  function openUrl(url) {
    if (/^https:\/\//.test(String(url))) Quickshell.execDetached(["xdg-open", String(url)])
  }

  function showSettings(show) {
    settingsOpen = show
    if (show) setupRequested = false
  }

  function showSetup(show) {
    setupRequested = show
    if (show) Qt.callLater(function() {
      if (viewLoader.item && typeof viewLoader.item.focusEditor === "function") viewLoader.item.focusEditor()
    })
  }

  // Mirrors the clock's format cycling: apply locally for an instant change,
  // then write the same value back through shell.json so it survives shell
  // restarts. The write is debounced so a burst of clicks lands as a single
  // shell.json update of the final value — intermediate writes would race
  // the bar's settings re-injection.
  property var _pendingEntry: null

  function persistSetting(name, value) {
    var entry = { id: root.moduleName }
    for (var key in root.settings) if (key !== "id") entry[key] = root.settings[key]
    entry[name] = value
    root.settings = entry
    _pendingEntry = entry
    persistTimer.restart()
  }

  Timer {
    id: persistTimer
    interval: 400
    repeat: false
    onTriggered: {
      if (!root._pendingEntry) return
      if (root.bar && root.bar.shell && typeof root.bar.shell.updateEntryInline === "function")
        root.bar.shell.updateEntryInline(root.moduleName, root._pendingEntry)
      root._pendingEntry = null
    }
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  onOpenedChanged: if (opened) {
    service.refreshIfStale()
    Qt.callLater(function() {
      if (root.setupShown && viewLoader.item && typeof viewLoader.item.focusEditor === "function") viewLoader.item.focusEditor()
      else keyCatcher.forceActiveFocus()
    })
  }

  Service {
    id: service
    settings: root.settings
    panelOpen: root.opened
  }

  IpcHandler {
    target: root.ipcTarget
    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.toggle() }
    function refresh(): string { service.refreshAll(); return "ok" }
    function sync(): string { service.activity.sync(); return "ok" }
    function setKey(credential: string): string {
      service.storeCredential(credential)
      return service.saveError === "" ? "ok" : service.saveError
    }
    function cycle(): string { root.cycleMode(); return root.mode }
    function mode(): string { return root.mode }
    function tab(name: string): string {
      for (var i = 0; i < root.tabs.length; i++) {
        if (root.tabs[i].value === name) {
          root.selectTab(name)
          root.open()
          return name
        }
      }
      return "unknown tab: " + name
    }
    function position(ticker: string): string {
      var wanted = String(ticker).toUpperCase()
      for (var i = 0; i < service.positions.length; i++) {
        var p = service.positions[i]
        if (p.ticker === wanted || p.rawTicker === ticker) {
          root.open()
          root.openPosition(p.rawTicker)
          return p.rawTicker
        }
      }
      return "not held: " + ticker
    }
    function settings(): string { root.open(); root.showSettings(true); return "ok" }
    function testAlert(): string { service.alerts.sendTest(); return "ok" }
    function status(): string {
      return JSON.stringify({
        environment: service.environment,
        mode: root.mode,
        keyMissing: service.keyMissing,
        authFailed: service.authFailed,
        rateLimited: service.rateLimited,
        refreshing: service.refreshing,
        error: service.lastError,
        updated: service.lastUpdated.getTime() > 0 ? service.lastUpdated.toISOString() : null,
        positions: service.positions.length,
        pies: service.pies.length,
        history: {
          orders: service.activity.store.orders.length,
          dividends: service.activity.store.dividends.length,
          transactions: service.activity.store.transactions.length,
          syncedAt: service.activity.store.syncedAt > 0 ? new Date(service.activity.store.syncedAt).toISOString() : null
        },
        market: {
          enabled: service.market.enabled,
          quotes: Object.keys(service.market.quotes).length,
          paused: service.market.paused
        },
        missingScopes: Object.keys(service.missingScopes)
      })
    }
    // Account numbers as JSON, for scripts. Respects privacy mode.
    function summary(): string {
      if (root.mode === "privacy" || !service.summary) return "{}"
      var s = service.summary
      return JSON.stringify({
        currency: s.currency, total: s.total, investments: s.value, invested: s.invested, pot: s.pot, cash: s.cash,
        pl: s.pl, plPct: s.plPct, realized: s.realized,
        today: service.daily ? { abs: service.daily.abs, pct: service.daily.pct } : null,
        spentThisMonth: service.spending ? service.spending.thisMonth.spend : null
      })
    }
  }

  // ---- Bar button.
  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    labelVisible: false
    hasVisualContent: true
    fixedWidth: vertical ? -1 : labelRow.implicitWidth + scaledHorizontalMargin * 2
    fixedHeight: vertical ? labelRow.implicitHeight + scaledVerticalPadding * 2 : -1
    tooltipText: Bar.tooltip(root.mode, root.barState, service.environment)

    onPressed: function(buttonCode) {
      if (buttonCode === Qt.RightButton) root.cycleMode()
      else if (buttonCode === Qt.MiddleButton) service.refreshAll()
      else root.toggle()
    }

    // Bar text stays in the theme's foreground regardless of P/L direction —
    // the +/- sign carries the direction and the label stays readable on
    // any theme. Only the no-data states (setup, loading) dim the delta.
    Row {
      id: labelRow
      anchors.centerIn: parent
      spacing: root.pieces.main !== "" && root.pieces.delta !== "" ? Style.space(5) : 0

      Text {
        visible: text !== ""
        anchors.verticalCenter: parent.verticalCenter
        text: root.pieces.main
        color: theme.foreground
        font.family: theme.fontFamily
        font.pixelSize: Style.font.body
        renderType: Text.NativeRendering
      }

      Text {
        visible: text !== ""
        anchors.verticalCenter: parent.verticalCenter
        text: root.pieces.delta
        color: service.summary ? theme.foreground : theme.dim
        font.family: theme.fontFamily
        font.pixelSize: Style.font.body
        renderType: Text.NativeRendering
      }
    }
  }

  // ---- Views.
  Component { id: overviewView; OverviewView { service: root.dataService; theme: root.panelTheme; host: root } }
  Component { id: holdingsView; HoldingsView { service: root.dataService; theme: root.panelTheme; host: root } }
  Component { id: cashView; CashView { service: root.dataService; theme: root.panelTheme; host: root } }
  Component { id: activityView; ActivityView { service: root.dataService; theme: root.panelTheme; host: root } }
  Component { id: insightsView; InsightsView { service: root.dataService; theme: root.panelTheme; host: root } }
  Component { id: settingsView; SettingsView { service: root.dataService; theme: root.panelTheme; host: root } }
  Component { id: setupView; SetupView { service: root.dataService; theme: root.panelTheme; host: root } }

  function componentFor(view) {
    if (view === "setup") return setupView
    if (view === "settings") return settingsView
    if (view === "holdings") return holdingsView
    if (view === "cash") return cashView
    if (view === "activity") return activityView
    if (view === "insights") return insightsView
    return overviewView
  }

  // ---- Panel.
  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(500))
    contentHeight: panel.fittedContentHeight(Style.space(720), Style.space(720))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      blocked: root.editorFocused
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onMoveRequested: function(dx, dy) {
        if (dy !== 0 && viewLoader.item) viewLoader.item.move(dy)
        else if (dx !== 0 && !root.setupShown && !root.settingsOpen) root.stepTab(dx)
      }
      onActivateRequested: if (viewLoader.item) viewLoader.item.activate()
      onTextKey: function(text) {
        if (text === "\b" || text === "\u007f") {
          if (viewLoader.item && viewLoader.item.back()) return
          if (root.settingsOpen) root.showSettings(false)
          return
        }
        if (viewLoader.item && viewLoader.item.textKey(text)) return
        var digit = parseInt(text, 10)
        if (digit >= 1 && digit <= root.tabs.length) root.selectTab(root.tabs[digit - 1].value)
        else if (text === "r" || text === "R") service.refreshAll()
        else if (text === ",") root.showSettings(!root.settingsOpen)
      }

      ColumnLayout {
        anchors.fill: parent
        spacing: Style.space(12)

        // ---- Header: title + status, settings and refresh on the right.
        Item {
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
              color: theme.foreground
              font.family: theme.fontFamily
              font.pixelSize: Style.font.title
              font.bold: true
            }

            Text {
              width: parent.width
              text: root.statusText
              color: (service.authFailed || (service.lastError !== "" && !service.refreshing)) ? theme.urgent : theme.dim
              font.family: theme.fontFamily
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
              foreground: theme.foreground
              fontFamily: theme.fontFamily
              onClicked: root.showSettings(!root.settingsOpen)
            }

            PanelActionButton {
              iconText: service.refreshing || service.activity.syncing ? Icons.sync : Icons.refresh
              tooltipText: "Refresh everything (r)"
              foreground: theme.foreground
              fontFamily: theme.fontFamily
              enabled: !service.refreshing
              onClicked: service.refreshAll()
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
              foreground: theme.foreground
              accent: theme.accent
              fontFamily: theme.fontFamily
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
          sourceComponent: root.componentFor(root.view)
        }
      }
    }
  }
}
