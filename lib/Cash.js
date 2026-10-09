.pragma library
.import "Format.js" as Format
.import "Icons.js" as Icons

// Cash-flow and spending analysis over /equity/history/transactions.
//
// The API labels money movements only as DEPOSIT / WITHDRAW / FEE /
// TRANSFER / INTEREST_*; card payments from the spending pot show up as
// plain withdrawals and card cashback as tiny deposits. The categories here
// are therefore a heuristic, and the thresholds are user-tunable:
//   - a withdrawal of a whole amount ≥ transferMin is a transfer to the bank,
//     any other withdrawal is card spending;
//   - a deposit below cashbackMax is cashback, anything larger a top-up.

var DAY_MS = 86400000

var DEFAULT_RULES = { transferMin: 100, cashbackMax: 1 }

var CATEGORIES = {
  spend: { label: "Card spending", short: "Spend", icon: Icons.spend, inflow: false },
  transfer_out: { label: "Withdrawal to bank", short: "Withdrawal", icon: Icons.transferOut, inflow: false },
  topup: { label: "Top-up", short: "Top-up", icon: Icons.transferIn, inflow: true },
  cashback: { label: "Cashback", short: "Cashback", icon: Icons.cashback, inflow: true },
  fee: { label: "Fee", short: "Fee", icon: Icons.fee, inflow: false },
  interest: { label: "Interest", short: "Interest", icon: Icons.interest, inflow: true },
  transfer: { label: "Transfer", short: "Transfer", icon: Icons.transfer, inflow: true },
  other: { label: "Cash movement", short: "Other", icon: Icons.cash, inflow: true }
}

function rulesFrom(settings) {
  settings = settings || {}
  var transferMin = Number(settings.transferMin)
  var cashbackMax = Number(settings.cashbackMax)
  return {
    transferMin: isFinite(transferMin) && transferMin > 0 ? transferMin : DEFAULT_RULES.transferMin,
    cashbackMax: isFinite(cashbackMax) && cashbackMax >= 0 ? cashbackMax : DEFAULT_RULES.cashbackMax
  }
}

function classify(tx, rules) {
  rules = rules || DEFAULT_RULES
  var abs = Math.abs(tx.amount)
  if (tx.type === "DEPOSIT") return abs < rules.cashbackMax ? "cashback" : "topup"
  if (tx.type === "WITHDRAW") {
    var whole = Math.abs(abs - Math.round(abs)) < 0.005
    return whole && abs >= rules.transferMin ? "transfer_out" : "spend"
  }
  if (tx.type === "FEE") return "fee"
  if (tx.type === "INTEREST_ON_FREE_CASH" || tx.type === "LENDING_INTEREST") return "interest"
  if (tx.type === "TRANSFER") return "transfer"
  return "other"
}

function category(key) {
  return CATEGORIES[key] || CATEGORIES.other
}

function monthKeyOffset(nowMs, back) {
  var d = new Date(nowMs)
  var m = new Date(d.getFullYear(), d.getMonth() - back, 1)
  return Format.localMonth(m.getTime())
}

// Everything the Cash tab shows, in one pass. `orders` contributes trading
// fees (FX conversion, stamp duty) to the fee totals.
function analyze(transactions, orders, nowMs, rules) {
  rules = rules || DEFAULT_RULES
  var thisMonth = Format.localMonth(nowMs)
  var lastMonth = monthKeyOffset(nowMs, 1)
  var dayOfMonth = new Date(nowMs).getDate()

  var months = []
  var monthIndex = {}
  for (var back = 11; back >= 0; back--) {
    var key = monthKeyOffset(nowMs, back)
    monthIndex[key] = months.length
    months.push({ key: key, label: Format.monthLabel(key, false), spend: 0, cashback: 0, topUps: 0, withdrawals: 0, fees: 0, count: 0 })
  }

  var days = []
  var dayIndex = {}
  var todayStart = Format.dateStartMs(Format.localDate(nowMs))
  for (var d = 29; d >= 0; d--) {
    // Noon avoids DST edges when stepping back whole days.
    var dayMs = todayStart - d * DAY_MS + DAY_MS / 2
    var dayKey = Format.localDate(dayMs)
    dayIndex[dayKey] = days.length
    days.push({ key: dayKey, ts: dayMs, label: Format.shortDate(dayMs), spend: 0, count: 0 })
  }

  var weekdays = [0, 0, 0, 0, 0, 0, 0]
  var weekdayCutoff = nowMs - 90 * DAY_MS

  var out = {
    thisMonth: { spend: 0, count: 0, cashback: 0, topUps: 0, withdrawals: 0, fees: 0, biggest: null },
    lastMonth: { spend: 0, count: 0, cashback: 0, topUps: 0, withdrawals: 0, fees: 0 },
    lastMonthToDate: 0,
    totals: { spend: 0, cashback: 0, topUps: 0, withdrawals: 0, fees: 0, interest: 0, count: 0 },
    months: months,
    days: days,
    weekdays: weekdays,
    largest: [],
    firstTs: 0
  }

  var recentSpends = []
  for (var i = 0; i < transactions.length; i++) {
    var tx = transactions[i]
    if (!(tx.time > 0)) continue
    var cat = classify(tx, rules)
    var abs = Math.abs(tx.amount)
    var month = Format.localMonth(tx.time)
    var bucket = monthIndex[month] !== undefined ? months[monthIndex[month]] : null
    if (out.firstTs === 0 || tx.time < out.firstTs) out.firstTs = tx.time

    if (cat === "spend") {
      out.totals.spend += abs
      out.totals.count += 1
      if (bucket) { bucket.spend += abs; bucket.count += 1 }
      var dayKey2 = Format.localDate(tx.time)
      if (dayIndex[dayKey2] !== undefined) {
        days[dayIndex[dayKey2]].spend += abs
        days[dayIndex[dayKey2]].count += 1
      }
      if (tx.time >= weekdayCutoff) weekdays[(new Date(tx.time).getDay() + 6) % 7] += abs
      if (month === thisMonth) {
        out.thisMonth.spend += abs
        out.thisMonth.count += 1
        if (!out.thisMonth.biggest || abs > out.thisMonth.biggest.amount)
          out.thisMonth.biggest = { amount: abs, time: tx.time }
      }
      if (month === lastMonth) {
        out.lastMonth.spend += abs
        out.lastMonth.count += 1
        if (new Date(tx.time).getDate() <= dayOfMonth) out.lastMonthToDate += abs
      }
      if (nowMs - tx.time <= 30 * DAY_MS) recentSpends.push({ amount: abs, time: tx.time, id: tx.id })
    } else if (cat === "cashback" || cat === "interest") {
      if (cat === "cashback") out.totals.cashback += abs
      else out.totals.interest += abs
      if (cat === "cashback") {
        if (bucket) bucket.cashback += abs
        if (month === thisMonth) out.thisMonth.cashback += abs
        if (month === lastMonth) out.lastMonth.cashback += abs
      }
    } else if (cat === "topup") {
      out.totals.topUps += abs
      if (bucket) bucket.topUps += abs
      if (month === thisMonth) out.thisMonth.topUps += abs
      if (month === lastMonth) out.lastMonth.topUps += abs
    } else if (cat === "transfer_out") {
      out.totals.withdrawals += abs
      if (bucket) bucket.withdrawals += abs
      if (month === thisMonth) out.thisMonth.withdrawals += abs
      if (month === lastMonth) out.lastMonth.withdrawals += abs
    } else if (cat === "fee") {
      addFee(out, bucket, month, thisMonth, lastMonth, abs)
    }
  }

  orders = orders || []
  for (var j = 0; j < orders.length; j++) {
    var o = orders[j]
    if (!(o.fees > 0) || !(o.time > 0)) continue
    var orderMonth = Format.localMonth(o.time)
    addFee(out, monthIndex[orderMonth] !== undefined ? months[monthIndex[orderMonth]] : null, orderMonth, thisMonth, lastMonth, o.fees)
  }

  recentSpends.sort(function(a, b) { return b.amount - a.amount })
  out.largest = recentSpends.slice(0, 5)

  // Average over the last three complete months that saw any spending, so
  // a new account doesn't average in empty months before it existed.
  var complete = []
  for (var k = months.length - 2; k >= 0 && complete.length < 3; k--)
    if (months[k].spend > 0) complete.push(months[k].spend)
  var sum = 0
  for (var n = 0; n < complete.length; n++) sum += complete[n]
  out.avgMonthly = complete.length > 0 ? sum / complete.length : null

  // Month-end projection from the daily pace so far.
  var daysInMonth = new Date(new Date(nowMs).getFullYear(), new Date(nowMs).getMonth() + 1, 0).getDate()
  out.thisMonth.projected = dayOfMonth > 0 ? out.thisMonth.spend / dayOfMonth * daysInMonth : null
  out.cashbackRate = out.totals.spend > 0 ? (out.totals.cashback / out.totals.spend) * 100 : null
  return out
}

function addFee(out, bucket, month, thisMonth, lastMonth, amount) {
  out.totals.fees += amount
  if (bucket) bucket.fees += amount
  if (month === thisMonth) out.thisMonth.fees += amount
  if (month === lastMonth) out.lastMonth.fees += amount
}

// Percent change of this month's spend against last month at the same
// day-of-month — the only fair mid-month comparison.
function paceVsLastMonth(analysis) {
  if (!analysis || !(analysis.lastMonthToDate > 0)) return null
  return ((analysis.thisMonth.spend - analysis.lastMonthToDate) / analysis.lastMonthToDate) * 100
}
