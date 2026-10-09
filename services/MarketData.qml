import QtQuick
import "../lib/T212.js" as T212
import "../lib/Market.js" as Market

// Public market data for the held symbols: quotes (today's move, session
// state, 52-week range), company profile (sector, fundamentals, dividend
// dates), next earnings date and a year of daily closes from Nasdaq; FX
// from the ECB via Frankfurter; the CNN Fear & Greed index; Google News
// headlines on demand. No API keys.
//
// Everything is cached to disk and refreshed on its own cadence — quotes
// every couple of minutes while the panel is open, profiles daily — and
// every source degrades silently: missing enrichment just hides a line.
Item {
  id: root

  property bool enabled: true
  property bool active: false
  property var positions: []
  property string path: ""

  property var quotes: ({})
  property var profiles: ({})
  property var earnings: ({})
  property var charts: ({})
  property var assetClasses: ({})
  property var fx: null
  property var mood: null
  property var news: ({})
  property var newsLoading: ({})

  // Consecutive Nasdaq failures; past a handful the source pauses for a
  // while instead of hammering an endpoint that is refusing us.
  property int _failures: 0
  property double blockedUntil: 0
  property bool _loaded: false

  readonly property var symbols: {
    var seen = {}
    var out = []
    for (var i = 0; i < positions.length; i++) {
      var sym = Market.nasdaqSymbol(positions[i])
      if (sym !== "" && !seen[sym]) {
        seen[sym] = true
        out.push(sym)
      }
    }
    return out
  }
  readonly property string usMarketStatus: Market.usMarketStatus(quotes)
  readonly property bool paused: blockedUntil > Date.now()

  readonly property string userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"

  onSymbolsChanged: if (_loaded) Qt.callLater(tick)
  onActiveChanged: if (active) poke()
  onEnabledChanged: if (enabled) poke()

  RequestQueue {
    id: web
    gaps: ({ nasdaq: 350, fx: 2000, cnn: 2000, news: 1500 })
  }

  // Fast lane for quotes: a first load backfills ~50 profile / earnings /
  // chart requests at 1-3 s each, and live prices shouldn't queue behind.
  RequestQueue {
    id: quoteLane
    gaps: ({ nasdaq: 300 })
  }

  // Public GET with browser-like headers; `referer` doubles as the Origin
  // (Nasdaq and CNN both refuse requests without them). Response framing
  // matches the Trading 212 fetches so one parser classifies both.
  function fetch(id, key, url, accept, referer, done, lane) {
    var script = "origin=\"${3%/}\"\n"
      + "set -- \"$1\" \"$2\" \"$3\" \"$4\" \"$origin\"\n"
      + "if [ -n \"$3\" ]; then\n"
      + "  curl -sS --compressed --max-time 12 -A \"$4\" -H \"Accept: $2\" -H \"Referer: $3\" -H \"Origin: $5\" -w '\\n__T212_HTTP__ %{http_code}' \"$1\" 2>/dev/null || echo \"__T212_STATUS__ curl_error\"\n"
      + "else\n"
      + "  curl -sS --compressed --max-time 12 -A \"$4\" -H \"Accept: $2\" -w '\\n__T212_HTTP__ %{http_code}' \"$1\" 2>/dev/null || echo \"__T212_STATUS__ curl_error\"\n"
      + "fi\n"
    var queue = lane || web
    queue.enqueue({
      id: id,
      key: key,
      command: ["bash", "-c", script, "market", url, accept, referer, userAgent],
      done: function(raw) {
        var result = T212.classify(raw)
        done(result.kind === "ok" ? result.body : null, result)
      }
    })
  }

  function nasdaqUrl(path) {
    return "https://api.nasdaq.com/api" + path
  }

  function nasdaq(id, path, done, lane) {
    fetch(id, "nasdaq", nasdaqUrl(path), "application/json, text/plain, */*", "https://www.nasdaq.com/", function(body, result) {
      if (body === null) {
        _failures += 1
        if (_failures >= 6) {
          blockedUntil = Date.now() + 15 * 60000
          _failures = 0
          web.clear()
          quoteLane.clear()
        }
        return
      }
      _failures = 0
      done(body)
    }, lane)
  }

  function assetClass(sym) {
    return assetClasses[sym] || "stocks"
  }

  function assign(mapName, key, value) {
    var next = {}
    var current = root[mapName]
    for (var k in current) next[k] = current[k]
    next[key] = value
    root[mapName] = next
    schedulePersist()
  }

  // Nasdaq answers `data: null` when the asset class is wrong; ETFs live
  // under assetclass=etf. One retry flips the class and remembers it.
  function withClass(sym, request) {
    request(assetClass(sym), function() {
      if (assetClass(sym) === "stocks") {
        assign("assetClasses", sym, "etf")
        request("etf", null)
      }
    })
  }

  function fetchQuote(sym) {
    withClass(sym, function(cls, onMissing) {
      nasdaq("quote:" + sym + ":" + cls, "/quote/" + encodeURIComponent(sym) + "/info?assetclass=" + cls, function(body) {
        var q = Market.parseQuote(body, Date.now())
        if (q) assign("quotes", sym, q)
        else if (onMissing) onMissing()
      }, quoteLane)
    })
  }

  function fetchProfile(sym) {
    withClass(sym, function(cls, onMissing) {
      nasdaq("profile:" + sym + ":" + cls, "/quote/" + encodeURIComponent(sym) + "/summary?assetclass=" + cls, function(body) {
        var p = Market.parseProfile(body, Date.now())
        if (p) assign("profiles", sym, p)
        else if (onMissing) onMissing()
      })
    })
  }

  function fetchEarnings(sym) {
    // ETFs have no earnings; record the miss so it isn't retried hourly.
    if (assetClass(sym) === "etf") return
    nasdaq("earnings:" + sym, "/analyst/" + encodeURIComponent(sym) + "/earnings-date", function(body) {
      var e = Market.parseEarnings(body, Date.now())
      assign("earnings", sym, e || { time: 0, estimated: false, epsForecast: null, fetchedAt: Date.now() })
    })
  }

  function fetchChart(sym) {
    var to = new Date()
    var from = new Date(to.getTime() - 366 * 86400000)
    function ymd(d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2) }
    withClass(sym, function(cls, onMissing) {
      nasdaq("chart:" + sym + ":" + cls, "/quote/" + encodeURIComponent(sym) + "/chart?assetclass=" + cls + "&fromdate=" + ymd(from) + "&todate=" + ymd(to), function(body) {
        var c = Market.parseChart(body, Date.now())
        if (c && c.points.length > 0) assign("charts", sym, c)
        else if (onMissing) onMissing()
      })
    })
  }

  function fetchFx() {
    fetch("fx", "fx", "https://api.frankfurter.dev/v1/latest?base=EUR", "application/json", "", function(body) {
      var parsed = body === null ? null : Market.parseFx(body, Date.now())
      if (parsed) {
        fx = parsed
        schedulePersist()
      }
    })
  }

  function fetchMood() {
    fetch("mood", "cnn", "https://production.dataviz.cnn.io/index/fearandgreed/graphdata", "application/json", "https://edition.cnn.com/", function(body) {
      var parsed = body === null ? null : Market.parseFearGreed(body, Date.now())
      if (parsed) {
        mood = parsed
        schedulePersist()
      }
    })
  }

  // Headlines for one holding, cached for 30 minutes; not persisted.
  function fetchNews(position) {
    if (!enabled || !position) return
    var key = position.rawTicker
    if (!Market.isStale(news[key], 30 * 60000, Date.now()) || newsLoading[key]) return
    var loading = {}
    for (var k in newsLoading) loading[k] = newsLoading[k]
    loading[key] = true
    newsLoading = loading
    fetch("news:" + key, "news", Market.newsUrl(position), "application/rss+xml, application/xml, text/xml", "", function(body) {
      var done = {}
      for (var k2 in newsLoading) if (k2 !== key) done[k2] = newsLoading[k2]
      newsLoading = done
      assign("news", key, { items: body === null ? [] : Market.parseNews(body, 8), fetchedAt: Date.now(), failed: body === null })
    })
  }

  // Throttled, not debounced: while a refresh streams in a result a second,
  // a restarting debounce would never fire.
  function schedulePersist() {
    if (!persistTimer.running) persistTimer.start()
  }

  // Queue whatever is stale. Cheap to call often: the queue dedupes ids.
  function tick() {
    if (!enabled || !_loaded) return
    var nowMs = Date.now()
    if (blockedUntil > nowMs) return
    var quoteAge = active ? 120000 : 600000
    // One pass per data kind, so every holding's quote lands before any
    // slower, less time-critical profile / earnings / chart request.
    var i
    for (i = 0; i < symbols.length; i++) if (Market.isStale(quotes[symbols[i]], quoteAge, nowMs)) fetchQuote(symbols[i])
    for (i = 0; i < symbols.length; i++) if (Market.isStale(profiles[symbols[i]], 86400000, nowMs)) fetchProfile(symbols[i])
    for (i = 0; i < symbols.length; i++) if (Market.isStale(earnings[symbols[i]], 86400000, nowMs)) fetchEarnings(symbols[i])
    for (i = 0; i < symbols.length; i++) if (Market.isStale(charts[symbols[i]], 6 * 3600000, nowMs)) fetchChart(symbols[i])
    if (Market.isStale(fx, 12 * 3600000, nowMs)) fetchFx()
    if (Market.isStale(mood, 3600000, nowMs)) fetchMood()
  }

  function poke() {
    Qt.callLater(tick)
  }

  StateFile {
    id: file
    path: root.path
    onTextLoaded: function(text) {
      var parsed = null
      try {
        parsed = JSON.parse(text)
      } catch (error) {
        parsed = null
      }
      if (parsed && typeof parsed === "object") {
        root.quotes = parsed.quotes || {}
        root.profiles = parsed.profiles || {}
        root.earnings = parsed.earnings || {}
        root.charts = parsed.charts || {}
        root.assetClasses = parsed.assetClasses || {}
        root.fx = parsed.fx || null
        root.mood = parsed.mood || null
      }
      root._loaded = true
      root.poke()
    }
  }

  Timer {
    id: persistTimer
    interval: 5000
    repeat: false
    onTriggered: file.write(JSON.stringify({
      quotes: root.quotes,
      profiles: root.profiles,
      earnings: root.earnings,
      charts: root.charts,
      assetClasses: root.assetClasses,
      fx: root.fx,
      mood: root.mood
    }))
  }

  Timer {
    interval: 60000
    running: root.enabled
    repeat: true
    onTriggered: root.tick()
  }
}
