// Wide-screen extras: live mini map and live report feed next to the trip panel.
import { $ } from './util.js';

const WHO = { car: 'driver', bike: 'cyclist', scooter: 'scooter rider', wheelchair: 'wheelchair user', walk: 'pedestrian' };
const KIND = { crash: 'Crash', near_miss: 'Near miss', close_call: 'Close call' };
let map = null, layer = null, lastLive = 0, firstFit = true, sig = '';

function ago(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function initMap() {
  if (map || typeof L === 'undefined' || !$('#miniMap')) return;
  map = L.map('miniMap', { zoomControl: false, attributionControl: true }).setView([33.7756, -84.39], 13);
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, className: 'dark-tiles', attribution: '&copy; OpenStreetMap',
  }).addTo(map);
  let errs = 0;
  osm.on('tileerror', () => {
    if (++errs !== 4) return;
    map.removeLayer(osm);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, attribution: '&copy; Esri' }).addTo(map);
  });
  layer = L.layerGroup().addTo(map);
}

async function refreshMap() {
  if (!map) return;
  try {
    const d = await (await fetch('/api/hotspots')).json();
    const css = getComputedStyle(document.documentElement);
    const next = `${d.stats.total}|${d.latest?.receivedAt || 0}`;
    if (next !== sig) {
      sig = next;
      layer.clearLayers();
      for (const c of d.cells) {
        L.circle([c.lat, c.lng], {
          radius: 25 + Math.sqrt(c.score) * 12,
          color: c.kinds.crash ? css.getPropertyValue('--danger').trim() : css.getPropertyValue('--warn').trim(),
          weight: 1.2, fillOpacity: Math.min(0.5, 0.12 + c.score / 80),
        }).addTo(layer);
      }
      if (firstFit && d.cells.length) {
        firstFit = false;
        map.fitBounds(L.latLngBounds(d.cells.slice(0, 40).map((c) => [c.lat, c.lng])).pad(0.1));
      }
    }
    const latest = d.latest;
    if (latest && latest.receivedAt > lastLive) {
      const isNew = lastLive !== 0;
      lastLive = latest.receivedAt;
      if (isNew) {
        const ring = L.circleMarker([latest.lat, latest.lng], { radius: 11, color: css.getPropertyValue('--accent').trim(), weight: 2, fillOpacity: 0.6, className: 'live-pulse' }).addTo(map);
        setTimeout(() => ring.remove(), 6000);
        map.panTo([latest.lat, latest.lng]);
      }
    }
  } catch { /* offline */ }
}

async function refreshFeed() {
  const list = $('#feedList');
  try {
    const { items } = await (await fetch('/api/recent')).json();
    list.innerHTML = '';
    const liveCount = items.filter((i) => !i.sample).length;
    $('#feedNote').textContent = liveCount ? `${liveCount} live` : 'sample data';
    items.slice(0, 9).forEach((it) => {
      const li = document.createElement('li');
      li.innerHTML = '<span class="dot"></span><div class="grow"><b></b><p class="muted small"></p></div><span class="muted small when"></span>';
      li.querySelector('.dot').dataset.kind = it.kind;
      li.querySelector('b').textContent = `${KIND[it.kind]} · ${WHO[it.mode]}`;
      li.querySelector('p').textContent = it.place || `${it.lat.toFixed(4)}, ${it.lng.toFixed(4)}`;
      li.querySelector('.when').textContent = it.at ? ago(it.at) : 'sample';
      if (it.at && Date.now() - it.at < 15000) li.classList.add('fresh');
      list.appendChild(li);
    });
  } catch { /* offline */ }
}

export function initDesktop() {
  const mq = window.matchMedia('(min-width: 1100px)');
  let timer = null;
  const tick = () => { refreshMap(); refreshFeed(); };
  const apply = () => {
    if (mq.matches) {
      initMap();
      setTimeout(() => map?.invalidateSize(), 50);
      tick();
      clearInterval(timer);
      timer = setInterval(tick, 4000);
    } else {
      clearInterval(timer);
    }
  };
  mq.addEventListener?.('change', apply);
  window.addEventListener('screenchange', (e) => { if (e.detail.id === 'home' && mq.matches) setTimeout(() => { map?.invalidateSize(); tick(); }, 50); });
  apply();
  return { refresh: tick };
}
