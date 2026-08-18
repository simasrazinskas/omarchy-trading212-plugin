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
  property bool savingKey: false
  property string saveError: ""
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

  // Hard floors between fetches, tracked from request start. Trading 212
  // allows 1 req/5s on the summary endpoint and 1 req/1s on positions, so
  // spammed manual refreshes (middle-click, IPC) can never run into a 429.
  readonly property int summaryGapMs: 6000
  readonly property int positionsGapMs: 2000
  property double _lastSummaryStartMs: 0
  property double _lastPositionsStartMs: 0

  function setting(name, fallback) {
    var value = settings ? settings[name] : undefined
    return value === undefined || value === null ? fallback : value
  }

  function intSetting(name, fallback, minimum, maximum) {
    var value = parseInt(String(setting(name, fallback)), 10)
    if (!isFinite(value)) value = fallback
    return Math.max(minimum, Math.min(maximum, value))
  }

  // Environment switch invalidates everything from the other account — and
  // its rate-limit bucket, so the floors reset too.
  onEnvironmentChanged: {
    summary = null
    positions = []
    positionsLoaded = false
    keyMissing = false
    authFailed = false
    lastError = ""
    _lastSummaryStartMs = 0
    _lastPositionsStartMs = 0
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

  // `force` skips the gap floor (used right after a key is stored, where
  // waiting out the floor of a just-failed attempt would feel broken); it
  // never skips the running guard.
  function refresh(force) {
    if (summaryProcess.running) return
    if (!force && Date.now() - _lastSummaryStartMs < summaryGapMs) return
    _lastSummaryStartMs = Date.now()
    refreshing = true
    lastError = ""
    summaryProcess.command = fetchCommand("/equity/account/summary")
    summaryProcess.running = true
  }

  function fetchPositions(force) {
    if (positionsProcess.running) return
    if (!force && Date.now() - _lastPositionsStartMs < positionsGapMs) return
    _lastPositionsStartMs = Date.now()
    positionsRefreshing = true
    positionsProcess.command = fetchCommand("/equity/positions")
    positionsProcess.running = true
  }

  // Shared HTTP-state handling; returns the body when the response is
  // usable. Transient failures (rate limit, network, server errors) are
  // deliberately silent when cached data exists — the widget keeps showing
  // the last good numbers and the retry timer fills the gap. Only
  // actionable states (missing key, rejected key) always surface.
  function usableBody(output, label, hasCache) {
    var result = Model.splitFetchOutput(output)
    if (result.status === "no_key") {
      keyMissing = true
      // No request actually left the machine, so don't let this attempt
      // count against the fetch floors.
      _lastSummaryStartMs = 0
      _lastPositionsStartMs = 0
      return null
    }
    keyMissing = false
    if (result.status === "curl_error") {
      if (!hasCache) lastError = "Network error — retrying"
      retryTimer.restart()
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
      if (!hasCache) lastError = "Rate limited — retrying shortly"
      retryTimer.restart()
      return null
    }
    rateLimited = false
    if (result.http < 200 || result.http >= 300) {
      if (!hasCache) lastError = "Trading 212 " + label + " request failed (HTTP " + result.http + ")"
      retryTimer.restart()
      return null
    }
    retryTimer.stop()
    return result.body
  }

  // Store the pasted credential in the keyring. The secret travels over the
  // process's stdin (same pattern as the network panel's Wi-Fi passwords),
  // never through argv or a file; bash reads one line and re-pipes it to
  // secret-tool so no trailing newline ends up inside the stored secret.
  function storeCredential(credential) {
    var checked = Model.validateCredential(credential)
    if (!checked.ok) {
      saveError = checked.error
      return
    }
    if (storeProcess.running) return
    savingKey = true
    saveError = ""
    storeProcess.secret = checked.cred
    var script = "IFS= read -r cred\n"
      + "[ -n \"$cred\" ] || exit 1\n"
      + "printf %s \"$cred\" | secret-tool store --label=\"Trading 212 API ($1)\" service trading212 account \"$1\"\n"
    storeProcess.command = ["bash", "-c", script, "t212", environment]
    storeProcess.running = true
  }

  Process {
    id: storeProcess
    property string secret: ""
    running: false
    stdinEnabled: true
    onStarted: {
      write(secret + "\n")
      secret = ""
    }
    stderr: StdioCollector {
      id: storeStderr
      waitForEnd: true
    }
    onExited: function(exitCode) {
      root.savingKey = false
      if (exitCode !== 0) {
        var detail = String(storeStderr.text || "").replace(/\s+/g, " ").trim()
        root.saveError = "Could not store the key" + (detail !== "" ? ": " + detail : " in the keyring")
        return
      }
      root.saveError = ""
      root.keyMissing = false
      root.authFailed = false
      root.refresh(true)
    }
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
      var body = root.usableBody(String(summaryStdout.text || ""), "summary", root.summary !== null)
      if (body === null) return
      var parsed = Model.parseSummary(body)
      if (!parsed.ok) {
        if (root.summary === null) root.lastError = parsed.error
        return
      }
      root.summary = parsed.data
      root.lastUpdated = new Date()
      root.lastError = ""
      root.recordSnapshot(parsed.data)
      if (root.panelOpen) root.fetchPositions(true)
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
      var body = root.usableBody(String(positionsStdout.text || ""), "positions", root.positionsLoaded)
      if (body === null) return
      var parsed = Model.parsePositions(body)
      if (!parsed.ok) {
        if (!root.positionsLoaded) root.lastError = parsed.error
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

  // Bridges transient failures (rate limit, network) faster than the main
  // poll would, so a hiccup shows as at most ~15s of stale data instead of
  // a visible error. Respects the fetch floors; stopped by any success.
  Timer {
    id: retryTimer
    interval: 15000
    repeat: false
    onTriggered: root.refresh()
  }

  Timer {
    interval: root.refreshIntervalSec * 1000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refresh()
  }
}
