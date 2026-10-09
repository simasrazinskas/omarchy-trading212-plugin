import QtQuick
import Quickshell.Io

// Serial request runner with per-key rate floors. Every network call in the
// plugin goes through one of these: Trading 212 rate-limits per account and
// per endpoint, so one request at a time with a minimum gap between starts
// of the same `key` can never trip a 429, however many features ask for
// data at once.
//
// Jobs: { id, key, command, done(output), force? }. A job whose `id` is
// already queued replaces it (latest callback wins); one already running
// is dropped, since its answer is about to arrive anyway.
Item {
  id: root

  // key → minimum milliseconds between request starts.
  property var gaps: ({})
  readonly property bool busy: _current !== null
  readonly property int pending: _queue.length

  property var _queue: []
  property var _current: null
  property var _lastStart: ({})

  function enqueue(job) {
    if (_current !== null && _current.id === job.id) return
    var queue = _queue.slice()
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].id === job.id) {
        queue[i] = job
        _queue = queue
        return
      }
    }
    queue.push(job)
    _queue = queue
    Qt.callLater(pump)
  }

  function isQueued(id) {
    if (_current !== null && _current.id === id) return true
    for (var i = 0; i < _queue.length; i++) if (_queue[i].id === id) return true
    return false
  }

  function clear() {
    _queue = []
    waitTimer.stop()
  }

  // Forget a key's last start, e.g. when the attempt never left the machine.
  function release(key) {
    var starts = _lastStart
    starts[key] = 0
    _lastStart = starts
  }

  function msUntilReady(key, force) {
    if (force) return 0
    var gap = gaps[key] || 0
    var last = _lastStart[key] || 0
    return last + gap - Date.now()
  }

  function pump() {
    if (_current !== null || _queue.length === 0) return
    var wait = Infinity
    for (var i = 0; i < _queue.length; i++) {
      var ready = msUntilReady(_queue[i].key, _queue[i].force)
      if (ready <= 0) {
        var queue = _queue.slice()
        var job = queue.splice(i, 1)[0]
        _queue = queue
        start(job)
        return
      }
      wait = Math.min(wait, ready)
    }
    waitTimer.interval = Math.max(50, Math.ceil(wait))
    waitTimer.restart()
  }

  function start(job) {
    _current = job
    var starts = _lastStart
    starts[job.key] = Date.now()
    _lastStart = starts
    process.command = job.command
    process.running = true
  }

  Process {
    id: process
    running: false
    stdout: StdioCollector {
      id: output
      waitForEnd: true
    }
    onExited: function(exitCode) {
      var job = root._current
      root._current = null
      if (job && typeof job.done === "function") {
        try {
          job.done(String(output.text || ""))
        } catch (error) {
          console.warn("trading212: request handler for " + job.id + " failed: " + error)
        }
      }
      Qt.callLater(root.pump)
    }
  }

  Timer {
    id: waitTimer
    repeat: false
    onTriggered: root.pump()
  }
}
