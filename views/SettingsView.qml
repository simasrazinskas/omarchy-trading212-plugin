import QtQuick
import qs.Commons
import qs.Ui
import "../components"
import "../lib/Format.js" as Format
import "../lib/Alerts.js" as Alerts
import "../lib/Cash.js" as Cash

// In-panel settings. The shell has no settings UI for plugin widgets, so
// everything configurable lives here and persists to the widget's entry in
// shell.json via the host's persistSetting.
Scroller {
  id: root

  required property var service
  required property var theme
  required property var host

  spacing: Style.space(14)

  readonly property var rules: Alerts.settingsFrom(host.settings)
  readonly property var scopes: Object.keys(service.missingScopes)

  function back() {
    host.showSettings(false)
    return true
  }

  Item {
    width: parent.width
    implicitHeight: closeButton.implicitHeight

    Text {
      anchors.verticalCenter: parent.verticalCenter
      text: "Settings"
      color: root.theme.foreground
      font.family: root.theme.fontFamily
      font.pixelSize: Style.font.heading
      font.bold: true
    }

    Button {
      id: closeButton
      anchors.right: parent.right
      text: "Done"
      tooltipText: "Back (Backspace)"
      bordered: true
      foreground: root.theme.foreground
      accent: root.theme.accent
      fontFamily: root.theme.fontFamily
      fontSize: Style.font.caption
      onClicked: root.host.showSettings(false)
    }
  }

  Choice {
    theme: root.theme
    label: "Account"
    options: [{ value: "live", label: "Live" }, { value: "demo", label: "Practice (demo)" }]
    value: root.service.environment
    hint: "Keys are per environment; each keeps its own history and cache."
    onPicked: function(value) { root.host.persistSetting("environment", value) }
  }

  Button {
    text: "Replace API key…"
    bordered: true
    foreground: root.theme.foreground
    accent: root.theme.accent
    fontFamily: root.theme.fontFamily
    fontSize: Style.font.caption
    onClicked: root.host.showSetup(true)
  }

  Choice {
    theme: root.theme
    label: "Refresh every"
    options: [{ value: "30", label: "30 s" }, { value: "60", label: "1 min" }, { value: "120", label: "2 min" }, { value: "300", label: "5 min" }]
    value: String(root.service.refreshIntervalSec)
    onPicked: function(value) { root.host.persistSetting("refreshIntervalSec", Number(value)) }
  }

  SettingSwitch {
    theme: root.theme
    label: "Public market data"
    description: "Quotes, charts, fundamentals, earnings and news from Nasdaq, ECB rates, CNN Fear & Greed and Google News. No keys; only ticker symbols leave your machine."
    checked: root.service.market.enabled
    onClicked: root.host.persistSetting("marketData", !root.service.market.enabled)
  }

  Caption { theme: root.theme; text: "Notifications" }

  SettingSwitch {
    theme: root.theme
    label: "Desktop notifications"
    description: "Big portfolio or position moves, filled orders, dividends, and earnings the day before."
    checked: root.rules.enabled
    onClicked: root.host.persistSetting("alerts", !root.rules.enabled)
  }

  Column {
    visible: root.rules.enabled
    width: parent.width
    spacing: Style.space(12)

    Choice {
      theme: root.theme
      label: "Portfolio moves by"
      options: ["1", "2", "3", "5"].map(function(v) { return { value: v, label: "±" + v + "%" } })
      value: String(root.rules.portfolioPct)
      onPicked: function(value) { root.host.persistSetting("alertPortfolioPct", Number(value)) }
    }

    Choice {
      theme: root.theme
      label: "A holding moves by"
      options: ["3", "5", "8", "10"].map(function(v) { return { value: v, label: "±" + v + "%" } })
      value: String(root.rules.positionPct)
      onPicked: function(value) { root.host.persistSetting("alertPositionPct", Number(value)) }
    }

    SettingSwitch {
      theme: root.theme
      label: "Filled orders"
      checked: root.rules.fills
      onClicked: root.host.persistSetting("alertFills", !root.rules.fills)
    }
    SettingSwitch {
      theme: root.theme
      label: "Dividends paid"
      checked: root.rules.dividends
      onClicked: root.host.persistSetting("alertDividends", !root.rules.dividends)
    }
    SettingSwitch {
      theme: root.theme
      label: "Upcoming earnings"
      checked: root.rules.earnings
      onClicked: root.host.persistSetting("alertEarnings", !root.rules.earnings)
    }

    Button {
      text: "Send a test notification"
      bordered: true
      foreground: root.theme.foreground
      accent: root.theme.accent
      fontFamily: root.theme.fontFamily
      fontSize: Style.font.caption
      onClicked: root.service.alerts.sendTest()
    }
  }

  Choice {
    theme: root.theme
    label: "Spending: treat whole withdrawals as bank transfers from"
    options: Cash.TRANSFER_CHOICES.map(function(v) {
      return { value: String(v), label: v >= Cash.NEVER ? "Never" : root.service.symbol + v }
    })
    value: String(root.service.cashRules.transferMin)
    hint: "Card payments and bank withdrawals look the same in the API. Round amounts at or above this are counted as transfers, everything else as spending."
    onPicked: function(value) { root.host.persistSetting("transferMin", Number(value)) }
  }

  Column {
    visible: root.scopes.length > 0
    width: parent.width
    spacing: Style.space(4)

    Caption { theme: root.theme; text: "Missing API permissions" }
    Note {
      theme: root.theme
      font.italic: false
      color: root.theme.urgent
      text: "The key can't read: " + root.scopes.join(", ") + ". Generate a new read-only key with those permissions ticked to enable them."
    }
  }

  Note {
    theme: root.theme
    text: "Local data: " + root.service.stateBase + " (snapshots, history cache, market cache). The API key stays in the system keyring."
  }
}
