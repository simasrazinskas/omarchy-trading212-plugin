.pragma library

// Every command the plugin runs, built in one place. Values always travel as
// positional arguments ("$1", "$2", …) — never spliced into the script — and
// secrets only ever over stdin. Pure string building, so the node suite runs
// the scripts for real against temporary files.

// Response framing shared by every fetch: the body, then a trailing
// "__T212_HTTP__ <code>" line; "__T212_STATUS__ <state>" marks a request that
// never reached the server (missing key, curl failure). lib/T212.js parses it.
var CURL_TAIL = "-w '\\n__T212_HTTP__ %{http_code}'"

function bash(script, args) {
  return ["bash", "-c", script, "t212"].concat(args || [])
}

// Authenticated Trading 212 GET. The keyring lookup is bounded: a locked
// keyring can make secret-tool block on an unlock prompt, and a fetch that
// never exits would wedge the request queue. The Authorization header goes
// to curl over stdin (`--config -`), so the secret never shows up in argv.
function apiFetch(environment, url) {
  return bash("cred=$(timeout 5 secret-tool lookup service trading212 account \"$1\" 2>/dev/null)\n"
    + "if [ -z \"$cred\" ]; then echo \"__T212_STATUS__ no_key\"; exit 0; fi\n"
    + "case \"$cred\" in\n"
    + "  *:*) auth=\"Basic $(printf %s \"$cred\" | base64 | tr -d '\\n')\" ;;\n"
    + "  *) auth=\"$cred\" ;;\n"
    + "esac\n"
    + "printf 'header = \"Authorization: %s\"\\n' \"$auth\" | curl -sS --compressed --max-time 15 --config - " + CURL_TAIL + " \"$2\" 2>/dev/null"
    + " || echo \"__T212_STATUS__ curl_error\"\n", [environment, url])
}

// Public GET with browser-like headers. `referer` doubles as the Origin
// (Nasdaq and CNN both refuse requests without them); "" sends neither.
function publicFetch(url, accept, referer, userAgent) {
  return bash("if [ -n \"$3\" ]; then\n"
    + "  set -- \"$1\" \"$2\" \"$3\" \"$4\" -H \"Referer: $3\" -H \"Origin: ${3%/}\"\n"
    + "else\n"
    + "  set -- \"$1\" \"$2\" \"$3\" \"$4\"\n"
    + "fi\n"
    + "url=$1 accept=$2 agent=$4\n"
    + "shift 4\n"
    + "curl -sS --compressed --max-time 12 -A \"$agent\" -H \"Accept: $accept\" \"$@\" " + CURL_TAIL + " \"$url\" 2>/dev/null"
    + " || echo \"__T212_STATUS__ curl_error\"\n", [url, accept, referer, userAgent])
}

// ---- Fixture transport (T212_FIXTURES=<dir>): every fetch is answered from
//      a file named after its URL instead of the network, and the keyring is
//      never touched. Backs the QML smoke test and the README screenshots.

// "https://api.nasdaq.com/api/quote/NVDA/info?assetclass=stocks" →
// "api.nasdaq.com_api_quote_NVDA_info_assetclass_stocks".
function fixtureKey(url) {
  return String(url).replace(/^[a-z]+:\/\//i, "").replace(/[^A-Za-z0-9._-]/g, "_")
}

// The exact URL's file wins; otherwise the same URL without its query
// string, so date-stamped and paginated URLs need just one file.
function fixtureFetch(dir, url) {
  var bare = String(url).split("?")[0]
  return bash("f=\"$1/$2\"\n"
    + "[ -f \"$f\" ] || f=\"$1/$3\"\n"
    + "if [ -f \"$f\" ]; then cat \"$f\"; printf '\\n__T212_HTTP__ 200'; else printf '__T212_HTTP__ 404'; fi\n",
    [dir, fixtureKey(url), fixtureKey(bare)])
}

// Reads one line (the credential) from stdin and stores it in the keyring;
// re-piped with printf so no trailing newline ends up inside the secret.
function storeCredential(environment) {
  return bash("IFS= read -r cred\n"
    + "[ -n \"$cred\" ] || exit 1\n"
    + "printf %s \"$cred\" | timeout 15 secret-tool store --label=\"Trading 212 API ($1)\" service trading212 account \"$1\"\n",
    [environment])
}

// Atomic file write: one line from stdin into a temp file, then a rename,
// so a crash mid-write never leaves half a file behind.
function writeFile(path) {
  return bash("IFS= read -r payload\n"
    + "mkdir -p \"${1%/*}\" && printf '%s\\n' \"$payload\" > \"$1.tmp\" && mv \"$1.tmp\" \"$1\"\n",
    [path])
}

// Upserts today's line in the snapshot JSONL: a last line for `date` is
// replaced, anything else appended. Through a temp file + rename like
// writeFile, so the watcher never reads a half-written history.
function upsertSnapshot(path, date, line) {
  return bash("f=$1\n"
    + "mkdir -p \"${f%/*}\"\n"
    + "{\n"
    + "  if [ -f \"$f\" ]; then\n"
    + "    if tail -n 1 \"$f\" | grep -qF \"\\\"date\\\":\\\"$2\\\"\"; then sed '$ d' \"$f\"; else cat \"$f\"; fi\n"
    + "  fi\n"
    + "  printf '%s\\n' \"$3\"\n"
    + "} > \"$f.tmp\" && mv \"$f.tmp\" \"$f\"\n",
    [path, date, line])
}

function notify(title, body, urgency, glyph, ipcTarget) {
  return bash("if command -v omarchy-notification-send >/dev/null 2>&1; then\n"
    + "  exec omarchy-notification-send --app-name \"Trading 212\" -g \"$4\" -u \"$3\" \"$1\" \"$2\" --exec omarchy-shell \"$5\" open\n"
    + "fi\n"
    + "exec notify-send -a \"Trading 212\" -u \"$3\" -- \"$1\" \"$2\"\n",
    [title, body, urgency, glyph, ipcTarget])
}
