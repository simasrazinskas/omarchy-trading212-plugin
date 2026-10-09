import QtQuick
import qs.Commons
import qs.Ui
import "../components"
import "../lib/Format.js" as Format
import "../lib/Activity.js" as Activity

// Activity tab: one timeline of everything that happened in the account —
// trades, dividends, deposits, card spending, fees — grouped by day with a
// daily net, filterable by kind.
Scroller {
  id: root

  required property var service
  required property var theme
  required property var host

  spacing: Style.space(10)

  readonly property string symbol: service.symbol
  readonly property var store: service.activity.store
  readonly property string filter: Activity.FILTERS.indexOf(host.setting("activityFilter", "all")) === -1 ? "all" : host.setting("activityFilter", "all")
  property int limit: 150
  readonly property var allRows: Activity.timeline(store, filter, service.cashRules, 0)
  readonly property var rows: allRows.slice(0, limit)
  readonly property var groups: Activity.groupByDay(rows, service.now)
  readonly property int totalRows: allRows.length

  onFilterChanged: {
    limit = 150
    toTop()
  }

  function textKey(t) {
    if (t === "f") {
      host.persistSetting("activityFilter", Activity.FILTERS[(Activity.FILTERS.indexOf(filter) + 1) % Activity.FILTERS.length])
      return true
    }
    return false
  }

  Item {
    width: parent.width
    implicitHeight: filterGroup.implicitHeight

    ButtonGroup {
      id: filterGroup
      focusable: false
      options: Activity.FILTERS.map(function(f) { return { value: f, label: Activity.filterTitle(f), tooltip: "Cycle filter (f)" } })
      value: root.filter
      foreground: root.theme.foreground
      accent: root.theme.accent
      fontFamily: root.theme.fontFamily
      fontSize: Style.font.caption
      spacing: Style.space(4)
      onChanged: function(value) { root.host.persistSetting("activityFilter", value) }
    }

    Text {
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      text: root.service.activity.syncing ? "Syncing…"
        : root.store.syncedAt > 0 ? "Synced " + Format.stamp(root.store.syncedAt, root.service.now) : ""
      color: root.theme.dim
      font.family: root.theme.fontFamily
      font.pixelSize: Style.font.caption
    }
  }

  Note {
    visible: root.rows.length === 0
    theme: root.theme
    text: root.service.activity.syncing || root.store.syncedAt === 0 ? "Loading your account history…" : "Nothing here yet."
  }

  Repeater {
    model: root.groups

    Column {
      required property var modelData
      width: parent.width
      spacing: Style.space(2)

      Item {
        width: parent.width
        implicitHeight: dayHeader.implicitHeight + Style.space(4)

        Caption {
          id: dayHeader
          anchors.left: parent.left
          anchors.bottom: parent.bottom
          theme: root.theme
          text: modelData.header
        }
        Text {
          anchors.right: parent.right
          anchors.bottom: parent.bottom
          text: Format.formatSigned(modelData.net, root.symbol)
          color: root.theme.faint
          font.family: root.theme.fontFamily
          font.pixelSize: Style.font.caption
        }
      }

      Repeater {
        model: modelData.rows

        ListRow {
          required property var modelData
          width: parent.width
          theme: root.theme
          icon: modelData.icon
          iconColor: modelData.amount >= 0 ? root.theme.profit : root.theme.dim
          title: modelData.title
          subtitle: [Format.clock(modelData.time), modelData.detail].filter(function(s) { return s !== "" }).join(" · ")
          value: Format.formatSigned(modelData.amount, root.symbol)
          valueTone: modelData.kind === "trade" ? null : modelData.amount
          subValue: modelData.realized !== null && modelData.realized !== undefined
            ? "P/L " + Format.formatSigned(modelData.realized, root.symbol)
            : modelData.fees > 0 ? "fees " + Format.formatFull(modelData.fees, root.symbol) : ""
          subTone: modelData.realized !== null && modelData.realized !== undefined ? modelData.realized : null
          clickable: modelData.rawTicker !== ""
          onClicked: root.host.openPosition(modelData.rawTicker)
        }
      }
    }
  }

  Button {
    visible: root.totalRows > root.rows.length
    text: "Show more (" + (root.totalRows - root.rows.length) + ")"
    foreground: root.theme.foreground
    accent: root.theme.accent
    fontFamily: root.theme.fontFamily
    fontSize: Style.font.caption
    bordered: true
    onClicked: root.limit += 150
  }
}
