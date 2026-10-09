import QtQuick
import "../lib/T212.js" as T212
import "../lib/Activity.js" as Activity
import "../lib/Format.js" as Format

// The account's history — filled orders, dividends, cash transactions —
// synced from the paginated /equity/history/* endpoints into a local store.
//
// The first sync backfills every page (the endpoints allow 6 requests a
// minute each, 50 rows a page), resuming from a stored cursor if it runs
// past one sync's page budget; later syncs fetch the newest page and stop
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
  // Set when a page fails for a transient reason (rate limit, network);
  // such a sync isn't stamped as synced, so it is retried soon.
  property bool _failed: false

  // Pages per kind per sync. A longer backfill resumes from its stored
  // cursor on the next sync instead of starting over.
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
    _failed = false
    revision += 1
  }

  function sync() {
    if (syncing || !service) return
    syncing = true
    _failed = false
    _outstanding = kinds.length
    // Without a stored cursor, walking down from the newest page *is* the
    // backfill frontier; with one, the walk jumps there once it reaches
    // rows that are already stored.
    for (var i = 0; i < kinds.length; i++) fetchPage(kinds[i], kinds[i].path, 0, !store.cursors[kinds[i].kind])
  }

  function syncIfStale(maxAgeMs) {
    if (!file.loaded) return
    if (Date.now() - store.syncedAt >= maxAgeMs) sync()
  }

  function fetchPage(spec, pagePath, depth, frontier) {
    var syncPath = path
    service.request("history:" + spec.kind + ":" + depth, "history-" + spec.kind, pagePath, function(raw) {
      // An environment switch mid-sync points the store at another account.
      if (syncPath === root.path) root.onPage(spec, raw, depth, frontier)
    }, false)
  }

  function update(changes) {
    var next = store
    for (var key in changes) next = Format.withKey(next, key, changes[key])
    store = next
    revision += 1
  }

  function onPage(spec, raw, depth, frontier) {
    var label = "history:" + spec.kind
    var body = service.usableBody(raw, label, "history-" + spec.kind, true, false)
    var page = body === null ? null : T212.parsePage(body)
    if (page === null || !page.ok) {
      // A missing permission is a settled answer; anything else isn't.
      if (!service.missingScopes[label]) _failed = true
      finish()
      return
    }
    var items = []
    for (var i = 0; i < page.items.length; i++) items.push(spec.normalize(page.items[i]))
    var merged = Activity.merge(store[spec.kind], items)
    var wasComplete = store.complete[spec.kind] === true
    var changes = {}
    changes[spec.kind] = merged.items
    if (page.next === "") changes.complete = Format.withKey(store.complete, spec.kind, true)
    if (frontier || page.next === "") changes.cursors = Format.withKey(store.cursors, spec.kind, page.next === "" ? undefined : page.next)
    update(changes)

    if (page.next === "" || depth + 1 >= maxPages) {
      finish()
      return
    }
    // Rows past this page are new while the page itself was all new, or
    // while the backfill is unfinished.
    if (merged.overlap === 0 || frontier) fetchPage(spec, page.next, depth + 1, frontier)
    else if (!wasComplete && store.cursors[spec.kind]) fetchPage(spec, store.cursors[spec.kind], depth + 1, true)
    else if (!wasComplete) fetchPage(spec, page.next, depth + 1, true)
    else finish()
  }

  function finish() {
    _outstanding -= 1
    if (_outstanding > 0) return
    _outstanding = 0
    syncing = false
    if (!_failed) update({ syncedAt: Date.now() })
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
