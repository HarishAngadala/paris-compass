import { fetchJson, clearApiCache } from './api.js';
import { initMap, updateScores, focusCountry, invalidateMap } from './map.js';

const state = {
  countries: [],
  byIso: new Map(),
  topic: 'overall',
  ranking: [],
  selected: null,
  sources: [],
  meta: {},
  initialized: false,
};

const topics = {
  overall: { title: 'Overall index', mapLabel: 'Climate Compliance Index', subtitle: 'Higher score = stronger relative performance' },
  emissions: { title: 'Emissions performance', mapLabel: 'CO₂ Emissions Performance', subtitle: 'Lower per-capita emissions score higher' },
  energy: { title: 'Renewable energy performance', mapLabel: 'Renewable Energy Performance', subtitle: 'Higher renewable share scores higher' },
  eco_footprint: { title: 'Ecological footprint performance', mapLabel: 'Ecological Footprint Performance', subtitle: 'Lower ecological footprint scores higher' },
};

const el = (id) => document.getElementById(id);
const fmt = (value, digits = 1) => value == null ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });

document.addEventListener('DOMContentLoaded', bindLanding);

function bindLanding() {
  el('startBtn')?.addEventListener('click', openDashboard);
  el('heroAboutButton')?.addEventListener('click', () => el('aboutDialog').showModal());
  el('aboutButton')?.addEventListener('click', () => el('aboutDialog').showModal());
}

async function openDashboard() {
  el('welcome').classList.add('hidden');
  el('dashboard').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'instant' });

  if (state.initialized) {
    requestAnimationFrame(() => invalidateMap());
    return;
  }

  state.initialized = true;
  await bootDashboard();
}

async function bootDashboard() {
  bindDashboardUi();
  try {
    const mapPromise = initMap(handleMapCountryClick, () => {});
    const countriesPromise = fetchJson('/api/countries', { timeout: 12_000, retries: 2, ttl: 30_000 });
    const [_, response] = await Promise.all([mapPromise, countriesPromise]);
    el('mapLoading').classList.add('hidden');
    ingestCountries(response);
    await setTopic('overall');
    setStatus(response.meta?.refreshing ? 'Refreshing live data…' : dataStatusText(response.meta), response.meta?.refreshing ? 'loading' : 'ready');
  } catch (error) {
    console.error(error);
    el('mapLoading').innerHTML = '<strong>Unable to load the interactive map.</strong><span>Check your connection and reload the page.</span>';
    setStatus('Data unavailable', 'error');
  }
}

function bindDashboardUi() {
  document.querySelectorAll('.metric-button').forEach((button) => {
    button.addEventListener('click', () => setTopic(button.dataset.topic));
  });

  el('countrySearch').addEventListener('change', handleSearch);
  el('countrySearch').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleSearch();
    }
  });

  el('insightButton').addEventListener('click', loadInsight);
  el('refreshButton').addEventListener('click', refreshData);
}

function ingestCountries(response) {
  state.countries = response.countries || [];
  state.byIso = new Map(state.countries.map((country) => [country.iso3, country]));
  state.sources = response.meta?.sources || [];
  state.meta = response.meta || {};

  const datalist = el('countryList');
  datalist.innerHTML = state.countries.map((c) => `<option value="${escapeHtml(c.name)}"></option>`).join('');

  el('countryCountBadge').textContent = state.countries.length ? `${state.countries.length} countries` : '—';
  el('lastUpdatedBadge').textContent = formatRefreshTime(state.meta.lastRefresh);
  renderSources();
}

async function setTopic(topic) {
  if (!topics[topic]) return;
  state.topic = topic;

  document.querySelectorAll('.metric-button').forEach((button) => {
    const active = button.dataset.topic === topic;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });

  el('rankingTitle').textContent = topics[topic].title;
  el('mapMetricLabel').textContent = topics[topic].mapLabel;
  el('mapMetricSubtitle').textContent = topics[topic].subtitle;

  try {
    const response = await fetchJson(`/api/index?topic=${encodeURIComponent(topic)}`, { ttl: 30_000 });
    state.ranking = response.ranking || [];
    updateScores(state.ranking);
    renderRanking();
  } catch (error) {
    console.error(error);
    setStatus('Metric unavailable', 'error');
  }
}

function renderRanking() {
  const list = el('rankingList');
  el('rankCount').textContent = `${state.ranking.length} scored`;
  const visible = state.ranking.slice(0, 12);

  list.innerHTML = visible.map((row, index) => `
    <button class="rank-row" type="button" data-code="${escapeHtml(row.iso3)}">
      <span class="rank-number">${String(index + 1).padStart(2, '0')}</span>
      <span class="rank-country"><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.iso3)}</small></span>
      <span class="rank-score">${fmt(row.score, 1)}</span>
    </button>
  `).join('');

  list.querySelectorAll('.rank-row').forEach((button) => {
    button.addEventListener('click', () => selectCountry(button.dataset.code, true));
  });
}

function handleMapCountryClick({ iso3 }) {
  selectCountry(iso3, false);
}

function handleSearch() {
  const query = el('countrySearch').value.trim().toLowerCase();
  if (!query) return;

  const exact = state.countries.find((c) => c.name.toLowerCase() === query || c.iso3.toLowerCase() === query);
  const starts = exact || state.countries.find((c) => c.name.toLowerCase().startsWith(query));
  const fuzzy = starts || state.countries.find((c) => c.name.toLowerCase().includes(query));

  if (fuzzy) {
    el('countrySearch').value = fuzzy.name;
    selectCountry(fuzzy.iso3, true);
  }
}

function selectCountry(iso3, zoomMap) {
  const country = state.byIso.get(iso3);
  if (!country) {
    showMissingCountry(iso3);
    return;
  }

  state.selected = country;
  renderCountry(country);
  if (zoomMap) focusCountry(iso3);
}

function renderCountry(country) {
  el('emptyCard').classList.add('hidden');
  el('countryCard').classList.remove('hidden');
  el('countryCode').textContent = country.iso3;
  el('countryName').textContent = country.name;

  const score = country.overallScore == null ? null : Math.max(0, Math.min(100, country.overallScore));
  el('overallScore').textContent = score == null ? '—' : fmt(score, 0);
  el('scoreRing').style.setProperty('--score', score ?? 0);

  el('countryStatus').textContent = country.status || 'Data available';
  el('countryStatus').dataset.status = String(country.status || '').toLowerCase().replace(/\s+/g, '-');
  el('coverageText').textContent = `${country.coverage ?? 0}/3 metrics available`;

  el('emissionsValue').textContent = country.emissionsPerCapita == null ? '—' : `${fmt(country.emissionsPerCapita, 2)} t`;
  el('emissionsYear').textContent = country.emissionsYear ? `Data year ${country.emissionsYear}` : 'No current data';
  el('emissionsMiniScore').textContent = miniScore(country.emissionsScore);

  el('renewableValue').textContent = country.renewableShare == null ? '—' : `${fmt(country.renewableShare, 1)}%`;
  el('renewableYear').textContent = country.renewableYear ? `Data year ${country.renewableYear}` : 'No current data';
  el('energyMiniScore').textContent = miniScore(country.energyScore);

  el('footprintValue').textContent = country.ecologicalFootprint == null ? '—' : `${fmt(country.ecologicalFootprint, 2)} gha`;
  el('footprintMiniScore').textContent = miniScore(country.footprintScore);

  el('insightBox').classList.add('hidden');
  el('insightText').textContent = '';
  el('insightSource').textContent = '';
  el('insightButton').disabled = false;
  el('insightButton').innerHTML = '<span class="sparkle">✦</span><span>Generate Gemini climate insight</span><span class="button-arrow">→</span>';
}

function showMissingCountry(iso3) {
  el('emptyCard').classList.remove('hidden');
  el('countryCard').classList.add('hidden');
  el('emptyCard').innerHTML = `
    <div class="empty-orbit"><span>!</span></div>
    <p class="panel-kicker">COUNTRY INSPECTOR</p>
    <h2>No matched climate record</h2>
    <p>${escapeHtml(iso3)} appears on the map, but the loaded datasets do not contain a matched climate score.</p>
  `;
}

async function loadInsight() {
  if (!state.selected) return;
  const button = el('insightButton');
  button.disabled = true;
  button.innerHTML = '<span class="sparkle">✦</span><span>Analyzing climate data…</span><span class="button-arrow">…</span>';

  try {
    const response = await fetchJson(`/api/insights?code=${state.selected.iso3}`, { ttl: 5 * 60_000, timeout: 25_000, retries: 1 });
    el('insightText').textContent = response.insight;
    el('insightSource').textContent = response.source === 'gemini' || response.source === 'cache'
      ? 'Generated with Gemini from the climate metrics displayed above.'
      : 'Local deterministic summary. Add GEMINI_API_KEY to enable Gemini.';
    el('insightBox').classList.remove('hidden');
  } catch (error) {
    el('insightText').textContent = 'The insight service is temporarily unavailable.';
    el('insightSource').textContent = error.message;
    el('insightBox').classList.remove('hidden');
  } finally {
    button.disabled = false;
    button.innerHTML = '<span class="sparkle">✦</span><span>Regenerate climate insight</span><span class="button-arrow">→</span>';
  }
}

async function refreshData() {
  const button = el('refreshButton');
  button.disabled = true;
  setStatus('Refreshing live data…', 'loading');

  try {
    await fetchJson('/api/refresh', { method: 'POST', retries: 0, timeout: 5_000 });
    await waitForRefresh();
    clearApiCache();
    const response = await fetchJson('/api/countries', { ttl: 0, timeout: 12_000 });
    ingestCountries(response);
    await setTopic(state.topic);
    if (state.selected) selectCountry(state.selected.iso3, false);
    setStatus(dataStatusText(response.meta), 'ready');
  } catch (error) {
    console.error(error);
    setStatus('Refresh failed', 'error');
  } finally {
    button.disabled = false;
  }
}

async function waitForRefresh() {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    clearApiCache();
    const health = await fetchJson('/api/health', { ttl: 0, retries: 0 });
    if (!health.data?.refreshing) return;
  }
}

function renderSources() {
  const box = el('sourceList');
  box.innerHTML = '<h3>Data sources</h3>' + state.sources.map((source) => `
    <div class="source-row">
      <span>${escapeHtml(String(source.metric || '').replace('_', ' '))}</span>
      <strong>${escapeHtml(source.name)}</strong>
    </div>
  `).join('');
}

function setStatus(text, mode) {
  const status = el('dataStatus');
  status.className = `status-pill ${mode}`;
  status.innerHTML = `<span class="status-dot"></span>${escapeHtml(text)}`;
}

function dataStatusText(meta) {
  const count = meta?.countryCount || state.countries.length;
  return count ? `${count} countries loaded` : 'Data ready';
}

function formatRefreshTime(value) {
  if (!value) return 'Loading';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function miniScore(value) {
  return value == null ? '—' : `${fmt(value, 0)}/100`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
