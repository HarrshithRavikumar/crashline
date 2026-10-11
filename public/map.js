import { $, toast } from './util.js';

const MODE_LABELS = { all: 'All', car: 'Cars', bike: 'Bikes', scooter: 'Scooters', wheelchair: 'Wheelchairs', walk: 'Walking' };
const KIND_LABELS = { crash: 'crashes', near_miss: 'near misses', close_call: 'close calls' };
const KIND_ONE = { crash: 'crash', near_miss: 'near miss', close_call: 'close call' };
const WHO = { car: 'a driver', bike: 'a cyclist', scooter: 'a scooter rider', wheelchair: 'a wheelchair user', walk: 'a pedestrian' };
const count = (n, kind) => `${n} ${n === 1 ? KIND_ONE[kind] : KIND_LABELS[kind]}`;
const state = { mode: 'all', sample: true, firstFit: true, lastLiveAt: 0 };
const names = new Map(); // cell id → reverse-geocoded name

const css = getComputedStyle(document.documentElement);
const color = (v) => css.getPropertyValue(v).trim();

const map = L.map('map', { zoomControl: true }).setView([33.7756, -84.39], 14);
// Keyless street tiles: OpenStreetMap, darkened with a CSS filter to match the app.
// If OSM tiles fail to load, switch to Esri's dark gray canvas instead.
const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  className: 'dark-tiles',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);
let tileErrors = 0;
osm.on('tileerror', () => {
  if (++tileErrors !== 4) return;
  map.removeLayer(osm);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 16,
    attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
  }).addTo(map);
});
const layer = L.layerGroup().addTo(map);
const markers = new Map();

function renderFilters() {
  const box = $('#modeFilters');
  box.innerHTML = '';
  Object.entries(MODE_LABELS).forEach(([key, label]) => {
    const b = document.createElement('button');
    b.className = `chip${state.mode === key ? ' selected' : ''}`;
    b.textContent = label;
    b.onclick = () => { state.mode = key; renderFilters(); load(); };
    box.appendChild(b);
  });
}

$('#sampleToggle').onchange = (e) => { state.sample = e.target.checked; load(); };

function cellName(c) {
  return c.label || names.get(c.id) || `Near ${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`;
}

function breakdown(c) {
  const kinds = Object.entries(c.kinds).filter(([, n]) => n).map(([k, n]) => count(n, k)).join(' · ');
  const modes = Object.entries(c.modes).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${MODE_LABELS[m].toLowerCase()} ${n}`).join(', ');
  return { kinds, modes };
}

function popupHtml(c) {
  const { kinds, modes } = breakdown(c);
  const esc = (s) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  return `<b>${esc(cellName(c))}</b><br>${kinds}<br><span style="color:${color('--muted')}">Who: ${modes}${c.live ? ` · ${c.live} live` : ''}</span>`;
}

async function nameTopSpots(cells) {
  // Name unlabeled top spots with OpenStreetMap's reverse geocoder (lightly, one at a time).
  for (const c of cells.slice(0, 6)) {
    if (c.label || names.has(c.id)) continue;
    names.set(c.id, null);
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&lat=${c.lat}&lon=${c.lng}&accept-language=en`);
      const j = await r.json();
      const road = j.address?.road || j.address?.pedestrian || j.address?.footway;
      if (road) names.set(c.id, `Near ${road}`);
      else names.delete(c.id);
    } catch { names.delete(c.id); }
    await new Promise((res) => setTimeout(res, 1100));
  }
  renderList(cells);
}

function renderList(cells) {
  const list = $('#hotList');
  list.innerHTML = '';
  const top = cells.slice(0, 6);
  const max = top[0]?.score || 1;
  top.forEach((c) => {
    const { kinds } = breakdown(c);
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = cellName(c);
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.innerHTML = `<span style="width:${Math.max(6, (c.score / max) * 100)}%"></span>`;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = kinds;
    li.append(name, bar, meta);
    li.onclick = () => { map.setView([c.lat, c.lng], 17); markers.get(c.id)?.openPopup(); };
    list.appendChild(li);
  });
  if (!top.length) list.innerHTML = '<li class="meta">No reports yet for this filter.</li>';
}

function render(data) {
  layer.clearLayers();
  markers.clear();
  for (const c of data.cells) {
    const hot = c.kinds.crash > 0;
    const circle = L.circle([c.lat, c.lng], {
      radius: 25 + Math.sqrt(c.score) * 14,
      color: hot ? color('--danger') : color('--warn'),
      weight: 1.5,
      fillOpacity: Math.min(0.55, 0.15 + c.score / 80),
    }).bindPopup(popupHtml(c));
    circle.addTo(layer);
    markers.set(c.id, circle);
  }

  const s = data.stats;
  $('#sTotal').textContent = s.total.toLocaleString();
  $('#sCrash').textContent = s.crash.toLocaleString();
  $('#sNear').textContent = (s.near_miss + s.close_call).toLocaleString();
  $('#sLive').textContent = s.live.toLocaleString();
  $('#sampleBadge').hidden = !data.sampleIncluded;

  renderList(data.cells);
  nameTopSpots(data.cells);

  if (state.firstFit && data.cells.length) {
    state.firstFit = false;
    map.fitBounds(L.latLngBounds(data.cells.slice(0, 40).map((c) => [c.lat, c.lng])).pad(0.15));
  }

  // A new live report arrived: pulse it and say so.
  const latest = data.latest;
  if (latest && latest.receivedAt > state.lastLiveAt) {
    const isNew = state.lastLiveAt !== 0;
    state.lastLiveAt = latest.receivedAt;
    if (isNew) {
      const ring = L.circleMarker([latest.lat, latest.lng], { radius: 12, color: color('--accent'), weight: 2, fillOpacity: 0.6, className: 'live-pulse' }).addTo(map);
      setTimeout(() => ring.remove(), 6000);
      map.panTo([latest.lat, latest.lng]);
      toast(`New ${KIND_ONE[latest.kind]} reported just now by ${WHO[latest.mode]}`);
    }
  }
}

async function load() {
  try {
    const r = await fetch(`/api/hotspots?mode=${state.mode}&sample=${state.sample ? 1 : 0}`);
    const data = await r.json();
    // Only redraw when something changed, so open popups stay open.
    const sig = `${state.mode}|${state.sample}|${data.stats.total}|${data.latest?.receivedAt || 0}`;
    if (sig === state.sig) return;
    state.sig = sig;
    render(data);
  } catch {
    toast('Couldn’t load map data. Retrying…');
  }
}

renderFilters();
load();
setInterval(load, 4000);
