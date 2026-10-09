import QtQuick
import qs.Commons
import qs.Ui
import "../components"
import "../lib/Format.js" as Format
import "../lib/Cash.js" as Cash
import "../lib/Portfolio.js" as Portfolio
import "../lib/Icons.js" as Icons

// Cash tab: where the money outside investments sits (spending pot, trading
// cash) and where it goes — card spending by day and month, pace against
// last month, cashback, fees, transfers, the biggest payments, and the
// pot's balance over time.
Scroller {
  id: root

  required property var service
  required property var theme
  required property var host

  spacing: Style.space(14)

  readonly property var summary: service.summary
  readonly property string symbol: service.symbol
  readonly property var analysis: service.spending
  readonly property string chartMode: host.setting("cashChart", "days") === "months" ? "months" : "days"
  readonly property var pace: Cash.paceVsLastMonth(analysis)
  readonly property var bars: {
    if (!analysis) return []
    var out = []
    var src = chartMode === "months" ? analysis.months : analysis.days
    for (var i = 0; i < src.length; i++) out.push({ label: src[i].label, value: src[i].spend, count: src[i].count, key: src[i].key })
    return out
  }
  readonly property var potSeries: Portfolio.potSeries(service.history, summary, service.now)
  readonly property bool transfersNever: service.cashRules.transferMin >= Cash.NEVER

  function textKey(t) {
    if (t === "c") {
      host.persistSetting("cashChart", chartMode === "days" ? "months" : "days")
      return true
    }
    return false
  }

  // ---- Balances.
  StatGrid {
    visible: root.summary !== null
    width: parent.width
    theme: root.theme
    stats: {
      var s = root.summary
      if (!s) return []
      return [
        { label: "Spending pot", value: Format.formatFull(s.pot, root.symbol) },
        { label: "Invest cash", value: Format.formatFull(s.cash, root.symbol),
          sub: s.pieCash > 0 || s.reserved > 0 ? "free " + Format.formatBar(s.free, root.symbol) + " · pies " + Format.formatBar(s.pieCash, root.symbol) : "" },
        { label: "Outside investments", value: Format.formatFull(s.pot + s.cash, root.symbol),
          sub: s.total > 0 ? Format.formatWeight((s.pot + s.cash) / s.total * 100) + " of account" : "" }
      ]
    }
  }

  Note {
    visible: root.analysis === null
    theme: root.theme
    text: root.service.missingScopes["history:transactions"]
      ? "Your API key lacks the transactions history permission — regenerate it with History → Transactions enabled to see spending."
      : "Syncing your transaction history…"
  }

  // ---- This month.
  Card {
    visible: root.analysis !== null
    width: parent.width
    theme: root.theme

    Item {
      width: parent.width
      implicitHeight: Math.max(monthLeft.implicitHeight, monthRight.implicitHeight)

      Column {
        id: monthLeft
        spacing: Style.space(2)

        Caption { theme: root.theme; text: "Spent this month" }
        Text {
          text: root.analysis ? Format.formatFull(root.analysis.thisMonth.spend, root.symbol) : ""
          color: root.theme.foreground
          font.family: root.theme.fontFamily
          font.pixelSize: Style.font.display
          font.bold: true
        }
        Text {
          visible: root.pace !== null
          text: root.analysis && root.pace !== null
            ? Format.formatPercent(root.pace) + " vs " + Format.formatFull(root.analysis.lastMonthToDate, root.symbol) + " by this day last month"
            : ""
          // Spending more is the "bad" direction.
          color: root.theme.pl(root.pace === null ? 0 : -root.pace)
          font.family: root.theme.fontFamily
          font.pixelSize: Style.font.caption
        }
      }

      Column {
        id: monthRight
        anchors.right: parent.right
        anchors.top: parent.top
        spacing: Style.space(6)

        Stat {
          anchors.right: parent.right
          theme: root.theme
          label: "Projected"
          value: root.analysis && root.analysis.thisMonth.projected !== null ? Format.formatFull(root.analysis.thisMonth.projected, root.symbol) : "—"
        }
        Stat {
          anchors.right: parent.right
          theme: root.theme
          label: "Avg month"
          value: root.analysis && root.analysis.avgMonthly !== null ? Format.formatFull(root.analysis.avgMonthly, root.symbol) : "—"
        }
      }
    }

    Text {
      text: root.analysis ? Format.plural(root.analysis.thisMonth.count, "card payment")
        + (root.analysis.thisMonth.biggest ? " · biggest " + Format.formatFull(root.analysis.thisMonth.biggest.amount, root.symbol) + " on " + Format.shortDate(root.analysis.thisMonth.biggest.time) : "")
        + " · last month " + Format.formatFull(root.analysis.lastMonth.spend, root.symbol) : ""
      color: root.theme.dim
      font.family: root.theme.fontFamily
      font.pixelSize: Style.font.caption
      width: parent.width
      wrapMode: Text.Wrap
    }
  }

  // ---- Spending chart.
  Column {
    visible: root.analysis !== null
    width: parent.width
    spacing: Style.space(6)

    Item {
      width: parent.width
      implicitHeight: modeGroup.implicitHeight

      ButtonGroup {
        id: modeGroup
        focusable: false
        options: [{ value: "days", label: "30 days" }, { value: "months", label: "12 months" }]
        value: root.chartMode
        foreground: root.theme.foreground
        accent: root.theme.accent
        fontFamily: root.theme.fontFamily
        fontSize: Style.font.caption
        spacing: Style.space(4)
        onChanged: function(value) { root.host.persistSetting("cashChart", value) }
      }

      Text {
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        text: {
          var i = spendChart.hoverIndex
          if (i >= 0 && i < root.bars.length) {
            var b = root.bars[i]
            return (root.chartMode === "months" ? Format.monthLabel(b.key, true) : b.label) + " · " + Format.formatFull(b.value, root.symbol) + " · " + Format.plural(b.count, "payment")
          }
          var total = 0
          for (var j = 0; j < root.bars.length; j++) total += root.bars[j].value
          return Format.formatFull(total, root.symbol) + (root.chartMode === "months" ? " in 12 months" : " in 30 days")
        }
        color: spendChart.hoverIndex >= 0 ? root.theme.foreground : root.theme.dim
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.caption
      }
    }

    BarChart {
      id: spendChart
      width: parent.width
      height: Style.space(90)
      theme: root.theme
      values: root.bars
      barColor: root.theme.urgent
    }

    Item {
      width: parent.width
      implicitHeight: firstLabel.implicitHeight

      Text {
        id: firstLabel
        text: root.bars.length > 0 ? root.bars[0].label : ""
        color: root.theme.faint
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.caption
      }
      Text {
        anchors.right: parent.right
        text: root.bars.length > 0 ? root.bars[root.bars.length - 1].label : ""
        color: root.theme.faint
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.caption
      }
    }
  }

  // ---- Flows this month.
  StatGrid {
    visible: root.analysis !== null
    width: parent.width
    theme: root.theme
    stats: {
      var a = root.analysis
      if (!a) return []
      return [
        { label: "Cashback", value: "+" + Format.formatFull(a.thisMonth.cashback, root.symbol), tone: 1,
          sub: "total " + Format.formatFull(a.totals.cashback, root.symbol) + (a.cashbackRate !== null ? " · " + a.cashbackRate.toFixed(2) + "%" : "") },
        { label: "Fees", value: Format.formatFull(a.thisMonth.fees, root.symbol), sub: "total " + Format.formatFull(a.totals.fees, root.symbol) },
        { label: "Interest", value: Format.formatFull(a.totals.interest, root.symbol), sub: "all time" },
        { label: "Top-ups", value: Format.formatFull(a.thisMonth.topUps, root.symbol), sub: "last month " + Format.formatBar(a.lastMonth.topUps, root.symbol) },
        { label: "To bank", value: Format.formatFull(a.thisMonth.withdrawals, root.symbol), sub: "last month " + Format.formatBar(a.lastMonth.withdrawals, root.symbol) },
        { label: "Spent all time", value: Format.formatFull(a.totals.spend, root.symbol), sub: Format.plural(a.totals.count, "payment") }
      ]
    }
  }

  // ---- Biggest payments.
  Column {
    visible: root.analysis !== null && root.analysis.largest.length > 0
    width: parent.width
    spacing: Style.space(2)

    Caption { theme: root.theme; text: "Biggest payments · 30 days" }
    Repeater {
      model: root.analysis ? root.analysis.largest : []
      ListRow {
        required property var modelData
        width: parent.width
        theme: root.theme
        icon: Icons.spend
        title: Format.longDate(modelData.time)
        subtitle: Format.relativeDay(modelData.time, root.service.now) + " · " + Format.clock(modelData.time)
        value: "-" + Format.formatFull(modelData.amount, root.symbol)
      }
    }
  }

  // ---- Weekday pattern.
  Column {
    visible: root.analysis !== null && root.analysis.totals.spend > 0
    width: parent.width
    spacing: Style.space(4)

    Caption { theme: root.theme; text: "By weekday · 90 days" }
    BarChart {
      id: weekdayChart
      width: parent.width
      height: Style.space(44)
      theme: root.theme
      highlightLast: false
      barColor: root.theme.urgent
      values: {
        var names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        var out = []
        var w = root.analysis ? root.analysis.weekdays : []
        for (var i = 0; i < 7; i++) out.push({ label: names[i], value: w[i] || 0 })
        return out
      }
    }
    Row {
      width: parent.width
      Repeater {
        model: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        Text {
          required property var modelData
          required property int index
          width: parent.width / 7
          horizontalAlignment: Text.AlignHCenter
          text: weekdayChart.hoverIndex === index && root.analysis ? Format.formatBar(root.analysis.weekdays[index], root.symbol) : modelData
          color: weekdayChart.hoverIndex === index ? root.theme.foreground : root.theme.faint
          font.family: root.theme.fontFamily
          font.pixelSize: Style.font.caption
        }
      }
    }
  }

  // ---- Pot balance over time.
  Column {
    width: parent.width
    spacing: Style.space(6)

    Item {
      width: parent.width
      implicitHeight: potCaption.implicitHeight

      Caption { id: potCaption; theme: root.theme; text: "Pot + cash balance" }
      Text {
        anchors.right: parent.right
        visible: root.potSeries.points.length >= 2
        text: potChart.hoverPoint
          ? (potChart.hoverPoint.date === "" ? "Now" : Format.shortDate(potChart.hoverPoint.ts)) + " · " + Format.formatFull(potChart.hoverPoint.value, root.symbol)
          : Format.formatSigned(root.potSeries.changeAbs, root.symbol) + " since " + Format.shortDate(root.potSeries.firstTs)
        color: root.theme.dim
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.caption
      }
    }

    Item {
      width: parent.width
      height: Style.space(70)

      LineChart {
        id: potChart
        anchors.fill: parent
        visible: root.potSeries.points.length >= 2
        theme: root.theme
        series: root.potSeries
      }

      Note {
        visible: root.potSeries.points.length < 2
        anchors.centerIn: parent
        theme: root.theme
        horizontalAlignment: Text.AlignHCenter
        text: "The pot balance is recorded daily from now on."
      }
    }
  }

  Note {
    theme: root.theme
    text: "Trading 212 labels card payments as plain withdrawals, so spending is estimated: "
      + (root.transfersNever ? "every withdrawal counts as spending" : "withdrawals of a whole amount ≥ " + Format.formatBar(root.service.cashRules.transferMin, root.symbol) + " count as bank transfers")
      + ", deposits under " + Format.formatFull(root.service.cashRules.cashbackMax, root.symbol) + " as cashback. Adjust in Settings."
  }
}
