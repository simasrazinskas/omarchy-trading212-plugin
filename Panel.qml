import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "components"
import "views"
import "lib/Bar.js" as Bar

// Trading 212 bar widget. The bar shows one of six display modes (right
// click cycles, middle click refreshes); left click opens a tabbed panel:
// Overview · Holdings · Cash · Activity · Insights, plus Settings.
//
// This file is the host: bar label, settings persistence, the popup frame
// and IPC. The panel's contents are views/Dashboard.qml, data lives in
// Service.qml, reusable pieces in components/, and all pure logic in lib/
// (node-tested).
Panel {
  id: root
  moduleName: "io.github.simasrazinskas.trading212"
  ipcTarget: "io.github.simasrazinskas.trading212"
  manageIpc: false

  readonly property string mode: Bar.normalizeMode(setting("mode", "invested"))

  // Named handles for children, where a bare `service: service` would
  // resolve to the child's own property rather than the id here.
  readonly property var dataService: service
  readonly property var panelTheme: theme

  readonly property var barState: ({
    keyMissing: service.keyMissing,
    authFailed: service.authFailed,
    error: service.lastError,
    data: service.summary,
    daily: service.daily,
    spend: service.spending ? service.spending.thisMonth.spend : null,
    spendUnavailable: service.missingScopes["history:transactions"] === true
  })

  // Vertical bars have no room for amounts: a compact direction badge.
  readonly property var pieces: button.vertical ? Bar.verticalLabel(barState) : Bar.label(mode, barState)

  Theme {
    id: theme
    foreground: root.bar ? root.bar.foreground : Color.foreground
    urgent: root.bar ? root.bar.urgent : Color.urgent
    accent: Color.accent
    fontFamily: root.bar ? root.bar.fontFamily : Style.font.family
  }

  function cycleMode() {
    persistSetting("mode", Bar.nextMode(mode))
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
    Qt.callLater(dashboard.focusInitial)
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
    function setKey(credential: string): string { return service.storeCredential(credential) }
    function cycle(): string { root.cycleMode(); return root.mode }
    function mode(): string { return root.mode }
    function tab(name: string): string {
      if (!dashboard.hasTab(name)) return "unknown tab: " + name
      dashboard.selectTab(name)
      root.open()
      return name
    }
    function position(ticker: string): string {
      var wanted = String(ticker).toUpperCase()
      for (var i = 0; i < service.positions.length; i++) {
        var p = service.positions[i]
        if (p.ticker === wanted || p.rawTicker === ticker) {
          root.open()
          dashboard.openPosition(p.rawTicker)
          return p.rawTicker
        }
      }
      return "not held: " + ticker
    }
    function settings(): string { root.open(); dashboard.showSettings(true); return "ok" }
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

  // ---- Panel.
  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: dashboard.keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(500))
    contentHeight: panel.fittedContentHeight(dashboard.implicitHeight, dashboard.fullHeight)

    Dashboard {
      id: dashboard
      anchors.fill: parent
      panel: root
      service: root.dataService
      theme: root.panelTheme
      mode: root.mode
    }
  }
}
