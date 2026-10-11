import { $, store, toast, postJSON } from './util.js';

const q = new URLSearchParams(location.search);
const id = q.get('i') || '';
const view = q.get('v') || '';
const STATUS = { seen: 'has seen this', on_way: 'is on the way', called_911: 'called 911', reached: 'reached them' };
let map = null, marker = null, ring = null, trail = null, lastSig = '';

function ago(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}
const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// Name from an accepted invite on this phone, if any.
function savedName() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith('crashline.joined.')) { const v = JSON.parse(localStorage.getItem(k)); if (v?.name) return v.name; }
    }
  } catch { /* ignore */ }
  return store.get('crashline.ackName', '');
}

function initMap() {
  if (map || typeof L === 'undefined') return;
  map = L.map('alertMap', { zoomControl: true }).setView([33.7756, -84.39], 15);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, className: 'dark-tiles', attribution: '&copy; OpenStreetMap' }).addTo(map);
}

function render(inc) {
  const safe = inc.status === 'safe';
  document.title = safe ? `${inc.name} is safe · Crashline` : `${inc.name} may have crashed · Crashline`;
  $('#hero').classList.toggle('safe', safe);
  $('#heroEyebrow').textContent = safe ? 'Update' : 'Crash alert';
  $('#heroTitle').textContent = safe ? `${inc.name} marked themselves safe` : `${inc.name} may have been in a crash`;
  $('#heroSub').textContent = safe
    ? `At ${time(inc.safeAt)}. The crash was detected at ${time(inc.crashedAt)} while ${inc.doing || 'traveling'}.`
    : `Detected ${ago(inc.crashedAt)} (${time(inc.crashedAt)}) while ${inc.doing || 'traveling'}. They didn’t cancel the alarm.`;
  $('#liveTag').textContent = safe ? 'Safe' : 'Live';
  $('#liveTag').classList.toggle('ok-pill', safe);

  if (inc.phone) {
    $('#callBtn').hidden = false;
    $('#callBtn').href = `tel:${inc.phone}`;
    $('#callBtn').textContent = `Call ${inc.name.split(' ')[0]}`;
  }

  const p = inc.position;
  if (p) {
    initMap();
    const ll = [p.lat, p.lng];
    if (!marker) {
      marker = L.circleMarker(ll, { radius: 9, color: '#fff', weight: 2, fillColor: safe ? '#3ddc84' : '#ff4d5e', fillOpacity: 1 }).addTo(map);
      ring = L.circle(ll, { radius: p.acc || 30, color: '#ff4d5e', weight: 1, fillOpacity: 0.12 }).addTo(map);
      map.setView(ll, 16);
    } else {
      marker.setLatLng(ll); ring.setLatLng(ll).setRadius(p.acc || 30);
    }
    marker.setStyle({ fillColor: safe ? '#3ddc84' : '#ff4d5e' });
    if (inc.track?.length > 1) {
      const pts = inc.track.map((t) => [t.lat, t.lng]);
      if (trail) trail.setLatLngs(pts); else trail = L.polyline(pts, { color: '#4cc9f0', weight: 3, opacity: 0.7 }).addTo(map);
    }
    $('#locAge').textContent = `Updated ${ago(p.at)}${p.acc ? ` · within ${Math.round(p.acc)} m` : ''}`;
    $('#mapsLink').href = `https://maps.google.com/?q=${p.lat},${p.lng}`;
    $('#dirLink').href = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
  } else {
    $('#locAge').textContent = 'Location not available yet';
  }

  const rows = [
    ['Near', inc.place],
    ['Traveling', inc.doing],
    ['What was detected', inc.detection],
    ['Vehicle', inc.vehicle],
    ['Medical notes', inc.medical],
    ['Language', inc.language && inc.language !== 'English' ? `${inc.language}. They may need an interpreter.` : null],
    ['Phone', inc.phone],
  ].filter(([, v]) => v);
  const dl = $('#details');
  dl.innerHTML = '';
  rows.forEach(([k, v]) => {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    dl.append(dt, dd);
  });

  const ul = $('#ackList');
  ul.innerHTML = '';
  inc.acks.forEach((a) => {
    const li = document.createElement('li');
    li.textContent = `${a.name} ${STATUS[a.status] || 'responded'} · ${ago(a.at)}`;
    ul.appendChild(li);
  });
}

async function load() {
  try {
    const r = await fetch(`/api/incidents/${encodeURIComponent(id)}?v=${encodeURIComponent(view)}`);
    if (!r.ok) throw new Error(String(r.status));
    const inc = await r.json();
    const sig = JSON.stringify([inc.status, inc.position, inc.acks]);
    if (sig !== lastSig) { lastSig = sig; render(inc); }
    else if (inc.position) $('#locAge').textContent = `Updated ${ago(inc.position.at)}${inc.position.acc ? ` · within ${Math.round(inc.position.acc)} m` : ''}`;
  } catch (e) {
    if (!lastSig) {
      $('#heroTitle').textContent = e.message === '404' ? 'This alert link has expired or isn’t valid' : 'Couldn’t load the alert. Retrying…';
    }
  }
}

document.querySelectorAll('.ack-btns [data-s]').forEach((b) => {
  b.onclick = async () => {
    const name = $('#ackName').value.trim();
    if (!name) { $('#ackMsg').textContent = 'Add your name so they know who’s coming.'; $('#ackName').focus(); return; }
    store.set('crashline.ackName', name);
    try {
      await postJSON(`/api/incidents/${encodeURIComponent(id)}/ack?v=${encodeURIComponent(view)}`, { name, status: b.dataset.s });
      $('#ackMsg').textContent = 'Sent. They’ll see it on their phone.';
      lastSig = '';
      load();
    } catch {
      toast('Couldn’t send. Check your connection.');
    }
  };
});

$('#ackName').value = savedName();
// "I'm on my way" tapped right on the notification.
if (q.get('ack') === 'on_way') {
  history.replaceState({}, '', `${location.pathname}?i=${encodeURIComponent(id)}&v=${encodeURIComponent(view)}`);
  if ($('#ackName').value) document.querySelector('.ack-btns [data-s=on_way]').click();
  else { $('#ackMsg').textContent = 'Add your name, then tap “I’m on my way”.'; $('#ackName').focus(); }
}
load();
setInterval(load, 5000);
