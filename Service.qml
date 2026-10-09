import QtQuick
import Quickshell
import Quickshell.Io
import "services"
import "lib/Format.js" as Format
import "lib/T212.js" as T212
import "lib/Portfolio.js" as Portfolio
import "lib/Cash.js" as Cash
import "lib/Shell.js" as Shell

// Data layer. Owns everything that talks to Trading 212 — account summary,
// positions, pending orders, pies — plus the daily snapshot history, and
// composes the sub-services: the synced account history (AccountHistory),
// public market data (MarketData) and desktop alerts (AlertCenter).
//
// The API credential lives in the system keyring (gnome-keyring via
// libsecret); every request looks it up with secret-tool at request time
// and hands the Authorization header to curl over stdin (`--config -`), so
// the secret never appears in a process argv or on disk.
//
// With T212_FIXTURES=<dir> in the environment every request is answered
// from files instead (lib/Shell.js fixtureFetch) and the keyring is never
// touched — the QML smoke test and the README screenshots run that way.
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
  property var pendingOrders: []
  property var pies: []
  property var history: []
  property date lastUpdated: new Date(0)
  // Permission scopes the key lacks (403), keyed by feature label. Only
  // that feature goes dark; the rest of the widget keeps working.
  property var missingScopes: ({})
  // Minute clock: date-dependent bindings (today, this month) follow it.
  property double now: Date.now()

  property var _pieDetails: ({})
  property double _piesFetchedMs: 0
  property double _pendingFetchedMs: 0
  property double _positionsSuccessMs: 0

  property alias activity: accountHistory
  property alias market: marketData
  property alias alerts: alertCenter

  readonly property string fixtureDir: Quickshell.env("T212_FIXTURES") || ""
  readonly property string stateBase: (Quickshell.env("XDG_STATE_HOME") || Quickshell.env("HOME") + "/.local/state") + "/omarchy-trading212"
  readonly property string environment: String(setting("environment", "live")).toLowerCase() === "demo" ? "demo" : "live"
  readonly property int refreshIntervalSec: intSetting("refreshIntervalSec", 60, 15, 3600)
  readonly property string apiHost: environment === "demo" ? "https://demo.trading212.com" : "https://live.trading212.com"
  readonly property string symbol: summary ? Format.currencySymbol(summary.currency) : ""
  readonly property string today: Format.localDate(now)

  // ---- Derived data shared by the bar and several tabs.
  readonly property var realizedTimeline: Portfolio.realizedTimeline(accountHistory.store.orders, summary ? summary.realized : null)
  readonly property var daily: Portfolio.dailyChange(history, summary, today, realizedTimeline)
  readonly property var cashRules: Cash.rulesFrom({ transferMin: setting("transferMin", 100), cashbackMax: setting("cashbackMax", 1) })
  // Null until transactions are synced, and for good without the
  // permission to read them (the Cash tab says which).
  readonly property var spending: accountHistory.hasData && missingScopes["history:transactions"] !== true
    ? Cash.analyze(accountHistory.store.transactions, accountHistory.store.orders, now, cashRules)
    : null

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
  // its rate-limit buckets. The other environment's disk cache fills the
  // gap until the first fetch lands.
  //
  // The change signal also fires on the first evaluation at startup, often
  // from inside some binding that read `environment`; resetting there
  // would rewrite that binding's own inputs mid-evaluation. So the reset
  // runs deferred, and only for an actual switch.
  property string _activeEnvironment: ""
  Component.onCompleted: _activeEnvironment = environment
  onEnvironmentChanged: Qt.callLater(applyEnvironment)

  function applyEnvironment() {
    if (environment === _activeEnvironment) return
    _activeEnvironment = environment
    summary = null
    history = []
    _pendingSnapshot = null
    refreshing = false
    positionsRefreshing = false
    positions = []
    positionsLoaded = false
    pendingOrders = []
    pies = []
    _pieDetails = {}
    _piesFetchedMs = 0
    _pendingFetchedMs = 0
    _positionsSuccessMs = 0
    keyMissing = false
    authFailed = false
    lastError = ""
    missingScopes = {}
    api.clear()
    api._lastStart = {}
    cacheFile.reload()
    historyFile.reload()
    refresh(true)
  }

  // ---- Trading 212 request plumbing.

  // Floors between request starts per endpoint, a little above the
  // documented limits (summary 1/5s, positions 1/1s, pending orders 1/5s,
  // history 6/min, pies list 1/30s, pie detail 1/5s).
  RequestQueue {
    id: api
    gaps: ({
      summary: 6000,
      positions: 2000,
      orders: 6000,
      "history-orders": 10500,
      "history-dividends": 10500,
      "history-transactions": 10500,
      pies: 31000,
      pie: 6000
    })
  }

  function fetchCommand(url) {
    return fixtureDir !== "" ? Shell.fixtureFetch(fixtureDir, url) : Shell.apiFetch(environment, url)
  }

  // `path` is relative to the host and starts with /api/v0 — the form the
  // history endpoints hand back as nextPagePath. A response that lands
  // after an environment switch belongs to the other account and is
  // dropped, so it can't leak into this one's cache or history.
  function request(id, key, path, done, force) {
    var env = environment
    api.enqueue({
      id: env + ":" + id,
      key: key,
      command: fetchCommand(apiHost + path),
      force: force === true,
      done: function(raw) { if (env === root.environment) done(raw) }
    })
  }

  // Shared status handling; returns the body when the response is usable.
  // Transient failures (rate limit, network, server errors) are silent
  // while data exists — the widget keeps the last good numbers and the
  // retry timer fills the gap. `primary` marks the summary/positions calls
  // whose failures matter to the whole widget; the rest just skip a beat.
  function usableBody(raw, label, key, hasData, primary) {
    var result = T212.classify(raw)
    if (result.kind === "no_key") {
      keyMissing = true
      // No request left the machine, so it doesn't count against the floor.
      api.release(key)
      return null
    }
    keyMissing = false
    if (result.kind === "auth") {
      authFailed = true
      lastError = "Trading 212 rejected the API key (HTTP " + result.http + ")"
      return null
    }
    authFailed = false
    if (result.kind === "scope") {
      setScope(label, true)
      // Without Account / Portfolio the widget has nothing to show at all;
      // say so instead of loading forever.
      if (primary) lastError = "The API key lacks the " + (label === "summary" ? "Account" : "Portfolio") + " permission"
      return null
    }
    if (result.kind === "rate") {
      rateLimited = true
      if (primary && !hasData) lastError = "Rate limited — retrying shortly"
      if (primary) retryTimer.restart()
      return null
    }
    rateLimited = false
    if (result.kind === "network" || result.kind === "http") {
      if (primary && !hasData)
        lastError = result.kind === "network" ? "Network error — retrying" : "Trading 212 " + label + " request failed (HTTP " + result.http + ")"
      if (primary) retryTimer.restart()
      return null
    }
    setScope(label, false)
    if (primary) retryTimer.stop()
    return result.body
  }

  function setScope(label, missing) {
    if ((missingScopes[label] === true) !== missing) missingScopes = Format.withKey(missingScopes, label, missing ? true : undefined)
  }

  // ---- Summary + positions: the core poll.

  // `force` skips the gap floor (used right after a key is stored, where
  // waiting out the floor of a just-failed attempt would feel broken).
  function refresh(force) {
    if (api.isQueued(environment + ":summary")) return
    if (!force && api.msUntilReady("summary", false) > 0) return
    refreshing = true
    // Keep the auth-failure message on screen during a retry; the 401
    // handler rewrites it, and blanking it would empty the status line.
    if (!authFailed) lastError = ""
    request("summary", "summary", "/api/v0/equity/account/summary", onSummary, force)
  }

  function onSummary(raw) {
    refreshing = false
    var body = usableBody(raw, "summary", "summary", summary !== null, true)
    if (body === null) return
    var parsed = T212.parseSummary(body)
    if (!parsed.ok) {
      if (summary === null) lastError = parsed.error
      return
    }
    summary = parsed.data
    lastUpdated = new Date()
    now = Date.now()
    lastError = ""
    cacheFile.write(JSON.stringify({ savedAt: new Date().toISOString(), data: parsed.data }))
    recordSnapshot(parsed.data)
    fetchPositions(true)
    if (panelOpen) fetchPendingOrders(false)
  }

  function fetchPositions(force) {
    positionsRefreshing = true
    request("positions", "positions", "/api/v0/equity/positions", onPositions, force)
  }

  function onPositions(raw) {
    positionsRefreshing = false
    var body = usableBody(raw, "positions", "positions", positionsLoaded, true)
    if (body === null) return
    var parsed = T212.parsePositions(body)
    if (!parsed.ok) {
      if (!positionsLoaded) lastError = parsed.error
      return
    }
    positions = parsed.items
    positionsLoaded = true
    _positionsSuccessMs = Date.now()
  }

  // ---- Pending orders and pies: panel-only data, fetched on open and
  //      kept warm while it stays open.

  function fetchPendingOrders(force) {
    request("orders", "orders", "/api/v0/equity/orders", function(raw) {
      var body = usableBody(raw, "orders", "orders", true, false)
      if (body === null) return
      var parsed = T212.parsePendingOrders(body)
      if (!parsed.ok) return
      pendingOrders = parsed.items
      _pendingFetchedMs = Date.now()
    }, force)
  }

  function fetchPies() {
    request("pies", "pies", "/api/v0/equity/pies", function(raw) {
      var body = usableBody(raw, "pies", "pies", true, false)
      if (body === null) return
      var parsed = T212.parsePies(body)
      if (!parsed.ok) return
      _piesFetchedMs = Date.now()
      pies = T212.mergePies(parsed.items, _pieDetails)
      // Names and composition only come from the per-pie detail call;
      // they change rarely, so each is refetched at most hourly.
      for (var i = 0; i < parsed.items.length; i++) {
        var id = parsed.items[i].id
        var detail = _pieDetails[id]
        if (!detail || Date.now() - detail.fetchedAt > 3600000) fetchPieDetail(id)
      }
    }, false)
  }

  function fetchPieDetail(id) {
    request("pie:" + id, "pie", "/api/v0/equity/pies/" + encodeURIComponent(id), function(raw) {
      var body = usableBody(raw, "pies", "pie", true, false)
      if (body === null) return
      var detail = T212.parsePieDetail(body)
      if (!detail.ok) return
      detail.fetchedAt = Date.now()
      _pieDetails = Format.withKey(_pieDetails, id, detail)
      pies = T212.mergePies(pies, _pieDetails)
    }, false)
  }

  // Panel opened: bring every panel-visible dataset up to date, each on its
  // own staleness rule. Runs from the panel's onOpenedChanged, where the
  // panelOpen binding may not have propagated yet, so it doesn't check it.
  function refreshIfStale() {
    now = Date.now()
    var interval = refreshIntervalSec * 1000
    var updatedAt = lastUpdated instanceof Date ? lastUpdated.getTime() : 0
    if (updatedAt <= 0 || Date.now() - updatedAt >= interval) refresh()
    else if (Date.now() - _positionsSuccessMs >= interval) fetchPositions(false)
    if (Date.now() - _pendingFetchedMs >= 30000) fetchPendingOrders(false)
    if (Date.now() - _piesFetchedMs >= 600000) fetchPies()
    accountHistory.syncIfStale(180000)
    marketData.poke()
  }

  function refreshAll() {
    refresh()
    fetchPendingOrders(false)
    fetchPies()
    accountHistory.sync()
    marketData.poke()
  }

  // ---- Credential storage. The secret travels over the storing process's
  //      stdin, never through argv or a file. Returns "ok" once the store
  //      has started, otherwise why it didn't.
  function storeCredential(credential) {
    var checked = T212.validateCredential(credential)
    if (!checked.ok) {
      saveError = checked.error
      return checked.error
    }
    if (storeProcess.running) return "A key is already being saved"
    saveError = ""
    if (fixtureDir !== "") {
      keyMissing = false
      authFailed = false
      return "ok"
    }
    savingKey = true
    storeProcess.secret = checked.cred
    storeProcess.command = Shell.storeCredential(environment)
    storeProcess.running = true
    return "ok"
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
      root.missingScopes = {}
      root.refresh(true)
      accountHistory.sync()
    }
  }

  // ---- Persistence: startup cache and daily snapshots.

  // Last successful summary per environment, applied only while no live
  // data exists, so a restart renders the previous numbers immediately.
  StateFile {
    id: cacheFile
    path: root.stateBase + "/cache-" + root.environment + ".json"
    onTextLoaded: function(text) {
      if (root.summary !== null) return
      var cached = T212.parseCache(text)
      if (!cached.ok) return
      root.summary = cached.data
      if (cached.savedAtMs > 0) root.lastUpdated = new Date(cached.savedAtMs)
    }
  }

  // Snapshot history. Reloaded after each of our own writes rather than
  // watched: the write is a rename, which file watchers handle unevenly.
  StateFile {
    id: historyFile
    path: root.stateBase + "/history-" + root.environment + ".jsonl"
    onTextLoaded: function(text) {
      root.history = Portfolio.parseHistory(text)
      if (root._pendingSnapshot !== null) {
        var data = root._pendingSnapshot
        root._pendingSnapshot = null
        root.recordSnapshot(data)
      }
    }
  }

  // A summary that arrives before the history has loaded waits for it:
  // writing blind would reset today's opening values to the current ones.
  property var _pendingSnapshot: null

  // One line per day holding the day's latest reading: today's line is
  // replaced on every successful fetch, so a day closes at its final value
  // and the open* fields carry the day's first reading forward.
  function recordSnapshot(data) {
    if (!historyFile.loaded || snapshotProcess.running) {
      _pendingSnapshot = data
      return
    }
    var stamp = Date.now()
    var date = Format.localDate(stamp)
    var line = Portfolio.snapshotLine(date, stamp, data, Portfolio.entryForDate(history, date))
    snapshotProcess.command = Shell.upsertSnapshot(historyFile.path, date, line)
    snapshotProcess.running = true
  }

  Process {
    id: snapshotProcess
    running: false
    onExited: historyFile.reload()
  }

  // ---- Sub-services.

  AccountHistory {
    id: accountHistory
    service: root
    path: root.stateBase + "/activity-" + root.environment + ".json"
  }

  MarketData {
    id: marketData
    enabled: root.setting("marketData", true) !== false
    active: root.panelOpen
    positions: root.positions
    path: root.stateBase + "/market.json"
    fixtureDir: root.fixtureDir
  }

  AlertCenter {
    id: alertCenter
    service: root
    settings: root.settings
    path: root.stateBase + "/alerts-" + root.environment + ".json"
  }

  // ---- Timers.

  // Bridges transient failures faster than the main poll would, so a
  // hiccup shows as ~15 s of stale data instead of a visible error.
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
    onTriggered: {
      root.refresh()
      if (root.panelOpen && Date.now() - root._piesFetchedMs >= 600000) root.fetchPies()
    }
  }

  Timer {
    interval: 60000
    running: true
    repeat: true
    onTriggered: root.now = Date.now()
  }
}
