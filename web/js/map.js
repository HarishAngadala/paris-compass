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

const palette = ['#8e3b46', '#c9684e', '#e4ad5a', '#d6cf79', '#92bf78', '#409a72', '#166f5b'];

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
  });

  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
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
  return map;
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
      if (bounds?.isValid()) map.fitBounds(bounds.pad(0.75), { maxZoom: 5, animate: true });
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
  const code = candidates.find((v) => typeof v === 'string' && /^[A-Z]{3}$/.test(v));
  return code || null;
}

function countryName(feature) {
  const p = feature?.properties || {};
  return p.ADMIN || p.name || p.NAME || p['name_long'] || 'Country';
}

function countryStyle(feature) {
  const iso3 = countryCode(feature);
  const score = iso3 ? scoreMap.get(iso3) : undefined;
  return {
    color: '#ffffff',
    weight: 0.7,
    opacity: 0.82,
    fillColor: score == null ? '#b8c0bd' : colorForScore(score),
    fillOpacity: score == null ? 0.42 : 0.82,
  };
}

function selectedStyle(feature) {
  return {
    ...countryStyle(feature),
    color: '#142d2a',
    weight: 2.3,
    fillOpacity: 0.95,
  };
}

function colorForScore(score) {
  const index = Math.min(palette.length - 1, Math.max(0, Math.floor((score / 100) * palette.length)));
  return palette[index];
}

function onHover(feature, layer) {
  if (layer !== selectedLayer) layer.setStyle({ weight: 1.6, color: '#253c39', fillOpacity: 0.9 });
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
