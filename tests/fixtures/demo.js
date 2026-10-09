// A fictional demo account, written as fixture files for T212_FIXTURES:
// every Trading 212 and market-data response the plugin requests, plus a
// half-year of daily snapshots. Deterministic for a given day, and
// internally consistent (positions sum to the summary, fills to realized
// P/L), so every tab renders the way it would for a real account.
//
//   node tests/fixtures/demo.js <fixture-dir> <state-dir>
//
// <state-dir> plays $XDG_STATE_HOME: the snapshot history lands in
// <state-dir>/omarchy-trading212/history-live.jsonl.

const fs = require("fs")
const path = require("path")
const { load } = require("../harness")
const Shell = load("Shell.js")
const Market = load("Market.js")
const Format = load("Format.js")

const DAY = 86400000
const HOST = "https://live.trading212.com/api/v0"
const USD = 1.092 // USD per EUR
const FX = { USD: USD, GBP: 0.8436, CHF: 0.9381, JPY: 162.41, SEK: 11.37 }

// Seeded PRNG (mulberry32) so a run is reproducible.
function rng(seed) {
  let a = seed >>> 0
  return function() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const r2 = (n) => Math.round(n * 100) / 100
// Local time `daysAgo` days before `nowMs`, at hh:mm.
const at = (nowMs, daysAgo, hh, mm) => { const d = new Date(nowMs); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysAgo, hh, mm || 0).getTime() }
const iso = (ms) => new Date(ms).toISOString()
const mdy = (ms) => { const d = new Date(ms); return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}` }
const pretty = (ms) => { const d = new Date(ms); return `${Format.MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` }
const usd = (n) => "$" + Format.groupThousands(Math.floor(Math.abs(n))) + "." + Math.abs(n).toFixed(2).split(".")[1]

// rawTicker, name, ISIN, currency, quantity, average price, current price,
// today's % move, and profile data for the US listings.
const HOLDINGS = [
  { raw: "NVDA_US_EQ", name: "NVIDIA", isin: "US67066G1040", cur: "USD", qty: 24.5, avg: 98.4, price: 182.3, chg: 2.84,
    sector: "Technology", industry: "Semiconductors", cap: 4.45e12, pe: 52.1, target: 212, div: 0.04, yld: 0.02, earn: 40, low: 86.62, high: 195.62 },
  { raw: "MSFT_US_EQ", name: "Microsoft", isin: "US5949181045", cur: "USD", qty: 6.2, avg: 362.1, price: 498.7, chg: 0.62,
    sector: "Technology", industry: "Software", cap: 3.71e12, pe: 37.4, target: 560, div: 3.32, yld: 0.67, exdiv: 12, pay: 40, earn: 18, low: 344.79, high: 555.45 },
  { raw: "AAPL_US_EQ", name: "Apple", isin: "US0378331005", cur: "USD", qty: 11.8, avg: 171.25, price: 238.4, chg: -0.48,
    sector: "Technology", industry: "Consumer Electronics", cap: 3.54e12, pe: 36.2, target: 252, div: 1.04, yld: 0.44, earn: 21, low: 169.21, high: 260.1 },
  { raw: "AMZN_US_EQ", name: "Amazon.com", isin: "US0231351067", cur: "USD", qty: 9.4, avg: 142.6, price: 221.9, chg: 1.15,
    sector: "Consumer Discretionary", industry: "Internet Retail", cap: 2.37e12, pe: 33.8, target: 262, earn: 23, low: 161.38, high: 242.52 },
  { raw: "GOOGL_US_EQ", name: "Alphabet (Class A)", isin: "US02079K3059", cur: "USD", qty: 12, avg: 128.3, price: 246.1, chg: -1.32,
    sector: "Communication Services", industry: "Internet Content", cap: 2.98e12, pe: 26.3, target: 268, div: 0.84, yld: 0.34, earn: 20, low: 140.53, high: 256.0 },
  { raw: "KO_US_EQ", name: "Coca-Cola", isin: "US1912161007", cur: "USD", qty: 20, avg: 61.2, price: 68.95, chg: 0.21,
    sector: "Consumer Staples", industry: "Beverages", cap: 2.97e11, pe: 24.5, target: 77, div: 2.04, yld: 2.96, exdiv: 5, pay: 20, earn: 14, low: 60.62, high: 74.38 },
  { raw: "O_US_EQ", name: "Realty Income", isin: "US7561091049", cur: "USD", qty: 32, avg: 57.8, price: 56.1, chg: -0.74,
    sector: "Real Estate", industry: "REIT - Retail", cap: 5.09e10, pe: 53.4, target: 62, div: 3.22, yld: 5.74, exdiv: 22, pay: 37, earn: 26, low: 50.71, high: 61.2 },
  { raw: "VWCEd_EQ", name: "Vanguard FTSE All-World (Acc)", isin: "IE00BK5BQT80", cur: "EUR", qty: 38.2, avg: 108.4, price: 138.92, chg: 0.4 },
  { raw: "ASMLa_EQ", name: "ASML Holding", isin: "NL0010273215", cur: "EUR", qty: 3, avg: 712, price: 668.4, chg: -1.1 }
]

const POT = 742.35
const FREE = 312.4
const IN_PIES = 4.12

function eur(amount, cur) {
  return cur === "USD" ? amount / USD : amount
}

function positions(nowMs) {
  return HOLDINGS.map((h, i) => {
    const cost = r2(eur(h.qty * h.avg, h.cur))
    const value = r2(eur(h.qty * h.price, h.cur))
    const fxImpact = h.cur === "USD" ? r2(value * -0.018) : null
    return {
      instrument: { ticker: h.raw, name: h.name, isin: h.isin, currency: h.cur },
      quantity: h.qty,
      quantityInPies: ["KO_US_EQ", "O_US_EQ"].includes(h.raw) ? h.qty * 0.5 : 0,
      averagePricePaid: h.avg,
      currentPrice: h.price,
      createdAt: iso(nowMs - (420 - i * 37) * DAY),
      walletImpact: { currency: "EUR", totalCost: cost, currentValue: value, unrealizedProfitLoss: r2(value - cost), fxImpact: fxImpact }
    }
  })
}

// ---- Account history: monthly buys of every holding, two sells, a closed
//      position, dividends, and the cash flows of a spending account.
function orders(nowMs) {
  const items = []
  let id = 48000000
  const fill = (h, side, qty, price, ms, realized, source) => {
    const net = r2(eur(qty * price, h.cur))
    items.push({
      order: { id: ++id, instrument: { ticker: h.raw, name: h.name, isin: h.isin || "", currency: h.cur }, side, status: "FILLED", type: "MARKET",
        initiatedFrom: source || "APP", createdAt: iso(ms - 60000), filledQuantity: qty },
      fill: { id: id + 7, quantity: side === "SELL" ? -qty : qty, price, filledAt: iso(ms), type: "TRADE",
        walletImpact: { netValue: net, currency: "EUR", fxRate: h.cur === "USD" ? r2(1 / USD * 10000) / 10000 : 1,
          realisedProfitLoss: realized === undefined ? 0 : realized,
          taxes: h.cur === "USD" ? [{ name: "CURRENCY_CONVERSION_FEE", quantity: -r2(net * 0.0015), currency: "EUR" }] : [] } }
    })
  }
  for (let m = 13; m >= 0; m--) {
    HOLDINGS.forEach((h, i) => {
      if ((m + i) % 3 !== 0) return
      const ms = at(nowMs, m * 30 + i + 2, 15 + (i % 5), 31 + i * 3)
      const price = h.avg * (0.82 + (13 - m) * 0.03)
      fill(h, "BUY", r2(h.qty / 5), r2(price), ms, 0, i % 2 ? "AUTOINVEST" : "APP")
    })
  }
  const tsla = { raw: "TSLA_US_EQ", name: "Tesla", isin: "US88160R1014", cur: "USD" }
  fill(tsla, "BUY", 4, 182.4, at(nowMs, 300, 16, 12), 0)
  fill(tsla, "SELL", 4, 268.9, at(nowMs, 64, 17, 48), 312.4)
  fill(HOLDINGS[0], "SELL", 3, 176.5, at(nowMs, 9, 15, 52), 184.1)
  fill(HOLDINGS[5], "BUY", 2, 68.3, at(nowMs, 1, 16, 5), 0, "AUTOINVEST")
  items.sort((a, b) => Date.parse(b.fill.filledAt) - Date.parse(a.fill.filledAt))
  return items
}

const REALIZED = r2(312.4 + 184.1 + 38.75)

function dividends(nowMs) {
  const items = []
  const pay = (h, ms, perShare, qty) => items.push({
    reference: "div-" + h.raw + "-" + ms, ticker: h.raw, instrument: { ticker: h.raw, name: h.name, currency: h.cur },
    amount: r2(eur(perShare * qty * 0.85, h.cur)), grossAmountPerShare: perShare, quantity: qty, type: "ORDINARY", paidOn: iso(ms)
  })
  for (let m = 0; m < 12; m++) {
    pay(HOLDINGS[6], nowMs - (m * 30 + 16) * DAY, 0.2685, 32)
    if (m % 3 === 0) {
      pay(HOLDINGS[5], nowMs - (m * 30 + 34) * DAY, 0.51, 20)
      pay(HOLDINGS[1], nowMs - (m * 30 + 47) * DAY, 0.83, 6.2)
      pay(HOLDINGS[2], nowMs - (m * 30 + 55) * DAY, 0.26, 11.8)
    }
  }
  items.sort((a, b) => Date.parse(b.paidOn) - Date.parse(a.paidOn))
  return items
}

function transactions(nowMs) {
  const rand = rng(7)
  const items = []
  let n = 0
  const add = (type, amount, ms) => items.push({ reference: "tx-" + (++n), type, amount: r2(amount), currency: "EUR", dateTime: iso(ms) })
  const start = new Date(nowMs)
  for (let d = 0; d < 400; d++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() - d, 12).getTime()
    if (day > nowMs) continue
    const date = new Date(day)
    if (date.getDate() === 1) add("DEPOSIT", 1250, day - 3 * 3600000)
    if (date.getDate() === 2) add("INTEREST_ON_FREE_CASH", 1.2 + rand() * 2.4, day - 2 * 3600000)
    if (date.getDate() === 15 && date.getMonth() % 2 === 0) add("WITHDRAW", -300, day + 3600000)
    const weekend = date.getDay() === 0 || date.getDay() === 6
    const payments = Math.floor(rand() * (weekend ? 4 : 3))
    for (let p = 0; p < payments; p++) {
      const big = rand() < 0.06
      const amount = big ? 60 + rand() * 140 : 2.5 + rand() * 32
      const ms = day - 4 * 3600000 + Math.floor(rand() * 10 * 3600000)
      if (ms > nowMs) continue
      add("WITHDRAW", -(Math.floor(amount * 100) + 37) / 100, ms)
      if (rand() < 0.5) add("DEPOSIT", amount * 0.01, ms + 60000)
    }
  }
  items.sort((a, b) => Date.parse(b.dateTime) - Date.parse(a.dateTime))
  return items
}

// ---- Market data.
function chart(h, nowMs) {
  const rand = rng(h.raw.length * 31 + h.price)
  const points = []
  let p = h.price
  for (let d = 1; points.length < 252; d++) {
    const ms = new Date(new Date(nowMs).setHours(0, 0, 0, 0) - d * DAY).getTime()
    const wd = new Date(ms).getDay()
    if (wd === 0 || wd === 6) continue
    points.push({ x: ms, y: p.toFixed(2) })
    p = p / (1 + (rand() - 0.43) * 0.03)
  }
  return { data: { previousClose: usd(h.price / (1 + h.chg / 100)), chart: points.reverse() } }
}

function quote(h) {
  const prev = h.price / (1 + h.chg / 100)
  return { data: { symbol: Format.displayTicker(h.raw), companyName: h.name, exchange: "NASDAQ-GS", marketStatus: "Open",
    primaryData: { lastSalePrice: usd(h.price), netChange: (h.chg >= 0 ? "+" : "-") + Math.abs(h.price - prev).toFixed(2), percentageChange: (h.chg >= 0 ? "+" : "") + h.chg.toFixed(2) + "%" },
    secondaryData: null, keyStats: { fiftyTwoWeekHighLow: { value: h.low.toFixed(2) + " - " + h.high.toFixed(2) } } } }
}

function profile(h, nowMs) {
  const v = (value) => ({ value })
  const s = { Exchange: v("NASDAQ-GS"), Sector: v(h.sector), Industry: v(h.industry), MarketCap: v(Format.groupThousands(Math.round(h.cap))),
    PERatio: v(h.pe), OneYrTarget: v(usd(h.target)), PreviousClose: v(usd(h.price / (1 + h.chg / 100))),
    FiftTwoWeekHighLow: v(usd(h.high) + "/" + usd(h.low)) }
  if (h.div) {
    s.AnnualizedDividend = v(usd(h.div))
    s.Yield = v(h.yld.toFixed(2) + "%")
  }
  if (h.exdiv) s.ExDividendDate = v(pretty(nowMs + h.exdiv * DAY))
  if (h.pay) s.DividendPaymentDate = v(pretty(nowMs + h.pay * DAY))
  return { data: { summaryData: s } }
}

function earnings(h, nowMs) {
  return { data: { reportText: `${h.name} is estimated to report earnings on ${mdy(nowMs + h.earn * DAY)}. According to Zacks Investment Research, based on 9 analysts' forecasts, the consensus EPS forecast for the quarter is $${(h.price / h.pe / 4).toFixed(2)}.` } }
}

const HEADLINES = [
  ["{n} shares climb as analysts lift price targets", "Market Wire"],
  ["What {n}'s latest results mean for long-term investors", "Daily Ledger"],
  ["{n} expands buyback programme", "Finance Today"],
  ["Is {n} still a buy after this year's run?", "Street Notes"]
]

function news(h, nowMs) {
  const items = HEADLINES.map(([title, source], i) =>
    `<item><title>${title.replace("{n}", h.name)} - ${source}</title><link>https://example.com/${encodeURIComponent(h.raw)}/${i}</link>`
    + `<pubDate>${new Date(nowMs - (i * 9 + 2) * 3600000).toUTCString()}</pubDate><source url="https://example.com">${source}</source></item>`)
  return `<rss><channel>${items.join("")}</channel></rss>`
}

// ---- Snapshots: one line per past day, ending yesterday; the plugin
//      writes today's line itself from the live summary.
function history(nowMs, summary) {
  const rand = rng(42)
  const lines = []
  const days = 180
  let value = summary.investments.currentValue * 0.985
  let invested = summary.investments.totalCost
  let pot = POT
  const today = new Date(nowMs)
  for (let d = 1; d <= days; d++) {
    const ms = new Date(today.getFullYear(), today.getMonth(), today.getDate() - d, 21).getTime()
    const date = Format.localDate(ms)
    // Realized P/L as of that evening: the base, plus each sell (64 and
    // 9 days ago, see orders()) once it has happened.
    const realized = 38.75 + (d <= 63 ? 312.4 : 0) + (d <= 8 ? 184.1 : 0)
    lines.push({ date, ts: Math.round(ms / 1000), currency: "EUR", open: r2(value * 0.997), invested: r2(invested), value: r2(value),
      pl: r2(value - invested), realized: r2(realized), cash: r2(FREE + IN_PIES), pot: r2(pot), total: r2(value + FREE + IN_PIES + pot),
      openReturn: r2(value * 0.997 - invested + realized), openTotal: r2(value * 0.997 + FREE + IN_PIES + pot) })
    // Walk backwards: undo a day's move, and the monthly deposit.
    value = value / (1 + (rand() - 0.46) * 0.022)
    if (new Date(ms).getDate() === 1) {
      value -= 900
      invested -= 900
    }
    pot = Math.max(120, pot + (rand() - 0.62) * 70 + (new Date(ms).getDate() === 1 ? -350 : 0))
  }
  return lines.reverse().map((l) => JSON.stringify(l)).join("\n") + "\n"
}

function generate(fixtureDir, stateDir, nowMs) {
  nowMs = nowMs || Date.now()
  fs.mkdirSync(fixtureDir, { recursive: true })
  const write = (url, body) => fs.writeFileSync(path.join(fixtureDir, Shell.fixtureKey(url)), typeof body === "string" ? body : JSON.stringify(body))

  const pos = positions(nowMs)
  const sum = (key) => r2(pos.reduce((a, p) => a + p.walletImpact[key], 0))
  const value = sum("currentValue")
  const cost = sum("totalCost")
  const summary = {
    id: 20260001, currency: "EUR",
    cash: { availableToTrade: FREE, inPies: IN_PIES, reservedForOrders: 0 },
    investments: { currentValue: value, totalCost: cost, unrealizedProfitLoss: r2(value - cost), realizedProfitLoss: REALIZED },
    totalValue: r2(value + FREE + IN_PIES + POT)
  }
  write(HOST + "/equity/account/summary", summary)
  write(HOST + "/equity/positions", pos)
  write(HOST + "/equity/orders", [{
    id: 49000001, instrument: { ticker: "AMZN_US_EQ", name: "Amazon.com", currency: "USD" }, side: "BUY", type: "LIMIT", status: "NEW",
    quantity: 2, limitPrice: 205, value: r2(410 / USD), createdAt: iso(nowMs - 2 * DAY)
  }])
  write(HOST + "/equity/history/orders", { items: orders(nowMs), nextPagePath: null })
  write(HOST + "/equity/history/dividends", { items: dividends(nowMs), nextPagePath: null })
  write(HOST + "/equity/history/transactions", { items: transactions(nowMs), nextPagePath: null })

  const pies = [
    { id: 101, name: "Dividend core", goal: 5000, slices: [["KO_US_EQ", 0.42, 0.4], ["O_US_EQ", 0.46, 0.4], ["MSFT_US_EQ", 0.12, 0.2]], invested: 1310.4, value: 1374.85 },
    { id: 102, name: "Tech growth", goal: null, slices: [["NVDA_US_EQ", 0.48, 0.4], ["AAPL_US_EQ", 0.27, 0.3], ["GOOGL_US_EQ", 0.25, 0.3]], invested: 1840, value: 2391.62 }
  ]
  write(HOST + "/equity/pies", pies.map((p) => ({
    id: p.id, cash: p.id === 101 ? IN_PIES : 0, progress: p.goal ? p.value / p.goal : null, status: null,
    result: { priceAvgInvestedValue: p.invested, priceAvgValue: p.value, priceAvgResult: r2(p.value - p.invested), priceAvgResultCoef: (p.value - p.invested) / p.invested },
    dividendDetails: { gained: p.id === 101 ? 48.3 : 3.1, reinvested: p.id === 101 ? 44.2 : 3.1, inCash: p.id === 101 ? 4.1 : 0 }
  })))
  for (const p of pies) write(HOST + "/equity/pies/" + p.id, {
    settings: { id: p.id, name: p.name, icon: "Coins", goal: p.goal, endDate: null, creationDate: iso(nowMs - 380 * DAY) },
    instruments: p.slices.map(([t, current, expected]) => ({ ticker: t, currentShare: current, expectedShare: expected, ownedQuantity: 3, result: { priceAvgValue: r2(p.value * current), priceAvgResult: r2((p.value - p.invested) * current) } }))
  })

  for (const h of HOLDINGS) {
    const position = { rawTicker: h.raw, name: h.name, instrumentCurrency: h.cur }
    write(Market.newsUrl(position), news(h, nowMs))
    const sym = Market.nasdaqSymbol(position)
    if (!sym) continue
    const nasdaq = (p) => "https://api.nasdaq.com/api" + p
    write(nasdaq("/quote/" + sym + "/info"), quote(h))
    write(nasdaq("/quote/" + sym + "/summary"), profile(h, nowMs))
    write(nasdaq("/quote/" + sym + "/chart"), chart(h, nowMs))
    write(nasdaq("/analyst/" + sym + "/earnings-date"), earnings(h, nowMs))
  }
  write("https://api.frankfurter.dev/v1/latest", { base: "EUR", date: Format.localDate(nowMs - DAY), rates: FX })
  write("https://production.dataviz.cnn.io/index/fearandgreed/graphdata", {
    fear_and_greed: { score: 62.4, rating: "greed", previous_close: 58.1, previous_1_week: 51.3, previous_1_month: 44.8 }
  })

  if (stateDir) {
    const dir = path.join(stateDir, "omarchy-trading212")
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, "history-live.jsonl"), history(nowMs, summary))
  }
  return summary
}

module.exports = { generate, HOLDINGS }

if (require.main === module) {
  if (process.argv.length < 3) {
    console.error("usage: node tests/fixtures/demo.js <fixture-dir> [state-dir]")
    process.exit(2)
  }
  generate(process.argv[2], process.argv[3])
}
