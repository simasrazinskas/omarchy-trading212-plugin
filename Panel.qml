import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Trading 212 bar widget: portfolio numbers in the bar, detail panel on
// click. Left click toggles the panel, right click cycles the display mode
// (invested → percent → total → privacy), middle click forces a refresh.
Panel {
  id: root
  moduleName: "io.github.simasrazinskas.trading212"
  ipcTarget: "io.github.simasrazinskas.trading212"
  manageIpc: false

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color urgent: bar ? bar.urgent : Color.urgent
  readonly property color profit: Color.accent
  readonly property color dim: Qt.darker(foreground, 1.55)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  readonly property string mode: Model.normalizeMode(setting("mode", "invested"))
  readonly property var barState: ({
    keyMissing: service.keyMissing,
    authFailed: service.authFailed,
    error: service.lastError,
    data: service.summary
  })

  // Vertical bars have no room for amounts; fall back to a compact badge.
  readonly property var pieces: {
    if (button.vertical) {
      var privacy = Model.barLabel("privacy", barState)
      return { main: "212", delta: privacy.delta === "▲" || privacy.delta === "▼" ? privacy.delta : "", sign: privacy.sign }
    }
    return Model.barLabel(mode, barState)
  }

  readonly property color deltaColor: pieces.sign > 0 ? profit : (pieces.sign < 0 ? urgent : (service.summary ? foreground : dim))
  readonly property bool needsSetup: service.keyMissing || service.authFailed
  readonly property string symbol: service.summary ? Model.currencySymbol(service.summary.currency) : ""

  readonly property string statusText: {
    if (service.keyMissing) return "API KEY REQUIRED"
    if (service.authFailed) return service.lastError.toUpperCase()
    if (service.refreshing) return "REFRESHING…"
    if (service.lastError !== "") return service.lastError.toUpperCase()
    if (service.lastUpdated.getTime() > 0) {
      var sameDay = Qt.formatDate(service.lastUpdated, "yyyy-MM-dd") === Qt.formatDate(new Date(), "yyyy-MM-dd")
      var stamp = sameDay ? Qt.formatTime(service.lastUpdated, "HH:mm") : Qt.formatDateTime(service.lastUpdated, "d MMM HH:mm")
      return service.environment.toUpperCase() + " · " + Model.modeTitle(root.mode).toUpperCase() + " · " + stamp
    }
    return "CONNECTING…"
  }

  function cycleMode() {
    persistSetting("mode", Model.nextMode(mode))
  }

  // Mirrors the clock's format cycling: apply locally for an instant change,
  // then write the same value back through shell.json so it survives shell
  // restarts. The write is debounced so a burst of right-clicks lands as a
  // single shell.json update of the final value — the intermediate writes
  // would otherwise race the bar's settings re-injection.
  property var _pendingEntry: null

  function persistSetting(name, value) {
    var entry = { id: root.moduleName }
    for (var key in root.settings) if (key !== "id") entry[key] = root.settings[key]
    entry[name] = value
    root.settings = entry
    _pendingEntry = entry
    persistTimer.restart()
  }

  Timer {
    id: persistTimer
    interval: 400
    repeat: false
    onTriggered: {
      if (!root._pendingEntry) return
      if (root.bar && root.bar.shell && typeof root.bar.shell.updateEntryInline === "function")
        root.bar.shell.updateEntryInline(root.moduleName, root._pendingEntry)
      root._pendingEntry = null
    }
  }

  function saveCredential() {
    service.storeCredential(credentialField.text)
  }

  function plColor(value) {
    return value >= 0 ? profit : urgent
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  onOpenedChanged: if (opened) {
    service.refreshIfStale()
    Qt.callLater(function() {
      if (root.needsSetup) credentialField.forceActiveFocus()
      else keyCatcher.forceActiveFocus()
    })
  }

  Service {
    id: service
    settings: root.settings
    panelOpen: root.opened
    // A successful save clears the field so the secret doesn't linger in the
    // input; a failed one keeps it for correction.
    onSavingKeyChanged: if (!savingKey && saveError === "") credentialField.text = ""
  }

  IpcHandler {
    target: root.ipcTarget
    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.toggle() }
    function refresh(): string { service.refresh(); return "ok" }
    function setKey(credential: string): string {
      var checked = Model.validateCredential(credential)
      if (!checked.ok) return checked.error
      service.storeCredential(credential)
      return "ok"
    }
    function cycle(): string { root.cycleMode(); return root.mode }
    function mode(): string { return root.mode }
    function status(): string {
      return JSON.stringify({
        environment: service.environment,
        mode: root.mode,
        keyMissing: service.keyMissing,
        authFailed: service.authFailed,
        refreshing: service.refreshing,
        error: service.lastError,
        updated: service.lastUpdated.getTime() > 0 ? service.lastUpdated.toISOString() : null,
        positions: service.positions.length
      })
    }
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    labelVisible: false
    hasVisualContent: true
    fixedWidth: vertical ? -1 : labelRow.implicitWidth + scaledHorizontalMargin * 2
    fixedHeight: vertical ? labelRow.implicitHeight + scaledVerticalPadding * 2 : -1
    tooltipText: Model.tooltip(root.mode, root.barState, service.environment)

    onPressed: function(buttonCode) {
      if (buttonCode === Qt.RightButton) root.cycleMode()
      else if (buttonCode === Qt.MiddleButton) service.refresh()
      else root.toggle()
    }

    Row {
      id: labelRow
      anchors.centerIn: parent
      spacing: root.pieces.main !== "" && root.pieces.delta !== "" ? Style.space(5) : 0

      Text {
        visible: text !== ""
        anchors.verticalCenter: parent.verticalCenter
        text: root.pieces.main
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.body
        renderType: Text.NativeRendering
      }

      Text {
        visible: text !== ""
        anchors.verticalCenter: parent.verticalCenter
        text: root.pieces.delta
        color: root.deltaColor
        font.family: root.fontFamily
        font.pixelSize: Style.font.body
        renderType: Text.NativeRendering
      }
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(430))
    contentHeight: panel.fittedContentHeight(fixedContent.implicitHeight + listContent.implicitHeight + Style.space(12), Style.space(560))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      blocked: credentialField.activeFocus
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onTextKey: function(text) {
        if (text === "r" || text === "R") service.refresh()
      }

      ColumnLayout {
        anchors.fill: parent
        spacing: Style.space(12)

        Column {
          id: fixedContent
          Layout.fillWidth: true
          spacing: Style.space(12)

          // ---- Hero: title + status line, refresh on the right.
          Item {
            width: parent.width
            implicitHeight: Math.max(heroLabels.implicitHeight, refreshButton.implicitHeight)

            Column {
              id: heroLabels
              anchors.left: parent.left
              anchors.right: refreshButton.left
              anchors.rightMargin: Style.space(12)
              anchors.verticalCenter: parent.verticalCenter
              spacing: Style.space(3)

              Text {
                text: "Trading 212"
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.title
                font.bold: true
              }

              Text {
                width: parent.width
                text: root.statusText
                color: (service.authFailed || (service.lastError !== "" && !service.refreshing)) ? root.urgent : root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.bodySmall
                elide: Text.ElideRight
              }
            }

            PanelActionButton {
              id: refreshButton
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              iconText: service.refreshing ? "󰑓" : "󰑐"
              foreground: root.foreground
              fontFamily: root.fontFamily
              enabled: !service.refreshing
              onClicked: service.refresh()
            }
          }

          // ---- Account summary stats.
          Row {
            visible: !root.needsSetup && service.summary !== null
            spacing: Style.space(28)

            Repeater {
              model: service.summary === null ? [] : [
                { label: "INVESTED", value: Model.formatFull(service.summary.invested, root.symbol), colored: false },
                { label: "VALUE", value: Model.formatFull(service.summary.value, root.symbol), colored: false },
                {
                  label: "P/L",
                  value: Model.formatSigned(service.summary.pl, root.symbol)
                    + (service.summary.plPct === null ? "" : "  " + Model.formatPercent(service.summary.plPct)),
                  colored: true,
                  sign: service.summary.pl
                },
                { label: "CASH", value: Model.formatFull(service.summary.free, root.symbol), colored: false }
              ]

              Column {
                required property var modelData
                spacing: Style.space(5)

                Text {
                  text: modelData.label
                  color: Qt.darker(root.foreground, 1.5)
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.bodySmall
                  font.letterSpacing: 1
                }
                Text {
                  text: modelData.value
                  color: modelData.colored ? root.plColor(modelData.sign) : root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.body
                }
              }
            }
          }

          PanelSeparator {
            foreground: root.foreground
          }
        }

        Flickable {
          id: panelFlick
          Layout.fillWidth: true
          Layout.fillHeight: true
          contentWidth: width
          contentHeight: listContent.implicitHeight
          clip: true
          boundsBehavior: Flickable.StopAtBounds
          flickableDirection: Flickable.VerticalFlick
          interactive: contentHeight > height
          ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

          Column {
            id: listContent
            width: panelFlick.width
            spacing: Style.space(10)

            // ---- Setup state: paste the API credential straight into the
            //      panel; it lands in the system keyring over stdin.
            Column {
              visible: root.needsSetup
              width: parent.width
              spacing: Style.space(10)
              topPadding: Style.space(8)
              bottomPadding: Style.space(12)

              Text {
                width: parent.width
                text: service.authFailed
                  ? "The stored API key was rejected. Paste a fresh one below:"
                  : "Connect your Trading 212 account"
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
                wrapMode: Text.Wrap
              }

              Text {
                visible: !service.authFailed
                width: parent.width
                text: "In Trading 212: Settings → API (Beta) → generate a key. Read-only permissions are enough; restricting it to your IP is recommended. Paste it as KEY:SECRET (older single-token keys work too)."
                color: root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.bodySmall
                wrapMode: Text.Wrap
              }

              Row {
                spacing: Style.space(6)

                Text {
                  anchors.verticalCenter: parent.verticalCenter
                  text: "ACCOUNT"
                  color: Qt.darker(root.foreground, 1.5)
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                  font.letterSpacing: 1
                  rightPadding: Style.space(4)
                }

                Button {
                  text: "LIVE"
                  selected: service.environment === "live"
                  foreground: root.foreground
                  background: "transparent"
                  accent: Color.accent
                  fontFamily: root.fontFamily
                  fontSize: Style.font.caption
                  horizontalPadding: Style.space(7)
                  verticalPadding: Style.space(1)
                  onClicked: root.persistSetting("environment", "live")
                }

                Button {
                  text: "DEMO"
                  selected: service.environment === "demo"
                  foreground: root.foreground
                  background: "transparent"
                  accent: Color.accent
                  fontFamily: root.fontFamily
                  fontSize: Style.font.caption
                  horizontalPadding: Style.space(7)
                  verticalPadding: Style.space(1)
                  onClicked: root.persistSetting("environment", "demo")
                }
              }

              Row {
                width: parent.width
                spacing: Style.space(8)

                TextField {
                  id: credentialField
                  width: parent.width - saveButton.implicitWidth - Style.space(8)
                  password: true
                  enabled: !service.savingKey
                  placeholderText: "Paste API key (KEY:SECRET)"
                  foreground: root.foreground
                  font.family: root.fontFamily
                  onAccepted: root.saveCredential()
                  Keys.onPressed: function(event) {
                    if (event.key === Qt.Key_Escape) {
                      root.close()
                      event.accepted = true
                    }
                  }
                }

                Button {
                  id: saveButton
                  anchors.verticalCenter: parent.verticalCenter
                  text: service.savingKey ? "SAVING…" : "SAVE"
                  enabled: !service.savingKey && credentialField.text.trim() !== ""
                  foreground: root.foreground
                  background: "transparent"
                  bordered: true
                  accent: Color.accent
                  fontFamily: root.fontFamily
                  fontSize: Style.font.bodySmall
                  onClicked: root.saveCredential()
                }
              }

              Text {
                visible: service.saveError !== ""
                width: parent.width
                text: service.saveError
                color: root.urgent
                font.family: root.fontFamily
                font.pixelSize: Style.font.bodySmall
                wrapMode: Text.Wrap
              }

              Text {
                width: parent.width
                text: "The key is stored in the system keyring (gnome-keyring), never in a config file."
                color: root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                wrapMode: Text.Wrap
              }
            }

            // ---- Positions list.
            Text {
              visible: !root.needsSetup && !service.positionsLoaded && service.positionsRefreshing
              width: parent.width
              text: "Loading positions…"
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall
              font.italic: true
              topPadding: Style.space(8)
            }

            Text {
              visible: !root.needsSetup && service.positionsLoaded && service.positions.length === 0
              width: parent.width
              text: "No open positions."
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.body
              horizontalAlignment: Text.AlignHCenter
              topPadding: Style.space(12)
              bottomPadding: Style.space(12)
            }

            Column {
              visible: !root.needsSetup && service.positions.length > 0
              width: parent.width
              spacing: Style.space(8)

              Repeater {
                model: service.positions

                Item {
                  required property var modelData
                  width: parent.width
                  implicitHeight: positionLeft.implicitHeight + Style.space(6)

                  Column {
                    id: positionLeft
                    anchors.left: parent.left
                    anchors.right: positionRight.left
                    anchors.rightMargin: Style.space(12)
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: Style.space(2)

                    Text {
                      width: parent.width
                      text: modelData.name
                      color: root.foreground
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.body
                      elide: Text.ElideRight
                    }

                    Text {
                      width: parent.width
                      text: modelData.ticker + " · " + modelData.quantity + " @ "
                        + Model.formatFull(modelData.avgPrice, Model.currencySymbol(modelData.instrumentCurrency))
                      color: root.dim
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.caption
                      elide: Text.ElideRight
                    }
                  }

                  Column {
                    id: positionRight
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: Style.space(2)

                    Text {
                      anchors.right: parent.right
                      text: Model.formatFull(modelData.value, root.symbol)
                      color: root.foreground
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.body
                    }

                    Text {
                      anchors.right: parent.right
                      text: Model.formatSigned(modelData.pl, root.symbol)
                        + (modelData.plPct === null ? "" : " (" + Model.formatPercent(modelData.plPct) + ")")
                      color: root.plColor(modelData.pl)
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.caption
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
