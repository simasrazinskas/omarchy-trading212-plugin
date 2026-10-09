import QtQuick
import QtQuick.Window
import Quickshell
import qs.Commons
import qs.Ui
import "plugin" as Plugin
import "plugin/components" as Components
import "plugin/views" as Views
import "plugin/lib/Format.js" as Format

// Driven by tests/qml-smoke: the real Service on fixture data, the real
// Dashboard in a card drawn like the bar popup, and a scripted walk
// through every view. Logs SMOKE_OK at the end, SMOKE_FAILED on the first
// broken expectation.
ShellRoot {
  id: test

  readonly property string captureDir: Quickshell.env("T212_CAPTURE_DIR") || ""
  property int step: 0
  property var panel: null
  property int waited: 0

  // Stands in for Panel.qml: settings storage and the popup controls.
  QtObject {
    id: host
    property var settings: ({ id: "io.github.simasrazinskas.trading212", refreshIntervalSec: 60, environment: "live", mode: "invested" })
    property int switches: 0
    function setting(name, fallback) {
      var v = settings[name]
      return v === undefined || v === null ? fallback : v
    }
    function persistSetting(name, value) { settings = Format.withKey(settings, name, value) }
    function close() {}
    function switchPanel(direction) { switches += 1 }
  }

  Plugin.Service {
    id: service
    settings: host.settings
    panelOpen: true
  }

  Components.Theme { id: appTheme }

  // Named handles: inside the Dashboard a bare `service` would resolve to
  // its own property.
  readonly property var dataService: service
  readonly property var panelTheme: appTheme

  function fail(message) {
    console.error("SMOKE_FAILED: " + message)
    Qt.exit(1)
  }

  function check(condition, message) {
    if (!condition) fail(message)
    return condition
  }

  function capture(name) {
    if (captureDir === "") return
    card.grabToImage(function(result) { result.saveToFile(test.captureDir + "/" + name + ".png") })
  }

  function ready() {
    return service.summary !== null && service.positionsLoaded && service.pies.length === 2
      && service.pies[0].instruments.length > 0 && service.pendingOrders.length === 1
      && service.activity.store.syncedAt > 0 && Object.keys(service.market.quotes).length === 7
      && Object.keys(service.market.charts).length === 7 && Object.keys(service.market.profiles).length === 7
      && service.market.fx !== null && service.market.mood !== null
      && service.history.length > 0 && service.history[service.history.length - 1].date === service.today
  }

  // One entry per tick: each sets up a view, the next checks and captures it.
  // An entry that returns false is retried on the next tick.
  readonly property var script: [
    function() {
      check(Math.abs(service.summary.total - 25389.75) < 0.01, "summary total " + service.summary.total)
      check(service.daily !== null && !service.daily.sinceOpen && service.daily.abs > 0, "daily change vs yesterday's close")
      check(service.spending !== null && service.spending.thisMonth.spend > 0, "spending analysis")
      check(service.positions.length === 9 && service.positions[0].ticker === "VWCE", "positions sorted by value")
      check(service.market.quotes["NVDA"].changePct === 2.84, "quotes come from the fixtures")
      check(service.lastError === "" && !service.keyMissing && !service.authFailed, "no error state: " + service.lastError)
      check(dashboard.view === "overview" && dashboard.statusText.indexOf("LIVE · VALUE + P/L") === 0, "status line: " + dashboard.statusText)
      capture("overview")
    },
    function() { dashboard.handleText("2") },
    function() {
      check(dashboard.view === "holdings", "digit 2 selects Holdings")
      capture("holdings")
    },
    function() {
      dashboard.handleText("s")
      check(host.settings.holdingsSort === "pl", "s cycles the holdings sort")
      host.persistSetting("holdingsSort", "value")
      dashboard.openPosition("NVDA_US_EQ")
    },
    function() {
      var page = dashboard.viewItem.selectedPosition
      if (page === null) return false
      check(page.ticker === "NVDA", "position page opens")
      var news = service.market.news["NVDA_US_EQ"]
      if (news === undefined) return false
      check(news.items.length === 4 && news.items[0].source === "Market Wire", "headlines come from the fixtures")
      capture("position")
    },
    function() {
      dashboard.handleText("\b")
      check(dashboard.view === "holdings" && dashboard.viewItem.selectedPosition === null, "backspace returns to the list")
      var cursor = dashboard.viewItem.cursor
      check(dashboard.viewItem.rows[cursor].ticker === "NVDA", "the cursor stays on the holding just viewed")
      dashboard.moveView(1)
      dashboard.moveView(1)
      dashboard.moveView(-1)
      check(dashboard.viewItem.cursor === cursor + 1, "j/k move the holdings cursor")
      dashboard.selectTab("cash")
    },
    function() { capture("cash") },
    function() {
      dashboard.handleText("c")
      check(host.settings.cashChart === "months", "c toggles the spending chart")
    },
    function() { capture("cash-months") },
    function() {
      host.persistSetting("cashChart", "days")
      dashboard.stepTab(1)
      check(dashboard.view === "activity", "→ steps to Activity")
    },
    function() { capture("activity") },
    function() {
      dashboard.handleText("f")
      check(host.settings.activityFilter === "trades", "f cycles the activity filter")
      host.persistSetting("activityFilter", "all")
      dashboard.selectTab("insights")
    },
    function() { capture("insights") },
    function() {
      dashboard.handleText(",")
      check(dashboard.view === "settings", ", opens Settings")
    },
    function() { capture("settings") },
    function() {
      dashboard.handleText("\b")
      check(dashboard.view === "insights", "backspace leaves Settings")
      dashboard.selectTab("overview")
      host.persistSetting("chartMetric", "account")
    },
    function() { capture("overview-account") },
    function() {
      host.persistSetting("chartMetric", "return")
      service.keyMissing = true
    },
    function() {
      check(dashboard.view === "setup", "missing key shows setup")
      capture("setup")
    },
    function() {
      service.keyMissing = false
      // The demo account has no fixtures: its requests 404, and the live
      // data must not leak into it.
      host.persistSetting("environment", "demo")
    },
    function() {
      if (service.lastError === "") return false
      check(service.environment === "demo" && service.summary === null && service.positions.length === 0, "environment switch clears the account")
      check(service.lastError.indexOf("HTTP 404") !== -1, "demo failure surfaces: " + service.lastError)
      host.persistSetting("environment", "live")
    },
    function() {
      if (service.summary === null) return false
      check(service.lastError === "" && service.environment === "live", "switching back restores live data")
      // The bar host: compiles, and renders its label without a bar.
      var component = Qt.createComponent(Qt.resolvedUrl("plugin/Panel.qml"))
      check(component.status === Component.Ready, "Panel.qml compiles: " + component.errorString())
      test.panel = component.createObject(test, { settings: host.settings })
      check(test.panel !== null, "Panel.qml instantiates")
    },
    function() {
      if (test.panel.dataService.summary === null) return false
      check(test.panel.pieces.main === "€24.3k" && test.panel.pieces.delta === "+€6,488", "bar label: " + JSON.stringify(test.panel.pieces))
      test.panel.cycleMode()
      check(test.panel.mode === "daily", "right click cycles the mode")
      console.log("SMOKE_OK")
      Qt.quit()
    }
  ]

  Timer {
    interval: 700
    running: true
    repeat: true
    onTriggered: {
      if (test.step === 0) {
        if (!test.ready()) {
          test.waited += interval
          if (test.waited > 60000) test.fail("data never became ready")
          return
        }
      }
      // A step returning false isn't ready yet and runs again next tick.
      if (test.script[test.step]() === false) {
        test.waited += interval
        if (test.waited > 60000) test.fail("step " + test.step + " never became ready")
        return
      }
      test.waited = 0
      test.step += 1
    }
  }

  Window {
    width: card.width
    height: card.height
    visible: true
    color: Color.background

    BorderSurface {
      id: card
      width: dashboard.width + contentLeftInset + contentRightInset
      height: dashboard.implicitHeight + contentTopInset + contentBottomInset
      color: Color.popups.background
      borderSpec: Border.surfaceSpec("popups", "border", Color.popups.border, Math.max(1, Style.space(2)))
      padding: Style.spacing.popupPadding
      radius: Style.cornerRadius

      Views.Dashboard {
        id: dashboard
        x: card.contentLeftInset
        y: card.contentTopInset
        width: Style.space(500)
        height: implicitHeight
        panel: host
        service: test.dataService
        theme: test.panelTheme
        mode: host.setting("mode", "invested")
      }
    }
  }
}
