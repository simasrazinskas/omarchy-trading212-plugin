import QtQuick
import Quickshell.Io
import "../lib/Shell.js" as Shell

// One file under the plugin's state directory: read once per path (and on
// demand via reload), written atomically. The payload travels over the
// writer's stdin as a single line — JSON.stringify never emits a raw
// newline — and lands via a temp file + rename (lib/Shell.js writeFile).
Item {
  id: root

  property string path: ""
  readonly property bool loaded: _loadedPath === path && path !== ""

  property string _loadedPath: ""
  property string _pending: ""
  property bool _hasPending: false

  signal textLoaded(string text)

  function reload() {
    if (path !== "") view.reload()
  }

  function write(text) {
    if (path === "") return
    if (writer.running) {
      _pending = text
      _hasPending = true
      return
    }
    writer.payload = text
    writer.command = Shell.writeFile(path)
    writer.running = true
  }

  FileView {
    id: view
    path: root.path
    printErrors: false
    onLoaded: {
      root._loadedPath = root.path
      root.textLoaded(text())
    }
    onLoadFailed: {
      root._loadedPath = root.path
      root.textLoaded("")
    }
  }

  Process {
    id: writer
    property string payload: ""
    running: false
    stdinEnabled: true
    onStarted: {
      write(payload + "\n")
      payload = ""
    }
    onExited: {
      if (!root._hasPending) return
      var next = root._pending
      root._pending = ""
      root._hasPending = false
      root.write(next)
    }
  }
}
