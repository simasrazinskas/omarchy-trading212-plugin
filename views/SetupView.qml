import QtQuick
import qs.Commons
import qs.Ui
import "../components"

// Connect-your-account view: paste the API credential straight into the
// panel; it lands in the system keyring over stdin.
Scroller {
  id: root

  required property var service
  required property var theme
  required property var host

  spacing: Style.space(10)

  readonly property bool editorFocused: credentialField.activeFocus

  function back() {
    if (root.service.keyMissing || root.service.authFailed) return false
    host.showSetup(false)
    return true
  }
  function focusEditor() { credentialField.forceActiveFocus() }

  function save() {
    root.service.storeCredential(credentialField.text)
  }

  // A successful save clears the field so the secret doesn't linger in the
  // input; a failed one keeps it for correction.
  Connections {
    target: root.service
    function onSavingKeyChanged() {
      if (root.service.savingKey || root.service.saveError !== "") return
      credentialField.text = ""
      root.host.showSetup(false)
    }
  }

  Text {
    width: parent.width
    topPadding: Style.space(8)
    text: root.service.authFailed
      ? "The stored API key was rejected. Paste a fresh one below:"
      : root.service.keyMissing ? "Connect your Trading 212 account" : "Replace the API key"
    color: root.theme.foreground
    font.family: root.theme.fontFamily
    font.pixelSize: Style.font.subtitle
    wrapMode: Text.Wrap
  }

  Text {
    width: parent.width
    text: "In Trading 212: Settings → API (Beta) → generate a key. Read-only is enough — tick Account, Portfolio, History (orders, dividends, transactions), Orders, Pies and Metadata to light up every tab. Restricting it to your IP is recommended. Paste it as KEY:SECRET (older single-token keys work too)."
    color: root.theme.dim
    font.family: root.theme.fontFamily
    font.pixelSize: Style.font.bodySmall
    wrapMode: Text.Wrap
  }

  Row {
    spacing: Style.space(6)

    Caption {
      anchors.verticalCenter: parent.verticalCenter
      theme: root.theme
      text: "Account"
      rightPadding: Style.space(4)
    }

    Button {
      text: "LIVE"
      selected: root.service.environment === "live"
      foreground: root.theme.foreground
      accent: root.theme.accent
      fontFamily: root.theme.fontFamily
      fontSize: Style.font.caption
      horizontalPadding: Style.space(7)
      verticalPadding: Style.space(1)
      onClicked: root.host.persistSetting("environment", "live")
    }

    Button {
      text: "DEMO"
      selected: root.service.environment === "demo"
      foreground: root.theme.foreground
      accent: root.theme.accent
      fontFamily: root.theme.fontFamily
      fontSize: Style.font.caption
      horizontalPadding: Style.space(7)
      verticalPadding: Style.space(1)
      onClicked: root.host.persistSetting("environment", "demo")
    }
  }

  Row {
    width: parent.width
    spacing: Style.space(8)

    TextField {
      id: credentialField
      width: parent.width - saveButton.implicitWidth - Style.space(8)
      password: true
      enabled: !root.service.savingKey
      placeholderText: "Paste API key (KEY:SECRET)"
      foreground: root.theme.foreground
      font.family: root.theme.fontFamily
      onAccepted: root.save()
      Keys.onPressed: function(event) {
        if (event.key === Qt.Key_Escape) {
          root.host.close()
          event.accepted = true
        }
      }
    }

    Button {
      id: saveButton
      anchors.verticalCenter: parent.verticalCenter
      text: root.service.savingKey ? "SAVING…" : "SAVE"
      enabled: !root.service.savingKey && credentialField.text.trim() !== ""
      foreground: root.theme.foreground
      bordered: true
      accent: root.theme.accent
      fontFamily: root.theme.fontFamily
      fontSize: Style.font.bodySmall
      onClicked: root.save()
    }
  }

  Text {
    visible: root.service.saveError !== ""
    width: parent.width
    text: root.service.saveError
    color: root.theme.urgent
    font.family: root.theme.fontFamily
    font.pixelSize: Style.font.bodySmall
    wrapMode: Text.Wrap
  }

  Note {
    theme: root.theme
    font.italic: false
    text: "The key is stored in the system keyring (gnome-keyring), never in a config file."
  }

  Button {
    visible: !root.service.keyMissing && !root.service.authFailed
    text: "Cancel"
    foreground: root.theme.foreground
    accent: root.theme.accent
    fontFamily: root.theme.fontFamily
    fontSize: Style.font.caption
    onClicked: root.host.showSetup(false)
  }
}
