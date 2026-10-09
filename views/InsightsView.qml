import QtQuick
import qs.Commons
import qs.Ui
import "../components"
import "../lib/Format.js" as Format
import "../lib/Portfolio.js" as Portfolio
import "../lib/Activity.js" as Activity
import "../lib/Market.js" as Market

// Insights tab: all-in performance, allocation by holding / sector /
// currency, concentration, dividend income (received and projected),
// trading habits, and market mood + FX.
Scroller {
  id: root

  required property var service
  required property var theme
  required property var host

  spacing: Style.space(16)

  readonly property var summary: service.summary
  readonly property string symbol: service.symbol
  readonly property var market: service.market
  readonly property var store: service.activity.store
  readonly property var dividends: Activity.dividendStats(store.dividends, service.now)
  readonly property var trading: Activity.tradingStats(store.orders, service.now)
  readonly property var perf: Portfolio.performance(summary, dividends.total, trading.fees)
  readonly property var concentration: Portfolio.concentration(service.positions)
  readonly property var income: Market.projectedIncome(service.positions, market.profiles, market.fx, summary && summary.currency ? summary.currency : "EUR")
  readonly property string groupBy: {
    var g = host.setting("allocationBy", "holding")
    return g === "sector" || g === "currency" ? g : "holding"
  }
  readonly property var allocation: {
    var positions = service.positions
    var profiles = market.profiles
    var groups = Portfolio.allocation(positions, function(p) {
      if (root.groupBy === "sector") {
        var prof = profiles[Market.nasdaqSymbol(p)]
        return prof && prof.sector ? prof.sector : "Unknown"
      }
      if (root.groupBy === "currency") return p.instrumentCurrency || "—"
      return p.ticker
    })
    return Portfolio.topGroups(groups, 7)
  }

  function textKey(t) {
    if (t === "a") {
      var order = ["holding", "sector", "currency"]
      host.persistSetting("allocationBy", order[(order.indexOf(groupBy) + 1) % order.length])
      return true
    }
    return false
  }

  // ---- Performance.
  Column {
    visible: root.perf !== null
    width: parent.width
    spacing: Style.space(8)

    Caption { theme: root.theme; text: "Performance · all time" }
    StatGrid {
      width: parent.width
      theme: root.theme
      stats: {
        var p = root.perf
        if (!p) return []
        return [
          { label: "Total gain", value: Format.formatSigned(p.gain, root.symbol), tone: p.gain, sub: "P/L + realized + dividends" },
          { label: "Unrealized", value: Format.formatSigned(p.unrealized, root.symbol), tone: p.unrealized },
          { label: "Realized", value: Format.formatSigned(p.realized, root.symbol), tone: p.realized },
          { label: "Dividends", value: Format.formatFull(p.dividends, root.symbol), sub: Format.plural(root.dividends.count, "payment") },
          { label: "Trading fees", value: Format.formatFull(p.fees, root.symbol), sub: "FX & stamp duty" },
          { label: "Holdings", value: String(root.concentration.count), sub: root.service.pies.length > 0 ? root.service.pies.length + " pies" : "" }
        ]
      }
    }
  }

  // ---- Allocation.
  Column {
    visible: root.service.positions.length > 0
    width: parent.width
    spacing: Style.space(8)

    Item {
      width: parent.width
      implicitHeight: byGroup.implicitHeight

      Caption { anchors.verticalCenter: parent.verticalCenter; theme: root.theme; text: "Allocation" }
      ButtonGroup {
        id: byGroup
        anchors.right: parent.right
        focusable: false
        options: [
          { value: "holding", label: "Holding", tooltip: "Cycle grouping (a)" },
          { value: "sector", label: "Sector", tooltip: "Cycle grouping (a)" },
          { value: "currency", label: "Currency", tooltip: "Cycle grouping (a)" }
        ]
        value: root.groupBy
        foreground: root.theme.foreground
        accent: root.theme.accent
        fontFamily: root.theme.fontFamily
        fontSize: Style.font.caption
        spacing: Style.space(4)
        onChanged: function(value) { root.host.persistSetting("allocationBy", value) }
      }
    }

    AllocationBar {
      width: parent.width
      theme: root.theme
      symbol: root.symbol
      groups: root.allocation
    }

    StatGrid {
      width: parent.width
      theme: root.theme
      stats: [
        { label: "Top holding", value: Format.formatWeight(root.concentration.top1) },
        { label: "Top 3", value: Format.formatWeight(root.concentration.top3) },
        { label: "Top 5", value: Format.formatWeight(root.concentration.top5) }
      ]
    }
  }

  // ---- Dividends.
  Column {
    width: parent.width
    spacing: Style.space(8)

    Caption { theme: root.theme; text: "Dividend income" }
    StatGrid {
      width: parent.width
      theme: root.theme
      stats: [
        { label: "Last 12 months", value: Format.formatFull(root.dividends.last12m, root.symbol) },
        { label: "This year", value: Format.formatFull(root.dividends.ytd, root.symbol) },
        { label: "Projected / yr", value: root.income.payers > 0 ? Format.formatFull(root.income.total, root.symbol) : "—",
          sub: root.income.payers > 0 ? Format.plural(root.income.payers, "paying holding") : "no data yet" }
      ]
    }
    Repeater {
      model: root.dividends.byTicker.slice(0, 5)
      ListRow {
        required property var modelData
        width: parent.width
        theme: root.theme
        title: modelData.ticker
        subtitle: modelData.name + " · " + Format.plural(modelData.count, "payment")
        value: Format.formatFull(modelData.amount, root.symbol)
        subValue: modelData.last > 0 ? "last " + Format.shortDate(modelData.last) : ""
      }
    }
  }

  // ---- Trading.
  Column {
    visible: root.trading.buys + root.trading.sells > 0
    width: parent.width
    spacing: Style.space(8)

    Caption { theme: root.theme; text: "Trading" }
    StatGrid {
      width: parent.width
      theme: root.theme
      stats: [
        { label: "Buys", value: String(root.trading.buys), sub: Format.formatFull(root.trading.bought, root.symbol) },
        { label: "Sells", value: String(root.trading.sells), sub: Format.formatFull(root.trading.sold, root.symbol) },
        { label: "Last 30 days", value: Format.plural(root.trading.last30, "trade"),
          sub: root.trading.autoinvest > 0 ? root.trading.autoinvest + " autoinvest overall" : "" }
      ]
    }
  }

  // ---- Market.
  Column {
    visible: root.market.enabled && (root.market.mood !== null || root.market.fx !== null)
    width: parent.width
    spacing: Style.space(8)

    Caption { theme: root.theme; text: "Market" }

    Column {
      visible: root.market.mood !== null
      width: parent.width
      spacing: Style.space(4)

      Text {
        text: root.market.mood ? "Fear & Greed " + Math.round(root.market.mood.score) + " · " + Market.moodLabel(root.market.mood.rating) : ""
        color: root.theme.foreground
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.body
      }
      RangeBar {
        width: parent.width
        theme: root.theme
        position: root.market.mood ? root.market.mood.score / 100 : null
        lowText: "Extreme fear"
        highText: "Extreme greed"
      }
      Text {
        visible: root.market.mood !== null && root.market.mood.weekAgo !== null
        text: root.market.mood ? "1 week ago " + Math.round(root.market.mood.weekAgo || 0) + " · 1 month ago " + Math.round(root.market.mood.monthAgo || 0) : ""
        color: root.theme.dim
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.caption
      }
    }

    StatGrid {
      visible: root.market.fx !== null
      width: parent.width
      theme: root.theme
      stats: {
        var fx = root.market.fx
        if (!fx) return []
        var out = []
        var codes = ["USD", "GBP", "CHF"]
        for (var i = 0; i < codes.length; i++)
          if (fx.rates[codes[i]]) out.push({ label: fx.base + "/" + codes[i], value: fx.rates[codes[i]].toFixed(4), sub: "ECB " + fx.date })
        return out
      }
    }
  }

  Note {
    visible: !root.market.enabled
    theme: root.theme
    text: "Market data is off — sector allocation, projected income and market mood need it (Settings)."
  }
}
