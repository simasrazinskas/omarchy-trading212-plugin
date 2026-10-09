import QtQuick
import qs.Commons
import qs.Ui
import "../components"
import "../lib/Format.js" as Format
import "../lib/Market.js" as Market
import "../lib/Activity.js" as Activity
import "../lib/Icons.js" as Icons

// One holding in depth: price and chart from Nasdaq, 52-week range, your
// position, fundamentals, your trades and dividends in it, and headlines.
Scroller {
  id: root

  required property var service
  required property var theme
  required property var host
  property var position: null
  property real weight: 0
  property string chartRange: "3M"

  signal backRequested()

  spacing: Style.space(14)

  readonly property string symbol: service.symbol
  readonly property var market: service.market
  readonly property string sym: position ? Market.nasdaqSymbol(position) : ""
  readonly property var quote: sym !== "" ? market.quotes[sym] || null : null
  readonly property var profile: sym !== "" ? market.profiles[sym] || null : null
  readonly property var earnings: sym !== "" ? market.earnings[sym] || null : null
  readonly property var chart: sym !== "" ? market.charts[sym] || null : null
  readonly property string priceSymbol: position ? Format.currencySymbol(position.instrumentCurrency) : ""
  readonly property real livePrice: quote && quote.price !== null ? (quote.extPrice !== null ? quote.extPrice : quote.price) : (position ? position.price : 0)
  readonly property var series: Market.chartWindow(chart, chartRange, livePrice, service.now)
  readonly property var trades: position ? Activity.forTicker(service.activity.store.orders, position.rawTicker, 8) : []
  readonly property var dividends: position ? Activity.forTicker(service.activity.store.dividends, position.rawTicker, 0) : []
  readonly property var newsEntry: position ? market.news[position.rawTicker] || null : null

  onPositionChanged: toTop()

  // ---- Header.
  Item {
    width: parent.width
    implicitHeight: Math.max(backButton.implicitHeight, heading.implicitHeight)

    Button {
      id: backButton
      anchors.left: parent.left
      anchors.verticalCenter: parent.verticalCenter
      iconText: Icons.back
      tooltipText: "Back to holdings (Backspace)"
      foreground: root.theme.foreground
      accent: root.theme.accent
      fontFamily: root.theme.fontFamily
      horizontalPadding: Style.space(6)
      onClicked: root.backRequested()
    }

    Column {
      id: heading
      anchors.left: backButton.right
      anchors.leftMargin: Style.space(8)
      anchors.right: openButton.left
      anchors.rightMargin: Style.space(8)
      anchors.verticalCenter: parent.verticalCenter
      spacing: Style.space(2)

      Text {
        width: parent.width
        text: root.position ? root.position.name : ""
        color: root.theme.foreground
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.heading
        font.bold: true
        elide: Text.ElideRight
      }

      Text {
        width: parent.width
        text: root.position ? [root.position.ticker, root.quote ? root.quote.exchange : "", root.profile ? root.profile.sector : "", root.profile ? root.profile.industry : ""]
          .filter(function(s) { return s !== "" }).join(" · ") : ""
        color: root.theme.dim
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.caption
        elide: Text.ElideRight
      }
    }

    Button {
      id: openButton
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      iconText: Icons.external
      tooltipText: "Open in Yahoo Finance (o)"
      foreground: root.theme.foreground
      accent: root.theme.accent
      fontFamily: root.theme.fontFamily
      horizontalPadding: Style.space(6)
      onClicked: if (root.position) root.host.openUrl(Market.quoteUrl(root.position))
    }
  }

  // ---- Price.
  Row {
    spacing: Style.space(10)

    Text {
      anchors.baseline: priceChange.baseline
      text: Format.formatFull(root.livePrice, root.priceSymbol)
      color: root.theme.foreground
      font.family: root.theme.fontFamily
      font.pixelSize: Style.font.display
      font.bold: true
    }

    Text {
      id: priceChange
      visible: root.quote !== null && root.quote.changePct !== null
      text: root.quote ? Format.formatPercent(root.quote.changePct) + (/^open$/i.test(root.quote.marketStatus) ? " today" : " last session")
        + (root.quote.extChangePct !== null ? " · " + Format.formatPercent(root.quote.extChangePct) + " " + root.quote.marketStatus.toLowerCase() : "") : ""
      color: root.theme.pl(root.quote ? root.quote.changePct : 0)
      font.family: root.theme.fontFamily
      font.pixelSize: Style.font.body
    }
  }

  // ---- Chart.
  Column {
    visible: root.sym !== ""
    width: parent.width
    spacing: Style.space(6)

    Item {
      width: parent.width
      implicitHeight: rangeGroup.implicitHeight

      ButtonGroup {
        id: rangeGroup
        focusable: false
        options: Market.CHART_RANGES
        value: root.chartRange
        foreground: root.theme.foreground
        accent: root.theme.accent
        fontFamily: root.theme.fontFamily
        fontSize: Style.font.caption
        spacing: Style.space(4)
        onChanged: function(value) { root.chartRange = value }
      }

      Text {
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        visible: root.series.points.length >= 2
        text: {
          var p = priceChart.hoverPoint
          if (p) return Format.shortDate(p.ts) + " · " + Format.formatFull(p.value, root.priceSymbol)
          return Format.formatPercent(root.series.changePct) + " · " + root.chartRange
        }
        color: priceChart.hoverPoint ? root.theme.foreground : root.theme.pl(root.series.changeAbs)
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.caption
      }
    }

    Item {
      width: parent.width
      height: Style.space(110)

      LineChart {
        id: priceChart
        anchors.fill: parent
        visible: root.series.points.length >= 2
        theme: root.theme
        series: root.series
        tone: root.series.changeAbs
        referenceLevel: root.position ? root.position.avgPrice : null
      }

      Note {
        visible: root.series.points.length < 2
        anchors.centerIn: parent
        theme: root.theme
        horizontalAlignment: Text.AlignHCenter
        text: root.market.enabled ? "Loading price history…" : "Market data is off (Settings)."
      }
    }

    Note {
      visible: root.series.points.length >= 2 && root.position !== null
        && root.position.avgPrice >= root.series.min && root.position.avgPrice <= root.series.max
      theme: root.theme
      font.italic: false
      text: "Dashed line: your average price " + Format.formatFull(root.position ? root.position.avgPrice : 0, root.priceSymbol)
    }
  }

  Note {
    visible: root.sym === "" && root.position !== null
    theme: root.theme
    text: "Live market data is only available for US listings; showing Trading 212's price."
  }

  // ---- 52-week range.
  Column {
    readonly property var low: root.quote && root.quote.low52 !== null ? root.quote.low52 : (root.profile ? root.profile.low52 : null)
    readonly property var high: root.quote && root.quote.high52 !== null ? root.quote.high52 : (root.profile ? root.profile.high52 : null)
    visible: root.sym !== "" && low !== null && high !== null && high > low
    width: parent.width
    spacing: Style.space(4)

    Caption { theme: root.theme; text: "52-week range" }
    RangeBar {
      width: parent.width
      theme: root.theme
      position: Market.rangePosition(root.livePrice, parent.low, parent.high)
      lowText: Format.formatFull(parent.low, root.priceSymbol)
      highText: Format.formatFull(parent.high, root.priceSymbol)
    }
  }

  // ---- Your position.
  Caption { theme: root.theme; text: "Your position" }
  StatGrid {
    width: parent.width
    theme: root.theme
    stats: {
      var p = root.position
      if (!p) return []
      var out = [
        { label: "Value", value: Format.formatFull(p.value, root.symbol), sub: Format.formatWeight(root.weight) + " of holdings" },
        { label: "P/L", value: Format.formatSigned(p.pl, root.symbol), tone: p.pl, sub: Format.formatPercent(p.plPct), subTone: p.pl },
        { label: "Cost", value: Format.formatFull(p.cost, root.symbol) },
        { label: "Shares", value: Format.formatQuantity(p.quantity), sub: p.quantityInPies > 0 ? Format.formatQuantity(p.quantityInPies) + " in pies" : "" },
        { label: "Avg price", value: Format.formatFull(p.avgPrice, root.priceSymbol) },
        { label: "Opened", value: p.openedAt > 0 ? Format.longDate(p.openedAt) : "—" }
      ]
      if (p.fxImpact !== null && p.fxImpact !== 0) out.push({ label: "FX impact", value: Format.formatSigned(p.fxImpact, root.symbol), tone: p.fxImpact })
      var received = 0
      for (var i = 0; i < root.dividends.length; i++) received += root.dividends[i].amount
      if (root.dividends.length > 0) out.push({ label: "Dividends", value: Format.formatFull(received, root.symbol), sub: Format.plural(root.dividends.length, "payment") })
      return out
    }
  }

  // ---- Fundamentals.
  Caption { visible: root.profile !== null || root.earnings !== null; theme: root.theme; text: "Company" }
  StatGrid {
    visible: root.profile !== null || root.earnings !== null
    width: parent.width
    theme: root.theme
    stats: {
      var pr = root.profile
      var out = []
      if (pr && pr.marketCap !== null) out.push({ label: "Market cap", value: "$" + Format.formatCompact(pr.marketCap) })
      if (pr && pr.pe !== null) out.push({ label: "P/E", value: pr.pe.toFixed(1) })
      if (pr && pr.target !== null) {
        var upside = root.livePrice > 0 ? (pr.target / root.livePrice - 1) * 100 : null
        out.push({ label: "1y target", value: Format.formatFull(pr.target, "$"), sub: upside === null ? "" : Format.formatPercent(upside) + " upside", subTone: upside })
      }
      if (pr && pr.yieldPct !== null && pr.yieldPct > 0) out.push({ label: "Yield", value: pr.yieldPct.toFixed(2) + "%", sub: pr.annualDividend !== null ? Format.formatFull(pr.annualDividend, "$") + " / yr" : "" })
      if (pr && pr.exDividend > 0) out.push({ label: "Ex-dividend", value: Format.shortDate(pr.exDividend), sub: Format.relativeDay(pr.exDividend, root.service.now) })
      var e = root.earnings
      if (e && e.time > 0) out.push({ label: "Earnings", value: Format.shortDate(e.time), sub: Format.relativeDay(e.time, root.service.now) + (e.estimated ? " · est." : "") + (e.epsForecast !== null ? " · EPS " + Format.formatFull(e.epsForecast, "$") : "") })
      return out
    }
  }

  // ---- Trades.
  Column {
    visible: root.trades.length > 0
    width: parent.width
    spacing: Style.space(2)

    Caption { theme: root.theme; text: "Your trades" }
    Repeater {
      model: root.trades
      ListRow {
        required property var modelData
        width: parent.width
        theme: root.theme
        icon: modelData.side === "SELL" ? Icons.sell : Icons.buy
        title: (modelData.side === "SELL" ? "Sold " : "Bought ") + Format.formatQuantity(modelData.quantity) + " @ " + Format.formatFull(modelData.price, root.priceSymbol)
        subtitle: Format.longDate(modelData.time) + (modelData.source ? " · " + modelData.source.toLowerCase().replace(/_/g, " ") : "")
        value: Format.formatFull(modelData.value, root.symbol)
        subValue: modelData.side === "SELL" && modelData.realized !== null ? "P/L " + Format.formatSigned(modelData.realized, root.symbol) : ""
        subTone: modelData.realized
      }
    }
  }

  // ---- News.
  Column {
    visible: root.market.enabled && root.position !== null
    width: parent.width
    spacing: Style.space(2)

    Caption { theme: root.theme; text: "News" }
    Note {
      visible: !root.newsEntry || root.newsEntry.items.length === 0
      theme: root.theme
      text: !root.newsEntry ? "Loading headlines…" : root.newsEntry.failed ? "Couldn't load headlines." : "No recent headlines."
    }
    Repeater {
      model: root.newsEntry ? root.newsEntry.items : []
      ListRow {
        required property var modelData
        width: parent.width
        theme: root.theme
        icon: Icons.news
        title: modelData.title
        subtitle: modelData.source + (modelData.time > 0 ? " · " + Format.age(modelData.time, root.service.now) : "")
        clickable: true
        onClicked: root.host.openUrl(modelData.link)
      }
    }
  }
}
