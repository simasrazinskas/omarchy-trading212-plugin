import QtQuick
import Quickshell
import "../lib/Alerts.js" as Alerts
import "../lib/Icons.js" as Icons
import "../lib/Shell.js" as Shell

// Desktop notifications. Re-evaluates the alert rules (lib/Alerts.js)
// shortly after any input changes and sends whatever is new through the
// Omarchy notification helper; clicking a notification opens the panel.
// The fired-log persists so nothing repeats across shell restarts.
Item {
  id: root

  property var service: null
  property var settings: ({})
  property string path: ""

  property var log: null
  readonly property var rules: Alerts.settingsFrom(settings)

  // Any of these moving schedules a re-evaluation.
  readonly property var inputs: service ? [
    service.daily,
    service.market.quotes,
    service.market.earnings,
    service.activity.revision,
    rules
  ] : []

  // Throttled rather than debounced: quotes stream in steadily while the
  // panel is open, and a restarting timer would never get to fire.
  onInputsChanged: if (!debounce.running) debounce.start()
  onPathChanged: log = null

  function evaluate() {
    if (!service || log === null || !service.summary) return
    var result = Alerts.evaluate({
      summary: service.summary,
      daily: service.daily,
      positions: service.positions,
      quotes: service.market.quotes,
      earnings: service.market.earnings,
      activity: service.activity.store,
      activityLoaded: service.activity.store.syncedAt > 0
    }, log, rules, Date.now())
    var before = JSON.stringify(log)
    log = result.log
    if (JSON.stringify(log) !== before) file.write(JSON.stringify(log))
    for (var i = 0; i < result.alerts.length; i++) send(result.alerts[i])
  }

  function glyphFor(alertId) {
    var kind = String(alertId).split(":")[0]
    if (kind === "fill") return Icons.list
    if (kind === "div") return Icons.dividend
    if (kind === "earn") return Icons.calendar
    return alertId.indexOf(":down") !== -1 ? Icons.down : Icons.up
  }

  // Fixture runs (smoke test, screenshots) log instead of notifying.
  function send(alert) {
    if (service && service.fixtureDir !== "") {
      console.log("trading212: alert " + alert.id + ": " + alert.title)
      return
    }
    Quickshell.execDetached(Shell.notify(alert.title, alert.body, alert.urgency, glyphFor(alert.id), "io.github.simasrazinskas.trading212"))
  }

  // Test hook for the IPC `testAlert` command.
  function sendTest() {
    send({ id: "test", title: "Trading 212 alerts are on", body: "You'll be notified about big moves, fills, dividends and earnings.", urgency: "low" })
  }

  StateFile {
    id: file
    path: root.path
    onTextLoaded: function(text) {
      root.log = Alerts.parseLog(text)
      debounce.restart()
    }
  }

  Timer {
    id: debounce
    interval: 3000
    repeat: false
    onTriggered: root.evaluate()
  }
}
