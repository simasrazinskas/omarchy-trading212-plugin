import QtQuick
import "../lib/T212.js" as T212
import "../lib/Activity.js" as Activity

// The account's history — filled orders, dividends, cash transactions —
// synced from the paginated /equity/history/* endpoints into a local store.
//
// The first sync backfills every page (the endpoints allow 6 requests a
// minute each, 50 rows a page); later syncs fetch the newest page and stop
// as soon as a page overlaps what is already stored. The store persists to
// disk, so a restart shows the full history instantly and re-syncs quietly.
Item {
  id: root

  property var service: null
  property string path: ""

  property var store: Activity.emptyStore()
  property bool syncing: false
  property int revision: 0
  readonly property bool hasData: store.syncedAt > 0 || store.orders.length > 0 || store.transactions.length > 0
  readonly property bool fileLoaded: file.loaded

  property int _outstanding: 0

  // Safety valve for the backfill: 40 pages × 50 rows per kind.
  readonly property int maxPages: 40

  readonly property var kinds: [
    { kind: "orders", path: "/api/v0/equity/history/orders?limit=50", normalize: T212.normalizeOrder },
    { kind: "dividends", path: "/api/v0/equity/history/dividends?limit=50", normalize: T212.normalizeDividend },
    { kind: "transactions", path: "/api/v0/equity/history/transactions?limit=50", normalize: T212.normalizeTransaction }
  ]

  onPathChanged: {
    store = Activity.emptyStore()
    syncing = false
    _outstanding = 0
    revision += 1
  }

  function sync() {
    if (syncing || !service) return
    syncing = true
    _outstanding = kinds.length
    for (var i = 0; i < kinds.length; i++) fetchPage(kinds[i], kinds[i].path, 0)
  }

  function syncIfStale(maxAgeMs) {
    if (!file.loaded) return
    if (Date.now() - store.syncedAt >= maxAgeMs) sync()
  }

  function fetchPage(spec, pagePath, depth) {
    var syncPath = path
    service.request("history:" + spec.kind + ":" + depth, "history-" + spec.kind, pagePath, function(raw) {
      // An environment switch mid-sync points the store at another account.
      if (syncPath === root.path) root.onPage(spec, raw, depth)
    }, false)
  }

  function onPage(spec, raw, depth) {
    var body = service.usableBody(raw, "history:" + spec.kind, "history-" + spec.kind, true, false)
    if (body === null) {
      finish()
      return
    }
    var page = T212.parsePage(body)
    if (!page.ok) {
      finish()
      return
    }
    var items = []
    for (var i = 0; i < page.items.length; i++) items.push(spec.normalize(page.items[i]))
    var merged = Activity.merge(store[spec.kind], items)

    var next = {}
    for (var key in store) next[key] = store[key]
    next[spec.kind] = merged.items
    var complete = {}
    for (var c in store.complete) complete[c] = store.complete[c]
    if (page.next === "") complete[spec.kind] = true
    next.complete = complete
    store = next
    revision += 1

    // Keep paging while backfilling, or while every row on this page was
    // new (more new rows may sit on the next one).
    var more = page.next !== "" && depth + 1 < maxPages && (merged.overlap === 0 || !store.complete[spec.kind])
    if (more) fetchPage(spec, page.next, depth + 1)
    else finish()
  }

  function finish() {
    _outstanding -= 1
    if (_outstanding > 0) return
    _outstanding = 0
    syncing = false
    var next = {}
    for (var key in store) next[key] = store[key]
    next.syncedAt = Date.now()
    store = next
    revision += 1
    file.write(JSON.stringify(store))
  }

  StateFile {
    id: file
    path: root.path
    onTextLoaded: function(text) {
      root.store = Activity.parseStore(text)
      root.revision += 1
      // Fresh install or stale store: sync shortly after startup, once the
      // summary poll has had its turn at the queue.
      if (Date.now() - root.store.syncedAt >= 600000) startupSync.restart()
    }
  }

  Timer {
    id: startupSync
    interval: 8000
    repeat: false
    onTriggered: root.sync()
  }

  Timer {
    interval: 15 * 60000
    running: true
    repeat: true
    onTriggered: root.sync()
  }
}
