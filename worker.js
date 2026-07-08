const NEWS_SOURCES = [
  {
    name: "NSE India",
    url: "https://www.nseindia.com/api/corporate-announcements?index=equities"
  }
];

const CACHE_TTL_SECONDS = 60;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // API endpoint
    if (url.pathname === "/api/news") {
      return getNewsResponse(request);
    }

    // Health endpoint
    if (url.pathname === "/api/health") {
      return jsonResponse({
        status: "ok",
        service: "Market Pulse India",
        time: new Date().toISOString()
      });
    }

    // Main website
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return htmlResponse(APP_HTML);
    }

    return new Response("Not Found", {
      status: 404,
      headers: securityHeaders()
    });
  },

  async scheduled(controller, env, ctx) {
    // Keep scheduled handler valid.
    // News is fetched on demand through /api/news.
    console.log("Market Pulse India scheduled trigger executed.");
  }
};

async function getNewsResponse(request) {
  try {
    const cache = caches.default;
    const cacheKey = new Request(
      new URL("/api/news", request.url).toString(),
      { method: "GET" }
    );

    const cached = await cache.match(cacheKey);

    if (cached) {
      return cached;
    }

    const items = [];

    for (const source of NEWS_SOURCES) {
      try {
        const response = await fetch(source.url, {
          headers: {
            "Accept": "application/json,text/plain,*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "User-Agent":
              "Mozilla/5.0 (compatible; MarketPulseIndia/1.0)"
          }
        });

        if (!response.ok) {
          continue;
        }

        const data = await response.json();

        if (!Array.isArray(data)) {
          continue;
        }

        for (const item of data.slice(0, 100)) {
          const headline =
            cleanText(item.subject) ||
            cleanText(item.desc) ||
            cleanText(item.sm_name);

          if (!headline) continue;

          const category = classifyNews(headline);

          items.push({
            id: String(
              item.seq_id ||
              item.attchmntFile ||
              `${headline}-${item.an_dt || ""}`
            ),

            source: source.name,

            headline,

            category,

            impact: calculateImpact(headline),

            publishedAt:
              item.an_dt ||
              item.sort_date ||
              item.exchdisstime ||
              null,

            link: buildNseLink(item.attchmntFile)
          });
        }
      } catch (error) {
        console.error("Source fetch failed:", source.name, error);
      }
    }

    const finalItems = deduplicate(items)
      .sort(sortByDateDescending)
      .slice(0, 100);

    const response = jsonResponse({
      status: "ok",
      count: finalItems.length,
      updatedAt: new Date().toISOString(),
      items: finalItems
    });

    response.headers.set(
      "Cache-Control",
      `public, max-age=${CACHE_TTL_SECONDS}`
    );

    ctxWaitUntilSafe(
      caches.default.put(cacheKey, response.clone())
    );

    return response;
  } catch (error) {
    return jsonResponse(
      {
        status: "error",
        message: "Unable to load market news.",
        items: []
      },
      500
    );
  }
}

function classifyNews(text) {
  const value = text.toLowerCase();

  if (
    value.includes("order") ||
    value.includes("contract") ||
    value.includes("acquisition") ||
    value.includes("merger") ||
    value.includes("approval") ||
    value.includes("dividend") ||
    value.includes("buyback") ||
    value.includes("fund raising") ||
    value.includes("fundraising")
  ) {
    return "CORPORATE";
  }

  if (
    value.includes("result") ||
    value.includes("profit") ||
    value.includes("revenue") ||
    value.includes("earnings")
  ) {
    return "RESULTS";
  }

  if (
    value.includes("rbi") ||
    value.includes("sebi") ||
    value.includes("government") ||
    value.includes("ministry") ||
    value.includes("policy")
  ) {
    return "POLICY";
  }

  return "MARKET";
}

function calculateImpact(text) {
  const value = text.toLowerCase();

  const highImpactWords = [
    "acquisition",
    "merger",
    "order received",
    "large order",
    "contract awarded",
    "buyback",
    "bonus issue",
    "stock split",
    "fund raising",
    "fundraising",
    "regulatory approval",
    "default",
    "fraud",
    "insolvency"
  ];

  const mediumImpactWords = [
    "dividend",
    "results",
    "profit",
    "revenue",
    "earnings",
    "board meeting",
    "management change",
    "agreement",
    "partnership"
  ];

  if (highImpactWords.some(word => value.includes(word))) {
    return "HIGH";
  }

  if (mediumImpactWords.some(word => value.includes(word))) {
    return "MEDIUM";
  }

  return "LOW";
}

function deduplicate(items) {
  const seen = new Set();

  return items.filter(item => {
    const key = `${item.source}|${item.headline}`.toLowerCase();

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

function sortByDateDescending(a, b) {
  const timeA = Date.parse(a.publishedAt || "") || 0;
  const timeB = Date.parse(b.publishedAt || "") || 0;

  return timeB - timeA;
}

function cleanText(value) {
  if (!value) return "";

  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildNseLink(file) {
  if (!file) {
    return "https://www.nseindia.com/companies-listing/corporate-filings-announcements";
  }

  if (String(file).startsWith("http")) {
    return String(file);
  }

  return `https://nsearchives.nseindia.com/corporate/${file}`;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      ...securityHeaders()
    }
  });
}

function htmlResponse(html) {
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      ...securityHeaders()
    }
  });
}

function securityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin"
  };
}

function ctxWaitUntilSafe(promise) {
  // Cache writes are best-effort.
  promise.catch(error => console.error("Cache write failed:", error));
}

const APP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport"
content="width=device-width,initial-scale=1,maximum-scale=1">

<title>Market Pulse India</title>

<style>
:root {
  color-scheme: dark;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: #07090d;
  color: #f5f7fa;
  font-family:
    Inter,
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}

header {
  position: sticky;
  top: 0;
  z-index: 10;
  padding: 18px;
  border-bottom: 1px solid #262b33;
  background: rgba(7, 9, 13, 0.96);
  backdrop-filter: blur(16px);
}

.brand {
  font-size: 22px;
  font-weight: 900;
  letter-spacing: -0.5px;
}

.brand span {
  color: #ff9d00;
}

.subtitle {
  margin-top: 4px;
  color: #8d96a5;
  font-size: 12px;
}

.status-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 14px;
}

.status {
  padding: 7px 10px;
  border: 1px solid #2d333d;
  border-radius: 999px;
  color: #aab2bf;
  font-size: 11px;
  font-weight: 700;
}

.status.live {
  color: #35d07f;
}

main {
  width: min(100%, 900px);
  margin: auto;
  padding: 16px;
}

.hero {
  padding: 20px;
  border: 1px solid #272d36;
  border-radius: 18px;
  background:
    linear-gradient(
      135deg,
      rgba(255,157,0,0.12),
      rgba(255,157,0,0.01)
    );
}

.hero h1 {
  margin: 0;
  font-size: 26px;
  line-height: 1.1;
}

.hero p {
  margin: 9px 0 0;
  color: #9ca5b3;
  font-size: 13px;
  line-height: 1.5;
}

.controls {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
  margin: 16px 0;
}

.search {
  width: 100%;
  padding: 13px 14px;
  border: 1px solid #2a3039;
  border-radius: 12px;
  outline: none;
  background: #10141a;
  color: white;
  font-size: 14px;
}

.filters {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
}

button {
  flex: 0 0 auto;
  padding: 10px 13px;
  border: 1px solid #303741;
  border-radius: 10px;
  background: #11161d;
  color: #c4cbd5;
  font-weight: 800;
}

button.active {
  border-color: #ff9d00;
  color: #ffad29;
}

.summary {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin: 14px 2px;
  color: #7f8998;
  font-size: 12px;
}

.news-list {
  display: grid;
  gap: 10px;
}

.card {
  padding: 15px;
  border: 1px solid #252b34;
  border-radius: 14px;
  background: #0d1117;
}

.card.high {
  border-left: 4px solid #ff4d4d;
}

.card.medium {
  border-left: 4px solid #ff9d00;
}

.card.low {
  border-left: 4px solid #4d86ff;
}

.card-top {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.badges {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.badge {
  padding: 4px 7px;
  border-radius: 6px;
  background: #181e27;
  color: #9ba6b5;
  font-size: 10px;
  font-weight: 900;
}

.impact-high {
  color: #ff6565;
}

.impact-medium {
  color: #ffae32;
}

.impact-low {
  color: #6f9cff;
}

.time {
  color: #687384;
  font-size: 10px;
  white-space: nowrap;
}

.headline {
  margin-top: 11px;
  font-size: 15px;
  font-weight: 750;
  line-height: 1.45;
}

.source-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-top: 13px;
}

.source {
  color: #718096;
  font-size: 11px;
}

.source-link {
  color: #ffad29;
  text-decoration: none;
  font-size: 12px;
  font-weight: 800;
}

.empty {
  padding: 50px 20px;
  border: 1px dashed #303641;
  border-radius: 14px;
  color: #7e8794;
  text-align: center;
}

footer {
  padding: 30px 16px 45px;
  color: #596271;
  text-align: center;
  font-size: 11px;
}

@media (min-width: 700px) {
  .controls {
    grid-template-columns: 1fr auto;
  }
}
</style>
</head>

<body>

<header>
  <div class="brand">MARKET <span>PULSE</span> INDIA</div>

  <div class="subtitle">
    Market-impact headlines from original sources.
  </div>

  <div class="status-row">
    <div class="status live" id="status">
      ● CONNECTING
    </div>

    <div class="status" id="updated">
      UPDATED —
    </div>

    <div class="status" id="count">
      0 ITEMS
    </div>
  </div>
</header>

<main>

  <section class="hero">
    <h1>News that may move the Indian market.</h1>

    <p>
      Filter exchange announcements by estimated impact.
      Always verify the original filing before making a trading decision.
    </p>
  </section>

  <section class="controls">

    <input
      id="search"
      class="search"
      placeholder="Search company, headline or category..."
    >

    <div class="filters">
      <button class="active" data-impact="ALL">ALL</button>
      <button data-impact="HIGH">HIGH IMPACT</button>
      <button data-impact="MEDIUM">MEDIUM</button>
    </div>

  </section>

  <div class="summary">
    <span id="showing">Showing 0 headlines</span>
    <span>Auto refresh: 60 sec</span>
  </div>

  <section id="news" class="news-list">
    <div class="empty">Loading market news...</div>
  </section>

</main>

<footer>
  Market Pulse India · Informational tool only · Not investment advice
</footer>

<script>
let allItems = [];
let selectedImpact = "ALL";

const newsElement = document.getElementById("news");
const searchElement = document.getElementById("search");
const statusElement = document.getElementById("status");
const updatedElement = document.getElementById("updated");
const countElement = document.getElementById("count");
const showingElement = document.getElementById("showing");

async function loadNews() {
  try {
    statusElement.textContent = "● UPDATING";

    const response = await fetch("/api/news", {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("API request failed");
    }

    const data = await response.json();

    allItems = Array.isArray(data.items)
      ? data.items
      : [];

    statusElement.textContent = "● LIVE";

    countElement.textContent =
      allItems.length + " ITEMS";

    updatedElement.textContent =
      "UPDATED " +
      new Date(data.updatedAt || Date.now())
        .toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit"
        });

    renderNews();
  } catch (error) {
    statusElement.textContent = "● CONNECTION ERROR";

    newsElement.innerHTML =
      '<div class="empty">Unable to load news right now.</div>';
  }
}

function renderNews() {
  const query =
    searchElement.value
      .trim()
      .toLowerCase();

  const filtered = allItems.filter(item => {
    const impactMatch =
      selectedImpact === "ALL" ||
      item.impact === selectedImpact;

    const text = [
      item.headline,
      item.source,
      item.category
    ]
      .join(" ")
      .toLowerCase();

    return impactMatch && text.includes(query);
  });

  showingElement.textContent =
    "Showing " + filtered.length + " headlines";

  if (!filtered.length) {
    newsElement.innerHTML =
      '<div class="empty">No matching market-impact headlines.</div>';

    return;
  }

  newsElement.innerHTML = filtered
    .map(item => {
      const impact =
        String(item.impact || "LOW").toLowerCase();

      return \`
        <article class="card \${escapeHtml(impact)}">

          <div class="card-top">

            <div class="badges">

              <span class="badge">
                \${escapeHtml(item.category)}
              </span>

              <span class="badge impact-\${escapeHtml(impact)}">
                \${escapeHtml(item.impact)} IMPACT
              </span>

            </div>

            <span class="time">
              \${formatTime(item.publishedAt)}
            </span>

          </div>

          <div class="headline">
            \${escapeHtml(item.headline)}
          </div>

          <div class="source-row">

            <span class="source">
              SOURCE: \${escapeHtml(item.source)}
            </span>

            <a
              class="source-link"
              href="\${escapeAttribute(item.link)}"
              target="_blank"
              rel="noopener noreferrer"
            >
              ORIGINAL ↗
            </a>

          </div>

        </article>
      \`;
    })
    .join("");
}

function formatTime(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString([], {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value || "#");
}

searchElement.addEventListener("input", renderNews);

document
  .querySelectorAll("[data-impact]")
  .forEach(button => {
    button.addEventListener("click", () => {
      document
        .querySelectorAll("[data-impact]")
        .forEach(item =>
          item.classList.remove("active")
        );

      button.classList.add("active");

      selectedImpact =
        button.dataset.impact;

      renderNews();
    });
  });

loadNews();

setInterval(loadNews, 60000);
</script>

</body>
</html>`;
