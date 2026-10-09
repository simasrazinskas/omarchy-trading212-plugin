import QtQuick
import qs.Commons
import qs.Ui
import "../components"
import "../lib/Format.js" as Format
import "../lib/Portfolio.js" as Portfolio
import "../lib/Market.js" as Market
import "../lib/Icons.js" as Icons

// Overview tab: the whole account at a glance — total value split into
// investments / pot / cash, today's move, the performance graph, market
// context, today's movers, upcoming events and pending orders.
Scroller {
  id: root

  required property var service
  required property var theme
  required property var host

  spacing: Style.space(14)

  readonly property var summary: service.summary
  readonly property string symbol: service.symbol
  readonly property var daily: service.daily
  readonly property var market: service.market
  readonly property string metric: Portfolio.normalizeMetric(host.setting("chartMetric", "return"))
  readonly property string range: Portfolio.normalizeRange(host.setting("chartRange", "1M"))
  readonly property var series: Portfolio.series(service.history, summary, service.now, metric, range, service.realizedTimeline)
  readonly property var movers: Portfolio.movers(service.positions, function(p) { return root.market.quotes[Market.nasdaqSymbol(p)] || null })
  readonly property var events: Market.upcomingEvents(service.positions, market.profiles, market.earnings, service.now, 21)
  readonly property bool sessionOpen: /^open$/i.test(market.usMarketStatus)
  // The account currency against the dollar (EUR/USD, GBP/USD…); for a
  // dollar account, against the euro instead.
  readonly property string fxQuote: summary && summary.currency === "USD" ? "EUR" : "USD"
  readonly property string fxBase: summary && summary.currency !== "" ? summary.currency : "EUR"
  readonly property var fxRate: Market.crossRate(fxBase, fxQuote, market.fx)

  function textKey(t) {
    if (t === "m") {
      host.persistSetting("chartMetric", Portfolio.METRICS[(Portfolio.METRICS.indexOf(metric) + 1) % Portfolio.METRICS.length])
      return true
    }
    if (t === "g") {
      host.persistSetting("chartRange", Portfolio.RANGES[(Portfolio.RANGES.indexOf(range) + 1) % Portfolio.RANGES.length])
      return true
    }
    return false
  }

  // ---- Hero: account total and today's move.
  Item {
    width: parent.width
    implicitHeight: Math.max(heroLeft.implicitHeight, heroRight.implicitHeight)

    Column {
      id: heroLeft
      anchors.left: parent.left
      spacing: Style.space(2)

      Caption { theme: root.theme; text: "Account value" }
      Text {
        text: root.summary ? Format.formatFull(root.summary.total, root.symbol) : "—"
        color: root.theme.foreground
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.display
        font.bold: true
      }
    }

    Column {
      id: heroRight
      anchors.right: parent.right
      anchors.bottom: parent.bottom
      spacing: Style.space(2)
      visible: root.daily !== null

      Caption {
        anchors.right: parent.right
        theme: root.theme
        text: root.daily && root.daily.sinceOpen ? "Today (since open)" : "Today"
      }
      Text {
        anchors.right: parent.right
        text: root.daily ? Format.formatSigned(root.daily.abs, root.symbol) + (root.daily.pct === null ? "" : "  " + Format.formatPercent(root.daily.pct)) : ""
        color: root.theme.pl(root.daily ? root.daily.abs : 0)
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.subtitle
      }
    }
  }

  // Composition of the total as a share bar.
  AllocationBar {
    visible: root.summary !== null && root.summary.total > 0
    width: parent.width
    theme: root.theme
    symbol: root.symbol
    groups: Portfolio.composition(root.summary)
  }

  StatGrid {
    visible: root.summary !== null
    width: parent.width
    theme: root.theme
    stats: {
      var s = root.summary
      if (!s) return []
      return [
        { label: "Invested", value: Format.formatFull(s.invested, root.symbol) },
        { label: "Value", value: Format.formatFull(s.value, root.symbol) },
        { label: "P/L", value: Format.formatSigned(s.pl, root.symbol), tone: s.pl, sub: Format.formatPercent(s.plPct), subTone: s.pl },
        { label: "Realized", value: Format.formatSigned(s.realized, root.symbol), tone: s.realized },
        { label: "Return", value: Format.formatSigned(s.pl + s.realized, root.symbol), tone: s.pl + s.realized },
        { label: "Account today", value: root.daily && root.daily.account !== null ? Format.formatSigned(root.daily.account, root.symbol) : "—",
          sub: root.daily && root.daily.account !== null ? "incl. spending" : "", tone: root.daily && root.daily.account !== null ? root.daily.account : null }
      ]
    }
  }

  // ---- Performance graph.
  Card {
    visible: root.summary !== null
    width: parent.width
    theme: root.theme

    Item {
      width: parent.width
      implicitHeight: metricGroup.implicitHeight

      ButtonGroup {
        id: metricGroup
        anchors.left: parent.left
        focusable: false
        options: [
          { value: "account", label: "Account", tooltip: "Total account value, pot and cash included (m)" },
          { value: "return", label: "Return", tooltip: "Unrealized + realized P/L — unaffected by deposits, sales and spending (m)" },
          { value: "value", label: "Invested", tooltip: "Market value of your investments (m)" }
        ]
        value: root.metric
        foreground: root.theme.foreground
        accent: root.theme.accent
        fontFamily: root.theme.fontFamily
        fontSize: Style.font.caption
        spacing: Style.space(4)
        onChanged: function(value) { root.host.persistSetting("chartMetric", value) }
      }

      Text {
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        visible: root.series.points.length >= 2
        text: {
          var p = chart.hoverPoint
          if (p) return (p.date === "" ? "Now" : Format.shortDate(p.ts)) + " · " + Format.formatFull(p.value, root.symbol)
          var s = root.series
          return Format.formatSigned(s.changeAbs, root.symbol) + (s.changePct === null ? "" : " (" + Format.formatPercent(s.changePct) + ")")
        }
        color: chart.hoverPoint ? root.theme.foreground : root.theme.pl(root.series.changeAbs)
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.caption
      }
    }

    Item {
      width: parent.width
      height: Style.space(120)

      LineChart {
        id: chart
        anchors.fill: parent
        theme: root.theme
        series: root.series
        tone: root.series.changeAbs
        referenceLevel: root.metric === "return" ? 0 : null
        visible: root.series.points.length >= 2
      }

      Note {
        visible: root.series.points.length < 2
        anchors.centerIn: parent
        theme: root.theme
        horizontalAlignment: Text.AlignHCenter
        text: root.metric === "account"
          ? "Account value (with the spending pot) is recorded from today — the graph builds up daily. Try Return or Invested for past data."
          : "Recording daily snapshots — the graph builds up from here."
      }
    }

    ButtonGroup {
      focusable: false
      options: Portfolio.RANGES
      value: root.range
      foreground: root.theme.foreground
      accent: root.theme.accent
      fontFamily: root.theme.fontFamily
      fontSize: Style.font.caption
      spacing: Style.space(4)
      onChanged: function(value) { root.host.persistSetting("chartRange", value) }
    }
  }

  // ---- Market context.
  Row {
    visible: root.market.enabled && (root.market.usMarketStatus !== "" || root.market.mood !== null || root.fxRate !== null)
    width: parent.width
    spacing: Style.space(20)

    Stat {
      visible: root.market.usMarketStatus !== ""
      theme: root.theme
      label: "US market"
      value: root.market.usMarketStatus
    }
    Stat {
      visible: root.market.mood !== null
      theme: root.theme
      label: "Fear & Greed"
      value: root.market.mood ? Math.round(root.market.mood.score) + " · " + Market.moodLabel(root.market.mood.rating) : ""
    }
    Stat {
      visible: root.fxRate !== null
      theme: root.theme
      label: root.fxBase + "/" + root.fxQuote
      value: root.fxRate !== null ? root.fxRate.toFixed(4) : ""
    }
  }

  // ---- Movers.
  Column {
    visible: root.movers.length > 0
    width: parent.width
    spacing: Style.space(4)

    Caption { theme: root.theme; text: root.sessionOpen ? "Today's movers" : "Movers · last session" }

    Repeater {
      model: {
        var m = root.movers
        if (m.length <= 6) return m
        return m.slice(0, 3).concat(m.slice(m.length - 3))
      }

      ListRow {
        required property var modelData
        width: parent.width
        theme: root.theme
        title: modelData.ticker
        subtitle: modelData.name
        value: Format.formatPercent(modelData.pct)
        valueTone: modelData.pct
        subValue: Format.formatSigned(modelData.abs, root.symbol)
        subTone: modelData.abs
        clickable: true
        onClicked: root.host.openPosition(modelData.rawTicker)
      }
    }
  }

  // ---- Coming up.
  Column {
    visible: root.events.length > 0
    width: parent.width
    spacing: Style.space(4)

    Caption { theme: root.theme; text: "Coming up · 3 weeks" }

    Repeater {
      model: root.events.slice(0, 6)

      ListRow {
        required property var modelData
        width: parent.width
        theme: root.theme
        icon: modelData.kind === "earnings" ? Icons.calendar : Icons.dividend
        title: modelData.ticker + " · " + Market.eventTitle(modelData.kind)
        subtitle: modelData.name + (modelData.estimated ? " · estimated" : "")
        value: Format.relativeDay(modelData.time, root.service.now)
        subValue: Format.shortDate(modelData.time)
        clickable: true
        onClicked: root.host.openPosition(modelData.rawTicker)
      }
    }
  }

  // ---- Pending orders.
  Column {
    visible: root.service.pendingOrders.length > 0
    width: parent.width
    spacing: Style.space(4)

    Caption { theme: root.theme; text: "Pending orders" }

    Repeater {
      model: root.service.pendingOrders

      ListRow {
        required property var modelData
        width: parent.width
        theme: root.theme
        icon: modelData.side === "SELL" ? Icons.sell : Icons.buy
        title: (modelData.side === "SELL" ? "Sell " : "Buy ") + modelData.ticker
        subtitle: modelData.type.toLowerCase() + " · " + Format.formatQuantity(modelData.quantity) + " sh"
          + (modelData.limitPrice !== null ? " @ " + Format.formatFull(modelData.limitPrice, Format.currencySymbol(modelData.instrumentCurrency)) : "")
        value: modelData.value !== null ? Format.formatFull(modelData.value, root.symbol) : ""
        subValue: modelData.status.toLowerCase()
      }
    }
  }
}
