import QtQuick
import qs.Commons
import qs.Ui
import "../components"
import "../lib/Format.js" as Format
import "../lib/Portfolio.js" as Portfolio
import "../lib/Market.js" as Market

// Holdings tab: every open position (sortable, with today's move and its
// weight in the portfolio), then pies. Enter / click opens a position's
// detail page; Backspace returns to the list.
Item {
  id: root

  required property var service
  required property var theme
  required property var host

  property int cursor: -1
  property string selected: ""

  readonly property string symbol: service.symbol
  readonly property var market: service.market
  readonly property string sort: Portfolio.normalizeSort(host.setting("holdingsSort", "value"))
  readonly property var rows: Portfolio.sortPositions(service.positions, sort, todayPct)
  readonly property real totalValue: {
    var sum = 0
    for (var i = 0; i < service.positions.length; i++) sum += service.positions[i].value
    return sum
  }
  readonly property var selectedPosition: {
    for (var i = 0; i < service.positions.length; i++)
      if (service.positions[i].rawTicker === selected) return service.positions[i]
    return null
  }

  function todayPct(position) {
    var q = market.quotes[Market.nasdaqSymbol(position)]
    return q ? q.changePct : null
  }

  function open(rawTicker) {
    selected = rawTicker
    for (var i = 0; i < rows.length; i++) if (rows[i].rawTicker === rawTicker) cursor = i
    market.fetchNews(selectedPosition)
  }

  function move(dy) {
    if (selectedPosition) {
      detail.scrollBy(dy * Style.space(48))
      return
    }
    if (rows.length === 0) return
    cursor = Math.max(0, Math.min(rows.length - 1, cursor < 0 ? 0 : cursor + dy))
    list.reveal(repeater.itemAt(cursor))
  }

  function activate() {
    if (!selectedPosition && cursor >= 0 && cursor < rows.length) open(rows[cursor].rawTicker)
  }

  function back() {
    if (!selectedPosition) return false
    selected = ""
    return true
  }

  function textKey(t) {
    if (t === "s" && !selectedPosition) {
      host.persistSetting("holdingsSort", Portfolio.nextSort(sort))
      return true
    }
    if (t === "o" && selectedPosition) {
      host.openUrl(Market.quoteUrl(selectedPosition))
      return true
    }
    return false
  }

  Scroller {
    id: list
    anchors.fill: parent
    visible: !root.selectedPosition
    spacing: Style.space(6)

    Item {
      width: parent.width
      implicitHeight: sortButton.implicitHeight

      Caption {
        anchors.left: parent.left
        anchors.verticalCenter: parent.verticalCenter
        theme: root.theme
        text: root.rows.length + " holdings · " + Format.formatFull(root.totalValue, root.symbol)
      }

      Button {
        id: sortButton
        anchors.right: parent.right
        text: "Sort: " + Portfolio.sortTitle(root.sort)
        tooltipText: "Cycle sort order (s)"
        foreground: root.theme.foreground
        accent: root.theme.accent
        fontFamily: root.theme.fontFamily
        fontSize: Style.font.caption
        bordered: true
        verticalPadding: Style.space(2)
        horizontalPadding: Style.space(7)
        onClicked: root.host.persistSetting("holdingsSort", Portfolio.nextSort(root.sort))
      }
    }

    Note {
      visible: root.service.positionsLoaded && root.rows.length === 0
      theme: root.theme
      text: "No open positions."
    }

    Note {
      visible: !root.service.positionsLoaded
      theme: root.theme
      text: root.service.missingScopes["positions"]
        ? "Your API key lacks the Portfolio permission — regenerate it with Portfolio enabled to list holdings."
        : "Loading positions…"
    }

    Repeater {
      id: repeater
      model: root.rows

      ListRow {
        required property var modelData
        required property int index
        width: parent.width
        theme: root.theme
        hasCursor: index === root.cursor
        clickable: true
        title: modelData.name
        subtitle: modelData.ticker + " · " + Format.formatQuantity(modelData.quantity) + " @ "
          + Format.formatFull(modelData.avgPrice, Format.currencySymbol(modelData.instrumentCurrency))
          + " · " + Format.formatWeight(root.totalValue > 0 ? modelData.value / root.totalValue * 100 : 0)
        value: Format.formatFull(modelData.value, root.symbol)
        badge: {
          var pct = root.todayPct(modelData)
          return pct === null ? "" : Format.formatPercent(pct)
        }
        badgeTone: root.todayPct(modelData)
        subValue: Format.formatSigned(modelData.pl, root.symbol) + (modelData.plPct === null ? "" : " (" + Format.formatPercent(modelData.plPct) + ")")
        subTone: modelData.pl
        onClicked: root.open(modelData.rawTicker)
      }
    }

    // ---- Pies.
    Caption {
      visible: root.service.pies.length > 0
      topPadding: Style.space(10)
      theme: root.theme
      text: "Pies"
    }

    Repeater {
      model: root.service.pies

      Card {
        required property var modelData
        width: parent.width
        theme: root.theme

        Item {
          width: parent.width
          implicitHeight: pieName.implicitHeight

          Text {
            id: pieName
            anchors.left: parent.left
            anchors.right: pieValue.left
            anchors.rightMargin: Style.space(8)
            text: modelData.name
            color: root.theme.foreground
            font.family: root.theme.fontFamily
            font.pixelSize: Style.font.body
            elide: Text.ElideRight
          }

          Text {
            id: pieValue
            anchors.right: parent.right
            text: Format.formatFull(modelData.value, root.symbol)
            color: root.theme.foreground
            font.family: root.theme.fontFamily
            font.pixelSize: Style.font.body
          }
        }

        Item {
          width: parent.width
          implicitHeight: pieInvested.implicitHeight

          Text {
            id: pieInvested
            text: "Invested " + Format.formatFull(modelData.invested, root.symbol)
              + (modelData.cash > 0.005 ? " · cash " + Format.formatFull(modelData.cash, root.symbol) : "")
              + (modelData.dividendsGained > 0 ? " · dividends " + Format.formatFull(modelData.dividendsGained, root.symbol) : "")
            color: root.theme.dim
            font.family: root.theme.fontFamily
            font.pixelSize: Style.font.caption
          }

          Text {
            anchors.right: parent.right
            text: Format.formatSigned(modelData.result, root.symbol) + (modelData.resultPct === null ? "" : " (" + Format.formatPercent(modelData.resultPct) + ")")
            color: root.theme.pl(modelData.result)
            font.family: root.theme.fontFamily
            font.pixelSize: Style.font.caption
          }
        }

        RangeBar {
          visible: modelData.goal !== null && modelData.goal > 0
          width: parent.width
          theme: root.theme
          filled: true
          position: modelData.goal > 0 ? Math.min(1, modelData.value / modelData.goal) : null
          lowText: "Goal " + Format.formatFull(modelData.goal || 0, root.symbol)
          highText: modelData.goal > 0 ? Format.formatWeight(modelData.value / modelData.goal * 100) : ""
        }

        // Current vs target share of the largest slices.
        Repeater {
          model: modelData.instruments.slice(0, 5)

          Item {
            required property var modelData
            width: parent.width
            implicitHeight: sliceLabel.implicitHeight

            Text {
              id: sliceLabel
              text: modelData.ticker
              color: root.theme.foreground
              font.family: root.theme.fontFamily
              font.pixelSize: Style.font.caption
            }

            Text {
              anchors.right: parent.right
              text: Format.formatWeight(modelData.currentShare) + " / target " + Format.formatWeight(modelData.expectedShare)
              color: Math.abs(modelData.currentShare - modelData.expectedShare) >= 5 ? root.theme.urgent : root.theme.dim
              font.family: root.theme.fontFamily
              font.pixelSize: Style.font.caption
            }
          }
        }
      }
    }
  }

  PositionDetail {
    id: detail
    anchors.fill: parent
    visible: root.selectedPosition !== null
    service: root.service
    theme: root.theme
    host: root.host
    position: root.selectedPosition
    weight: root.selectedPosition && root.totalValue > 0 ? root.selectedPosition.value / root.totalValue * 100 : 0
    onBackRequested: root.back()
  }
}
