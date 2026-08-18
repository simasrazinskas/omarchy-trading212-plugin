import QtQuick
import Quickshell
import Quickshell.Io
import "Model.js" as Model

// Data layer: polls the Trading 212 public API and exposes account summary +
// positions. The API credential lives in the system keyring (gnome-keyring via
// libsecret); the fetch script looks it up with secret-tool at request time
// and passes the Authorization header to curl over stdin (`--config -`), so
// the secret never appears in a process argv or on disk.
Item {
  id: root

  property var settings: ({})
  property bool panelOpen: false

  property bool refreshing: false
  property bool positionsRefreshing: false
  property bool keyMissing: false
  property bool authFailed: false
  property bool rateLimited: false
  property string lastError: ""
  property var summary: null
  property var positions: []
  property bool positionsLoaded: false
  property date lastUpdated: new Date(0)

  readonly property string environment: String(setting("environment", "live")).toLowerCase() === "demo" ? "demo" : "live"
  readonly property int refreshIntervalSec: intSetting("refreshIntervalSec", 60, 15, 3600)
  readonly property string baseUrl: (environment === "demo" ? "https://demo.trading212.com" : "https://live.trading212.com") + "/api/v0"

  function setting(name, fallback) {
    var value = settings ? settings[name] : undefined
    return value === undefined || value === null ? fallback : value
  }

  function intSetting(name, fallback, minimum, maximum) {
    var value = parseInt(String(setting(name, fallback)), 10)
    if (!isFinite(value)) value = fallback
    return Math.max(minimum, Math.min(maximum, value))
  }

  // Environment switch invalidates everything from the other account.
  onEnvironmentChanged: {
    summary = null
    positions = []
    positionsLoaded = false
    keyMissing = false
    authFailed = false
    lastError = ""
    Qt.callLater(refresh)
  }

  function fetchCommand(path) {
    var script = "cred=$(secret-tool lookup service trading212 account \"$1\" 2>/dev/null)\n"
      + "if [ -z \"$cred\" ]; then echo \"__T212_STATUS__ no_key\"; exit 0; fi\n"
      + "case \"$cred\" in\n"
      + "  *:*) auth=\"Basic $(printf %s \"$cred\" | base64 | tr -d '\\n')\" ;;\n"
      + "  *) auth=\"$cred\" ;;\n"
      + "esac\n"
      + "printf 'header = \"Authorization: %s\"\\n' \"$auth\" | curl -sS --max-time 10 --config - -w '\\n__T212_HTTP__ %{http_code}' \"$2\" 2>/dev/null"
      + " || echo \"__T212_STATUS__ curl_error\"\n"
    return ["bash", "-c", script, "t212", environment, baseUrl + path]
  }

  function refreshIfStale() {
    var updatedAt = lastUpdated instanceof Date ? lastUpdated.getTime() : 0
    if (updatedAt <= 0 || Date.now() - updatedAt >= refreshIntervalSec * 1000) refresh()
    else if (panelOpen && !positionsLoaded) fetchPositions()
  }

  function refresh() {
    if (summaryProcess.running) return
    refreshing = true
    lastError = ""
    summaryProcess.command = fetchCommand("/equity/account/summary")
    summaryProcess.running = true
  }

  function fetchPositions() {
    if (positionsProcess.running) return
    positionsRefreshing = true
    positionsProcess.command = fetchCommand("/equity/positions")
    positionsProcess.running = true
  }

  // Shared HTTP-state handling; returns the body when the response is usable.
  function usableBody(output, label) {
    var result = Model.splitFetchOutput(output)
    if (result.status === "no_key") {
      keyMissing = true
      return null
    }
    keyMissing = false
    if (result.status === "curl_error") {
      lastError = "Network error reaching Trading 212"
      return null
    }
    if (result.http === 401 || result.http === 403) {
      authFailed = true
      lastError = "Trading 212 rejected the API key (HTTP " + result.http + ")"
      return null
    }
    authFailed = false
    if (result.http === 429) {
      rateLimited = true
      lastError = "Rate limited by Trading 212 — backing off"
      return null
    }
    rateLimited = false
    if (result.http < 200 || result.http >= 300) {
      lastError = "Trading 212 " + label + " request failed (HTTP " + result.http + ")"
      return null
    }
    return result.body
  }

  function recordSnapshot(data) {
    var now = new Date()
    var today = Qt.formatDate(now, "yyyy-MM-dd")
    var script = "f=\"${XDG_STATE_HOME:-$HOME/.local/state}/omarchy-trading212/history-$1.jsonl\"\n"
      + "mkdir -p \"${f%/*}\"\n"
      + "tail -n 1 \"$f\" 2>/dev/null | grep -q \"\\\"date\\\":\\\"$2\\\"\" || printf '%s\\n' \"$3\" >> \"$f\"\n"
    snapshotProcess.command = ["bash", "-c", script, "t212", environment, today, Model.snapshotLine(today, now.getTime(), data)]
    snapshotProcess.running = true
  }

  Process {
    id: summaryProcess
    running: false
    stdout: StdioCollector {
      id: summaryStdout
      waitForEnd: true
    }
    onExited: function(exitCode) {
      root.refreshing = false
      var body = root.usableBody(String(summaryStdout.text || ""), "summary")
      if (body === null) return
      var parsed = Model.parseSummary(body)
      if (!parsed.ok) {
        root.lastError = parsed.error
        return
      }
      root.summary = parsed.data
      root.lastUpdated = new Date()
      root.lastError = ""
      root.recordSnapshot(parsed.data)
      if (root.panelOpen) root.fetchPositions()
    }
  }

  Process {
    id: positionsProcess
    running: false
    stdout: StdioCollector {
      id: positionsStdout
      waitForEnd: true
    }
    onExited: function(exitCode) {
      root.positionsRefreshing = false
      var body = root.usableBody(String(positionsStdout.text || ""), "positions")
      if (body === null) return
      var parsed = Model.parsePositions(body)
      if (!parsed.ok) {
        root.lastError = parsed.error
        return
      }
      root.positions = parsed.items
      root.positionsLoaded = true
    }
  }

  Process {
    id: snapshotProcess
    running: false
  }

  Timer {
    interval: root.refreshIntervalSec * 1000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refresh()
  }
}
