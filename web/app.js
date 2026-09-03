/**
 * Paris Compass — original HackRU layout, wired to the completed Java backend.
 *
 * Visible UI intentionally matches the original project:
 *   welcome -> Climate Gauge -> three topic tabs -> map -> legend/badges.
 */

// ================== Fetch layer (timeout + retries + cache) ==================
const BASE_URL = "";
const DEFAULT_TIMEOUT_MS = 12000;
const MAX_RETRIES = 2;
const __cache = new Map();

function withTimeout(promiseFactory, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return (async () => {
    try {
      return await promiseFactory(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  })();
}

async function fetchJSON(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const isAbsolute = /^https?:\/\//i.test(url);
  const absolute = isAbsolute ? url : `${BASE_URL}${url}`;
  const isGET = !options.method || options.method.toUpperCase() === "GET";
  const key = isGET ? `GET ${absolute}` : null;
  if (key && __cache.has(key)) return __cache.get(key);

  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await withTimeout(
        (signal) => fetch(absolute, { ...options, signal }),
        timeoutMs
      );

      if (!res.ok) {
        const txt = (await res.text().catch(() => "")).slice(0, 600);
        const err = new Error(`HTTP ${res.status} on ${absolute}${txt ? ` – ${txt}` : ""}`);
        err.status = res.status;
        throw err;
      }

      const data = await res.json();
      if (key) __cache.set(key, data);
      return data;
    } catch (err) {
      lastErr = err;
      const isAbort = err?.name === "AbortError";
      const is5xx = err?.status >= 500 && err?.status <= 599;
      const isNetwork = err instanceof TypeError;
      if (attempt < MAX_RETRIES && (isAbort || is5xx || isNetwork)) {
        const backoff = 150 * (attempt + 1) * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error("Unknown fetch error");
}

function clearApiCache() { __cache.clear(); }

// ---------- Simple utilities ----------
const el = (id) => document.getElementById(id);
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Red (bad) to blue (good) color for 0..1 — same scale as the original.
function colorScale(t) {
  const clamp = Math.max(0, Math.min(1, t ?? 0));
  const r0 = 239, g0 = 68, b0 = 68;
  const r1 = 59, g1 = 130, b1 = 246;
  const r = Math.round(r0 + (r1 - r0) * clamp);
  const g = Math.round(g0 + (g1 - g0) * clamp);
  const b = Math.round(b0 + (b1 - b0) * clamp);
  return `rgb(${r},${g},${b})`;
}

const fmt = (v) => (v === null || v === undefined || Number.isNaN(Number(v)))
  ? "—"
  : Number(v).toFixed(2);

const TOPIC_META = {
  emissions: {
    label: "Emissions",
    source: "OWID (CO₂) / UNFCCC",
    fallbackUrl: "https://ourworldindata.org/co2-emissions"
  },
  energy: {
    label: "Energy Usage",
    source: "OWID (Renewables) / IRENA",
    fallbackUrl: "https://ourworldindata.org/renewable-energy"
  },
  eco_footprint: {
    label: "Ecological Footprint",
    source: "Global Footprint Network",
    fallbackUrl: "https://www.footprintnetwork.org/"
  }
};

const GEOJSON_URLS = [
  "https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson",
  "https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json"
];

// ---------- App state ----------
let map;
let countryLayer;
let activeTopic = "emissions";
let backendMeta = null;
let backendCountriesByISO = new Map();
let countryIndexByISO = new Map();

function startApp() {
  $("#welcome").style.display = "none";
  $("#gauge").style.display = "block";
  initMap();
}

document.addEventListener("DOMContentLoaded", () => {
  const startBtn = el("startBtn");
  if (startBtn) startBtn.addEventListener("click", startApp);
});

async function initMap() {
  map = L.map("map", {
    worldCopyJump: true,
    minZoom: 1.5,
    maxZoom: 8,
    zoomSnap: 0.25,
    zoomDelta: 0.5
  }).setView([20, 0], 2.1);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  try {
    await Promise.all([loadBackendCountries(), loadCountryBoundaries()]);
    await loadTopic("emissions");
  } catch (err) {
    console.error("Initialization error", err);
    buildCountryLayer(window.__DEMO_GEOJSON);
    el("lastUpdated").textContent = "Demo";
    applyTopicData("emissions", window.__DEMO_INDEX.emissions);
  }

  $$(".tab").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const topic = btn.dataset.topic;
      $$(".tab").forEach((b) => b.setAttribute("aria-pressed", "false"));
      btn.setAttribute("aria-pressed", "true");
      map?.closePopup();
      await loadTopic(topic);
    });
  });

  requestAnimationFrame(() => map.invalidateSize());
}

async function loadBackendCountries() {
  try {
    const response = await fetchJSON("/api/countries");
    backendMeta = response.meta || null;
    backendCountriesByISO = new Map(
      (response.countries || []).map((country) => [String(country.iso3 || "").toUpperCase(), country])
    );
    el("lastUpdated").textContent = formatUpdated(backendMeta?.lastRefresh);
  } catch (error) {
    console.warn("Country climate metadata unavailable", error);
    backendMeta = null;
    backendCountriesByISO.clear();
    el("lastUpdated").textContent = "—";
  }
}

async function loadCountryBoundaries() {
  let lastError;
  for (const url of GEOJSON_URLS) {
    try {
      const geojson = await fetchJSON(url, {}, 15000);
      buildCountryLayer(geojson);
      return;
    } catch (error) {
      lastError = error;
      console.warn(`Country boundary source failed: ${url}`, error);
    }
  }
  throw lastError || new Error("Unable to load country boundaries");
}

function buildCountryLayer(geojson) {
  if (countryLayer) countryLayer.remove();

  countryLayer = L.geoJSON(geojson, {
    style: () => ({
      color: "rgba(255,255,255,.25)",
      weight: 0.8,
      fillOpacity: 0.9,
      fillColor: "#2b2f42"
    }),
    onEachFeature: (feature, layer) => {
      layer.on({
        mouseover: (e) => e.target.setStyle({ weight: 2.0 }),
        mouseout: (e) => e.target.setStyle({ weight: 0.8 }),
        click: () => openPopup(feature, layer)
      });
    }
  }).addTo(map);
}

async function loadTopic(topic) {
  if (!TOPIC_META[topic]) return;
  activeTopic = topic;
  const meta = TOPIC_META[topic];
  el("topicLabel").textContent = meta.label;
  el("sourceLabel").textContent = meta.source;

  try {
    const payload = await fetchJSON(`/api/index?topic=${encodeURIComponent(topic)}`);
    const rows = (payload.ranking || []).map((row) => {
      const iso = String(row.iso3 || "").toUpperCase();
      const country = backendCountriesByISO.get(iso);
      return {
        iso_a3: iso,
        index: typeof row.score === "number" ? Math.max(0, Math.min(1, row.score / 100)) : null,
        summary: buildSummary(country, topic),
        sources: sourceUrlsFor(topic)
      };
    });

    if (!backendMeta && backendCountriesByISO.size === 0) await loadBackendCountries();
    el("lastUpdated").textContent = formatUpdated(backendMeta?.lastRefresh);
    applyTopicData(topic, rows);
  } catch (error) {
    console.warn("Falling back to demo topic data", error);
    el("lastUpdated").textContent = "Demo";
    applyTopicData(topic, window.__DEMO_INDEX[topic]);
  }
}

function applyTopicData(topic, rows) {
  activeTopic = topic;
  countryIndexByISO.clear();

  (rows || []).forEach((row) => {
    const iso = String(row.iso_a3 || row.iso3 || "").toUpperCase();
    countryIndexByISO.set(iso, {
      index: typeof row.index === "number" ? Math.max(0, Math.min(1, row.index)) : null,
      summary: row.summary || null,
      sources: Array.isArray(row.sources) ? row.sources : []
    });
  });

  if (!countryLayer) return;

  countryLayer.eachLayer((layer) => {
    const iso = getIso(layer.feature);
    const data = countryIndexByISO.get(iso);
    const fill = data && typeof data.index === "number" ? colorScale(data.index) : "#2b2f42";
    layer.setStyle({ fillColor: fill });
  });
}

function getIso(feature) {
  const p = feature?.properties || {};
  const candidates = [
    p.iso_a3,
    p.ISO_A3,
    p.ADM0_A3,
    p.SOV_A3,
    p["ISO3166-1-Alpha-3"],
    p.ISO3
  ];
  const code = candidates.find((candidate) => typeof candidate === "string" && /^[A-Z]{3}$/i.test(candidate));
  return code ? code.toUpperCase() : "";
}

function getCountryName(feature, iso) {
  const p = feature?.properties || {};
  return backendCountriesByISO.get(iso)?.name || p.admin || p.ADMIN || p.name || p.NAME || "Unknown";
}

function openPopup(feature, layer) {
  const iso = getIso(feature);
  const name = getCountryName(feature, iso);
  const data = countryIndexByISO.get(iso) || {};
  const country = backendCountriesByISO.get(iso);
  const summary = data.summary || buildSummary(country, activeTopic) || "No summary available yet.";

  const sourceHtml = (data.sources || sourceUrlsFor(activeTopic)).slice(0, 4).map((url) => {
    const safe = escapeHtml(url);
    return `<li><a href="${safe}" target="_blank" rel="noopener">${safe}</a></li>`;
  }).join("");

  const html = `
    <div>
      <div class="popup-title">${escapeHtml(name)} <span style="opacity:.7;font-weight:600">(${escapeHtml(iso || "—")})</span></div>
      <div class="popup-index">Index score: <strong>${fmt(data.index)}</strong> (0–1)</div>
      <div class="popup-summary">${escapeHtml(summary)}</div>
      ${sourceHtml ? `<div class="popup-sources"><strong>Sources</strong><ul>${sourceHtml}</ul></div>` : ""}
    </div>
  `;

  layer.bindPopup(html, { maxWidth: 320 }).openPopup();
}

function buildSummary(country, topic) {
  if (!country) return null;

  if (topic === "emissions") {
    if (country.emissionsPerCapita == null) return "No current per-capita CO₂ emissions value is available for this country.";
    const year = country.emissionsYear ? ` (${country.emissionsYear})` : "";
    return `${country.name} records ${Number(country.emissionsPerCapita).toFixed(2)} tonnes of CO₂ per person${year}. Its emissions performance score is ${displayScore(country.emissionsScore)} out of 100, where lower per-capita emissions score better.`;
  }

  if (topic === "energy") {
    if (country.renewableShare == null) return "No current renewable-energy share is available for this country.";
    const year = country.renewableYear ? ` (${country.renewableYear})` : "";
    return `${country.name} gets ${Number(country.renewableShare).toFixed(1)}% of final energy consumption from renewable sources${year}. Its energy performance score is ${displayScore(country.energyScore)} out of 100.`;
  }

  if (topic === "eco_footprint") {
    if (country.ecologicalFootprint == null) return "No current ecological-footprint value is available for this country.";
    const bio = country.biocapacity == null ? "" : ` Estimated biocapacity is ${Number(country.biocapacity).toFixed(2)} gha per person.`;
    return `${country.name} has an ecological footprint of ${Number(country.ecologicalFootprint).toFixed(2)} global hectares per person.${bio} Its footprint performance score is ${displayScore(country.footprintScore)} out of 100.`;
  }

  return null;
}

function displayScore(value) {
  return value == null || Number.isNaN(Number(value)) ? "—" : Number(value).toFixed(1);
}

function sourceUrlsFor(topic) {
  const metricSources = (backendMeta?.sources || [])
    .filter((source) => source.metric === topic)
    .map((source) => source.url)
    .filter((url) => typeof url === "string" && /^https?:\/\//i.test(url));

  return metricSources.length ? metricSources : [TOPIC_META[topic].fallbackUrl];
}

function formatUpdated(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

/* ---------- Demo fallbacks ---------- */
window.__DEMO_GEOJSON = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { admin: "United States", iso_a3: "USA" }, geometry: { type: "Polygon", coordinates: [[[ -125,25 ],[ -67,25 ],[ -67,49 ],[ -125,49 ],[ -125,25 ]]] } },
    { type: "Feature", properties: { admin: "Germany", iso_a3: "DEU" }, geometry: { type: "Polygon", coordinates: [[[ 5,47 ],[ 15,47 ],[ 15,55 ],[ 5,55 ],[ 5,47 ]]] } },
    { type: "Feature", properties: { admin: "India", iso_a3: "IND" }, geometry: { type: "Polygon", coordinates: [[[ 68,8 ],[ 97,8 ],[ 97,35 ],[ 68,35 ],[ 68,8 ]]] } },
    { type: "Feature", properties: { admin: "Brazil", iso_a3: "BRA" }, geometry: { type: "Polygon", coordinates: [[[ -75,-35 ],[ -34,-35 ],[ -34,5 ],[ -75,5 ],[ -75,-35 ]]] } }
  ]
};

window.__DEMO_INDEX = {
  emissions: [
    { iso_a3: "USA", index: 0.32, summary: "High per-capita emissions with gradual decline; further cuts are needed for stronger relative performance.", sources: ["https://ourworldindata.org/co2-emissions"] },
    { iso_a3: "DEU", index: 0.71, summary: "Germany scores relatively strongly on per-capita emissions compared with many high-income peers.", sources: ["https://ourworldindata.org/co2-emissions"] },
    { iso_a3: "IND", index: 0.48, summary: "Per-capita emissions remain relatively low while total emissions rise with economic growth.", sources: ["https://ourworldindata.org/co2-emissions"] },
    { iso_a3: "BRA", index: 0.62, summary: "Brazil performs relatively well on energy-related emissions, while land-use pressures remain important.", sources: ["https://ourworldindata.org/co2-emissions"] }
  ],
  energy: [
    { iso_a3: "USA", index: 0.45, summary: "Renewable energy deployment is growing, but fossil fuels still represent a substantial share of energy use.", sources: ["https://ourworldindata.org/renewable-energy"] },
    { iso_a3: "DEU", index: 0.78, summary: "Germany has a comparatively high renewable share and continues expanding wind and solar generation.", sources: ["https://ourworldindata.org/renewable-energy"] },
    { iso_a3: "IND", index: 0.54, summary: "India is rapidly expanding solar and other renewable capacity.", sources: ["https://ourworldindata.org/renewable-energy"] },
    { iso_a3: "BRA", index: 0.81, summary: "Hydropower, wind, and other renewable sources give Brazil a high renewable-energy share.", sources: ["https://ourworldindata.org/renewable-energy"] }
  ],
  eco_footprint: [
    { iso_a3: "USA", index: 0.20, summary: "The United States has a large ecological footprint per person relative to global levels.", sources: ["https://www.footprintnetwork.org/"] },
    { iso_a3: "DEU", index: 0.62, summary: "Germany's ecological footprint remains above a globally sustainable per-capita level.", sources: ["https://www.footprintnetwork.org/"] },
    { iso_a3: "IND", index: 0.74, summary: "India has a lower per-capita ecological footprint than many higher-income countries.", sources: ["https://www.footprintnetwork.org/"] },
    { iso_a3: "BRA", index: 0.68, summary: "Brazil has substantial biocapacity, though land-use and agricultural pressures remain significant.", sources: ["https://www.footprintnetwork.org/"] }
  ]
};
