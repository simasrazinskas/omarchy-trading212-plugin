import QtQuick
import Quickshell.Io

// One file under the plugin's state directory: read once per path (and on
// demand), written atomically. The payload travels over the writer's stdin
// as a single line — JSON.stringify never emits a raw newline — and lands
// via a temp file + rename, so a crash mid-write never leaves half a file.
Item {
  id: root

  property string path: ""
  property bool watch: false
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
    writer.command = ["bash", "-c",
      "IFS= read -r payload\n"
      + "mkdir -p \"${1%/*}\" && printf '%s\\n' \"$payload\" > \"$1.tmp\" && mv \"$1.tmp\" \"$1\"\n",
      "t212", path]
    writer.running = true
  }

  FileView {
    id: view
    path: root.path
    watchChanges: root.watch
    printErrors: false
    onFileChanged: reload()
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
