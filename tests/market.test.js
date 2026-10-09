const test = require("node:test")
const assert = require("node:assert/strict")
const Market = require("./harness").load("Market.js")

const now = new Date(2026, 8, 29, 12).getTime()

test("symbol mapping for Nasdaq and Yahoo", () => {
  assert.equal(Market.nasdaqSymbol({ rawTicker: "NVDA_US_EQ" }), "NVDA")
  assert.equal(Market.nasdaqSymbol({ rawTicker: "SPCX", instrumentCurrency: "USD" }), "SPCX")
  assert.equal(Market.nasdaqSymbol({ rawTicker: "VUSAl_EQ", instrumentCurrency: "GBX" }), "")
  assert.equal(Market.yahooSymbol("VUSAl_EQ"), "VUSA.L")
  assert.equal(Market.yahooSymbol("SAPd_EQ"), "SAP.DE")
  assert.equal(Market.yahooSymbol("SHOP_CA_EQ"), "SHOP.TO")
  assert.equal(Market.yahooSymbol("BRK.B_US_EQ"), "BRK-B")
})

test("parseDate reads Nasdaq's date formats", () => {
  assert.equal(Market.parseDate("Sep 21, 2026"), new Date(2026, 8, 21).getTime())
  assert.equal(Market.parseDate("11/18/2026"), new Date(2026, 10, 18).getTime())
  assert.equal(Market.parseDate("2026-10-01"), new Date(2026, 9, 1).getTime())
  assert.equal(Market.parseDate("N/A"), 0)
})

const info = {
  data: {
    symbol: "NVDA", companyName: "NVIDIA Corporation Common Stock", exchange: "NASDAQ-GS", marketStatus: "Pre-Market",
    primaryData: { lastSalePrice: "$230.4282", netChange: "+1.5682", percentageChange: "+0.69%" },
    secondaryData: { lastSalePrice: "$228.86", netChange: "+3.79", percentageChange: "+1.68%" },
    keyStats: { fiftyTwoWeekHighLow: { value: "164.27 - 236.54" } }
  }
}

test("parseQuote uses the regular session as the day's move outside hours", () => {
  const q = Market.parseQuote(JSON.stringify(info), now)
  assert.equal(q.price, 228.86)
  assert.equal(q.changePct, 1.68)
  assert.equal(q.extPrice, 230.4282)
  assert.equal(q.extChangePct, 0.69)
  assert.equal(q.low52, 164.27)
  assert.equal(q.high52, 236.54)
  const open = JSON.parse(JSON.stringify(info))
  open.data.marketStatus = "Open"
  const qo = Market.parseQuote(JSON.stringify(open), now)
  assert.equal(qo.changePct, 0.69)
  assert.equal(qo.extPrice, null)
  assert.equal(Market.parseQuote('{"data":null}', now), null)
  assert.equal(Market.parseQuote("<html>", now), null)
})

test("parseProfile reads sector, fundamentals and dividend dates", () => {
  const raw = JSON.stringify({ data: { summaryData: {
    Exchange: { value: "NASDAQ-GS" }, Sector: { value: "Technology" }, Industry: { value: "Semiconductors" },
    OneYrTarget: { value: "$525.00" }, MarketCap: { value: "1,685,456,525,030" }, AnnualizedDividend: { value: "$2.60" },
    ExDividendDate: { value: "Sep 21, 2026" }, DividendPaymentDate: { value: "Sep 30, 2026" }, Yield: { value: "0.74%" },
    FiftTwoWeekHighLow: { value: "$495/$289.96" }, PERatio: { value: "N/A" }
  } } })
  const p = Market.parseProfile(raw, now)
  assert.equal(p.sector, "Technology")
  assert.equal(p.target, 525)
  assert.equal(p.marketCap, 1685456525030)
  assert.equal(p.annualDividend, 2.6)
  assert.equal(p.yieldPct, 0.74)
  assert.equal(p.pe, null)
  assert.equal(p.exDividend, new Date(2026, 8, 21).getTime())
  assert.equal(p.low52, 289.96)
  assert.equal(p.high52, 495)
})

test("parseEarnings extracts the date and consensus EPS", () => {
  const e = Market.parseEarnings(JSON.stringify({ data: { reportText: "NVIDIA is estimated to report earnings on  11/18/2026. Blah. According to Zacks, based on  13 analysts' forecasts, the consensus EPS forecast for the quarter is $2.47. The reported" } }), now)
  assert.equal(e.time, new Date(2026, 10, 18).getTime())
  assert.equal(e.estimated, true)
  assert.equal(e.epsForecast, 2.47)
})

test("parseChart and chartSeries", () => {
  const c = Market.parseChart(JSON.stringify({ data: { previousClose: "$225.07", chart: [{ x: 2000, y: 110 }, { x: 1000, y: 100 }, { x: 3000, y: "bad" }] } }), now)
  assert.deepEqual(c.points, [{ ts: 1000, value: 100 }, { ts: 2000, value: 110 }])
  assert.equal(c.previousClose, 225.07)
  const s = Market.chartSeries(c, 120, 5000)
  assert.equal(s.points.length, 3)
  assert.equal(s.changePct, 20)
  assert.equal(Market.chartSeries(null, 1, 1).points.length, 0)
  assert.equal(Market.rangePosition(150, 100, 200), 0.5)
  assert.equal(Market.rangePosition(250, 100, 200), 1)
  assert.equal(Market.rangePosition(1, null, 2), null)
})

test("FX conversion into the base currency", () => {
  const fx = Market.parseFx(JSON.stringify({ base: "EUR", date: "2026-09-28", rates: { USD: 1.25, GBP: 0.8 } }), now)
  assert.equal(Market.toBase(125, "USD", fx), 100)
  assert.equal(Market.toBase(8000, "GBX", fx), 100)
  assert.equal(Market.toBase(5, "EUR", fx), 5)
  assert.equal(Market.toBase(5, "JPY", fx), null)
})

test("parseFearGreed and moodLabel", () => {
  const fg = Market.parseFearGreed(JSON.stringify({ fear_and_greed: { score: 33.8, rating: "extreme fear", previous_close: 35 } }), now)
  assert.equal(fg.score, 33.8)
  assert.equal(Market.moodLabel(fg.rating), "Extreme Fear")
  assert.equal(Market.parseFearGreed("{}", now), null)
})

test("parseNews reads Google News RSS and strips the publisher suffix", () => {
  const xml = "<rss><channel><item><title>Nvidia &amp; AMD rally - Reuters</title><link>https://news.google.com/a</link>"
    + "<pubDate>Mon, 28 Sep 2026 13:00:00 GMT</pubDate><source url=\"https://reuters.com\">Reuters</source></item>"
    + "<item><title><![CDATA[Chips slide]]></title><link>https://x/b</link><pubDate>bad</pubDate></item></channel></rss>"
  const items = Market.parseNews(xml, 5)
  assert.equal(items.length, 2)
  assert.equal(items[0].title, "Nvidia & AMD rally")
  assert.equal(items[0].source, "Reuters")
  assert.equal(items[0].time, Date.parse("Mon, 28 Sep 2026 13:00:00 GMT"))
  assert.equal(items[1].title, "Chips slide")
  assert.equal(items[1].time, 0)
  assert.ok(Market.newsUrl({ rawTicker: "GOOGL_US_EQ", name: "Alphabet (Class A)" }).includes(encodeURIComponent("\"Alphabet\" OR GOOGL stock")))
})

test("upcomingEvents, projectedIncome and market status", () => {
  const positions = [{ rawTicker: "NVDA_US_EQ", ticker: "NVDA", name: "Nvidia", quantity: 10, instrumentCurrency: "USD" }]
  const profiles = { NVDA: { exDividend: new Date(2026, 9, 3).getTime(), dividendPayment: 0, annualDividend: 0.04 } }
  const earnings = { NVDA: { time: new Date(2026, 10, 18).getTime(), estimated: true } }
  const events = Market.upcomingEvents(positions, profiles, earnings, now, 60)
  assert.deepEqual(events.map((e) => e.kind), ["exdiv", "earnings"])
  assert.equal(Market.upcomingEvents(positions, profiles, earnings, now, 7).length, 1)
  const fx = { base: "EUR", rates: { USD: 1.25 } }
  const income = Market.projectedIncome(positions, profiles, fx)
  assert.ok(Math.abs(income.total - 0.32) < 1e-9)
  assert.equal(income.payers, 1)
  assert.equal(Market.usMarketStatus({ A: { marketStatus: "Closed", fetchedAt: 1 }, B: { marketStatus: "Open", fetchedAt: 2 } }), "Open")
  assert.equal(Market.isStale(null, 1000, now), true)
  assert.equal(Market.isStale({ fetchedAt: now - 10 }, 1000, now), false)
})
