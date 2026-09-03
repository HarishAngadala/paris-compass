const GEOJSON_URLS = [
  'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson',
  'https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json',
];

let map;
let geoLayer;
let scoreMap = new Map();
let selectedIso3 = null;
let selectedLayer = null;
let clickHandler = () => {};
let hoverHandler = () => {};

const palette = ['#ef5350', '#dc5f68', '#c46a81', '#aa709e', '#8b76bd', '#707ed7', '#5885ea', '#3b82f6'];

export async function initMap(onCountryClick, onCountryHover) {
  clickHandler = onCountryClick;
  hoverHandler = onCountryHover;

  map = L.map('map', {
    center: [20, 0],
    zoom: 2,
    minZoom: 2,
    maxZoom: 7,
    zoomControl: false,
    worldCopyJump: true,
    attributionControl: true,
  });

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd',
    maxZoom: 20,
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  }).addTo(map);

  const data = await loadGeoJson();
  geoLayer = L.geoJSON(data, {
    style: (feature) => countryStyle(feature),
    onEachFeature: (feature, layer) => {
      layer.on({
        mouseover: () => onHover(feature, layer),
        mouseout: () => onOut(feature, layer),
        click: () => onClick(feature, layer),
      });
    },
  }).addTo(map);

  requestAnimationFrame(() => map.invalidateSize());
  return map;
}

export function invalidateMap() {
  map?.invalidateSize({ animate: false });
}

export function updateScores(entries) {
  scoreMap = new Map(entries.map((entry) => [entry.iso3, entry.score]));
  if (geoLayer) geoLayer.setStyle((feature) => countryStyle(feature));
  if (selectedLayer && selectedIso3) selectedLayer.setStyle(selectedStyle(selectedLayer.feature));
}

export function focusCountry(iso3) {
  if (!geoLayer) return false;
  let found = false;

  geoLayer.eachLayer((layer) => {
    if (countryCode(layer.feature) === iso3) {
      found = true;
      selectLayer(layer);
      const bounds = layer.getBounds?.();
      if (bounds?.isValid()) map.fitBounds(bounds.pad(0.72), { maxZoom: 5, animate: true, duration: .55 });
    }
  });

  return found;
}

export function resetView() {
  map?.setView([20, 0], 2);
}

export function countryCode(feature) {
  const p = feature?.properties || {};
  const candidates = [
    p.ISO_A3, p.iso_a3, p.ADM0_A3, p.SOV_A3, p['ISO3166-1-Alpha-3'], p.ISO3,
  ];
  const code = candidates.find((value) => typeof value === 'string' && /^[A-Z]{3}$/.test(value));
  return code || null;
}

function countryName(feature) {
  const p = feature?.properties || {};
  return p.ADMIN || p.admin || p.name || p.NAME || p.name_long || 'Country';
}

function countryStyle(feature) {
  const iso3 = countryCode(feature);
  const score = iso3 ? scoreMap.get(iso3) : undefined;

  return {
    color: 'rgba(205, 218, 242, 0.35)',
    weight: 0.55,
    opacity: 1,
    fillColor: score == null ? '#252d3b' : colorForScore(score),
    fillOpacity: score == null ? 0.50 : 0.80,
  };
}

function selectedStyle(feature) {
  return {
    ...countryStyle(feature),
    color: '#eef4ff',
    weight: 1.8,
    fillOpacity: 0.95,
  };
}

function colorForScore(score) {
  const normalized = Math.max(0, Math.min(100, Number(score) || 0));
  const index = Math.min(palette.length - 1, Math.floor((normalized / 100) * palette.length));
  return palette[index];
}

function onHover(feature, layer) {
  if (layer !== selectedLayer) {
    layer.setStyle({ weight: 1.4, color: 'rgba(240,245,255,.85)', fillOpacity: 0.92 });
    layer.bringToFront?.();
  }

  const iso3 = countryCode(feature);
  hoverHandler({ iso3, name: countryName(feature), score: iso3 ? scoreMap.get(iso3) : null });
}

function onOut(feature, layer) {
  if (layer !== selectedLayer) layer.setStyle(countryStyle(feature));
}

function onClick(feature, layer) {
  const iso3 = countryCode(feature);
  if (!iso3) return;
  selectLayer(layer);
  clickHandler({ iso3, name: countryName(feature), score: scoreMap.get(iso3) });
}

function selectLayer(layer) {
  if (selectedLayer && selectedLayer !== layer) selectedLayer.setStyle(countryStyle(selectedLayer.feature));
  selectedLayer = layer;
  selectedIso3 = countryCode(layer.feature);
  layer.setStyle(selectedStyle(layer.feature));
  layer.bringToFront?.();
}

async function loadGeoJson() {
  let lastError;
  for (const url of GEOJSON_URLS) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Unable to load country boundaries');
}
