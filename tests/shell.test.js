// Runs the generated bash for real against temporary files.
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { execFileSync } = require("child_process")
const Shell = require("./harness").load("Shell.js")
const T212 = require("./harness").load("T212.js")

function run(command, input) {
  return execFileSync(command[0], command.slice(1), { input: input || "", encoding: "utf8" })
}

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "t212-shell-"))
}

test("fixtureKey flattens a URL into a file name", () => {
  assert.equal(Shell.fixtureKey("https://api.nasdaq.com/api/quote/NVDA/info?assetclass=stocks"), "api.nasdaq.com_api_quote_NVDA_info_assetclass_stocks")
  assert.equal(Shell.fixtureKey("https://live.trading212.com/api/v0/equity/pies/12"), "live.trading212.com_api_v0_equity_pies_12")
})

test("fixtureFetch frames the exact file, then the query-less one, else 404", () => {
  const dir = tmpdir()
  fs.writeFileSync(path.join(dir, Shell.fixtureKey("https://h/a?x=1")), '{"exact":true}')
  fs.writeFileSync(path.join(dir, Shell.fixtureKey("https://h/a")), '{"bare":true}')
  const exact = T212.classify(run(Shell.fixtureFetch(dir, "https://h/a?x=1")))
  assert.equal(exact.kind, "ok")
  assert.equal(exact.body, '{"exact":true}')
  assert.equal(T212.classify(run(Shell.fixtureFetch(dir, "https://h/a?x=2"))).body, '{"bare":true}')
  assert.equal(T212.classify(run(Shell.fixtureFetch(dir, "https://h/missing"))).http, 404)
})

test("writeFile writes one stdin line atomically, creating the directory", () => {
  const file = path.join(tmpdir(), "nested", "cache.json")
  run(Shell.writeFile(file), '{"a":"$(touch /tmp/never) \\"q\\""}\n')
  assert.equal(fs.readFileSync(file, "utf8"), '{"a":"$(touch /tmp/never) \\"q\\""}\n')
  assert.equal(fs.existsSync(file + ".tmp"), false)
})

test("upsertSnapshot replaces today's last line and appends a new day", () => {
  const file = path.join(tmpdir(), "history.jsonl")
  run(Shell.upsertSnapshot(file, "2026-09-19", '{"date":"2026-09-19","value":1}'))
  run(Shell.upsertSnapshot(file, "2026-09-20", '{"date":"2026-09-20","value":2}'))
  run(Shell.upsertSnapshot(file, "2026-09-20", '{"date":"2026-09-20","value":3}'))
  assert.deepEqual(fs.readFileSync(file, "utf8").trim().split("\n"), ['{"date":"2026-09-19","value":1}', '{"date":"2026-09-20","value":3}'])
})

test("arguments stay data: metacharacters are never evaluated", () => {
  const dir = tmpdir()
  const marker = path.join(dir, "pwned")
  const file = path.join(dir, "h.jsonl")
  run(Shell.upsertSnapshot(file, "x", "$(touch " + marker + ")"))
  assert.equal(fs.existsSync(marker), false)
  assert.equal(fs.readFileSync(file, "utf8"), "$(touch " + marker + ")\n")
})

test("publicFetch sends Referer and Origin only when given, URL last", () => {
  const bin = tmpdir()
  fs.writeFileSync(path.join(bin, "curl"), "#!/bin/sh\nfor a in \"$@\"; do printf '%s\\n' \"$a\"; done\n", { mode: 0o755 })
  const env = Object.assign({}, process.env, { PATH: bin + ":" + process.env.PATH })
  const runWith = (command) => execFileSync(command[0], command.slice(1), { encoding: "utf8", env }).trim().split("\n")
  const withRef = runWith(Shell.publicFetch("https://api.nasdaq.com/x?y=1", "application/json", "https://www.nasdaq.com/", "UA 1.0"))
  assert.ok(withRef.includes("Referer: https://www.nasdaq.com/"))
  assert.ok(withRef.includes("Origin: https://www.nasdaq.com"))
  assert.ok(withRef.includes("Accept: application/json"))
  assert.ok(withRef.includes("UA 1.0"))
  assert.equal(withRef[withRef.length - 1], "https://api.nasdaq.com/x?y=1")
  const bare = runWith(Shell.publicFetch("https://x/rss", "text/xml", "", "UA"))
  assert.ok(!bare.some((a) => a.startsWith("Referer") || a.startsWith("Origin")))
  assert.equal(bare[bare.length - 1], "https://x/rss")
})
