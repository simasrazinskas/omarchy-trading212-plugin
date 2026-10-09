const test = require("node:test")
const assert = require("node:assert/strict")
const Format = require("./harness").load("Format.js")

test("formatBar keeps cents under 100, whole under 10k, compacts above", () => {
  assert.equal(Format.formatBar(99.89, "€"), "€99.89")
  assert.equal(Format.formatBar(9850.12, "€"), "€9,850")
  assert.equal(Format.formatBar(12450.32, "€"), "€12.5k")
  assert.equal(Format.formatBar(1234567, "€"), "€1.23M")
  assert.equal(Format.formatBar(1000000, "€"), "€1M")
  assert.equal(Format.formatBar(1200000, "€"), "€1.2M")
  assert.equal(Format.formatBar(9999.6, "€"), "€10k")
  assert.equal(Format.formatBar(-322.4, "€"), "-€322")
})

test("formatQuantity trims fractional shares, keeps whole counts plain", () => {
  assert.equal(Format.formatQuantity(0.79232076), "0.7923")
  assert.equal(Format.formatQuantity(2), "2")
  assert.equal(Format.formatQuantity(10.5), "10.5")
})

test("formatBarSigned always carries an explicit sign", () => {
  assert.equal(Format.formatBarSigned(0.04, "€"), "+€0.04")
  assert.equal(Format.formatBarSigned(-12.4, "€"), "-€12.40")
  assert.equal(Format.formatBarSigned(322.1, "€"), "+€322")
})

test("formatFull and formatSigned group thousands with two decimals", () => {
  assert.equal(Format.formatFull(12450.325, "€"), "€12,450.33")
  assert.equal(Format.formatFull(-1234.5, "$"), "-$1,234.50")
  assert.equal(Format.formatSigned(322.1, "€"), "+€322.10")
  assert.equal(Format.formatSigned(-12.4, "€"), "-€12.40")
})

test("formatPercent signs values and adds precision near zero", () => {
  assert.equal(Format.formatPercent(2.59), "+2.6%")
  assert.equal(Format.formatPercent(-0.043), "-0.04%")
  assert.equal(Format.formatPercent(null), "")
})

test("formatWeight and formatCompact", () => {
  assert.equal(Format.formatWeight(16.3), "16%")
  assert.equal(Format.formatWeight(5.55), "5.5%")
  assert.equal(Format.formatWeight(0.04), "<0.1%")
  assert.equal(Format.formatCompact(1685456525030), "1.69T")
  assert.equal(Format.formatCompact(812000000000), "812B")
  assert.equal(Format.formatCompact(45200000), "45.2M")
  assert.equal(Format.formatCompact(null), "")
})

test("currencySymbol maps known codes and falls back to the code", () => {
  assert.equal(Format.currencySymbol("EUR"), "€")
  assert.equal(Format.currencySymbol("gbp"), "£")
  assert.equal(Format.currencySymbol("XYZ"), "XYZ ")
})

test("parseLooseNumber reads scraped display strings", () => {
  assert.equal(Format.parseLooseNumber("$1,234.50"), 1234.5)
  assert.equal(Format.parseLooseNumber("+0.69%"), 0.69)
  assert.equal(Format.parseLooseNumber("-1.5682"), -1.5682)
  assert.equal(Format.parseLooseNumber("N/A"), null)
  assert.equal(Format.parseLooseNumber(""), null)
  assert.equal(Format.parseLooseNumber(null), null)
  assert.equal(Format.parseLooseNumber(4), 4)
})

test("displayTicker strips T212 suffixes including the exchange letter", () => {
  assert.equal(Format.displayTicker("AAPL_US_EQ"), "AAPL")
  assert.equal(Format.displayTicker("VUSAl_EQ"), "VUSA")
  assert.equal(Format.displayTicker("SPCX"), "SPCX")
  assert.equal(Format.displayTicker(""), "")
})

test("date helpers bucket by local calendar day", () => {
  const now = new Date(2026, 8, 29, 14, 5).getTime()
  assert.equal(Format.localDate(now), "2026-09-29")
  assert.equal(Format.localMonth(now), "2026-09")
  assert.equal(Format.monthLabel("2026-09", true), "Sep 2026")
  assert.equal(Format.stamp(now - 3600000, now), "13:05")
  assert.equal(Format.stamp(new Date(2026, 8, 20, 9, 0).getTime(), now), "20 Sep 09:00")
  assert.equal(Format.relativeDay(new Date(2026, 8, 30, 1).getTime(), now), "tomorrow")
  assert.equal(Format.relativeDay(new Date(2026, 9, 10).getTime(), now), "in 11d")
  assert.equal(Format.relativeDay(new Date(2026, 8, 26).getTime(), now), "3d ago")
  assert.equal(Format.age(now - 5 * 60000, now), "5m")
  assert.equal(Format.age(now - 3 * 3600000, now), "3h")
})
