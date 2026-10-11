import { $, store, show, currentScreen, toast, postJSON, speak } from './util.js';
import { CrashDetector, MODE_THRESHOLDS } from './detector.js';
import { MODES, isVulnerable, triageFor, offlineSteps } from './guidance.js';
import { LANGUAGES, getLang } from './i18n.js';
import { initTalk, openTalk } from './talk.js';
import { initInstall } from './install.js';
import { BlackBox, saveIncident, listIncidents, deleteIncident } from './blackbox.js';
import { renderRecord, releaseUrls } from './bbview.js';
import { AutoStart, readStartParam } from './autostart.js';
import { initSettings, renderSettings, renderQr, renderAccount, renderIncidents, describeDelivery, renderPeople } from './settings.js';
import { loadPeople, respondRequest, enableAlertsOnThisPhone, thisPhoneHasAlerts } from './people.js';
import { initAuth, authUser, authError, pullCloud, pushCloud, deleteCloud, signOut } from './auth.js';
import { renderAuthPanel } from './authpanel.js';
import { ensureChannel as ensureAlertChannel } from './invites.js';
import { pickerSupported, pickContacts, readVcardFiles } from './contacts.js';
import { initDesktop } from './desktop.js';

let profile = store.get('crashline.profile', null);
const settings = {
  demo: true, mic: false, share: true, mode: 'car', sensitivity: 'normal',
  autoText: true, autoStart: false, dashcam: false, dashAudio: false,
  ...store.get('crashline.settings', {}),
};
const saveSettings = () => store.set('crashline.settings', settings);
const queue = store.get('crashline.queue', []);
let serverInfo = { ai: false, sms: false, auth: null };

const blackbox = new BlackBox();
let detector = null;
let autostart = null;
let desktop = null;
let incident = null;
let lastPosition = null;
let countdownTimer = null;
let alarmTimer = null;
let audioCtx = null;
let wakeLock = null;
let peakG = 0;
let nearCount = 0;
let trip = null; // { startedAt, dist, max, last }
let returnTo = 'home';
const samples = [];

// ---------- sound, vibration, screen ----------
function unlockAudio() {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume();
  } catch { /* no audio */ }
}

function beep(freq = 880, dur = 0.18) {
  if (!audioCtx) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = 'square';
  o.frequency.value = freq;
  g.gain.value = 0.12;
  o.connect(g).connect(audioCtx.destination);
  o.start();
  o.stop(audioCtx.currentTime + dur);
}

function startAlarm() {
  stopAlarm();
  beep();
  alarmTimer = setInterval(() => { beep(); navigator.vibrate?.(300); }, 1000);
}
function stopAlarm() {
  clearInterval(alarmTimer);
  alarmTimer = null;
  navigator.vibrate?.(0);
}

async function requestWakeLock() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* unsupported */ }
}

const myLang = () => getLang(profile?.language);

// ---------- account sync ----------
let lastSync = 0;
let syncError = null;
const syncable = () => ({ autoText: settings.autoText, share: settings.share });

async function syncNow(manual = false) {
  if (!authUser()) return;
  try {
    const cloud = await pullCloud();
    const localAt = profile?.updatedAt || 0;
    const cloudAt = cloud?.updatedAt || 0;
    if (cloud?.profile && cloudAt > localAt) {
      profile = cloud.profile;
      store.set('crashline.profile', profile);
      if (cloud.settings) { Object.assign(settings, cloud.settings); saveSettings(); }
      renderHome();
      if (currentScreen() === 'setup') show('home');
    } else if (profile && localAt > cloudAt) {
      await pushCloud({ profile, settings: syncable(), updatedAt: localAt });
    }
    lastSync = Date.now();
    syncError = null;
    if (manual) toast('Synced');
  } catch (e) {
    syncError = e.message;
    if (manual) toast('Couldn’t sync right now');
  }
}
const syncStatus = () => (lastSync
  ? `Profile backed up · last synced ${new Date(lastSync).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
  : syncError ? 'Couldn’t sync yet. Try “Sync now”.' : 'Syncing…');

function renderAvatar() {
  const u = authUser();
  const img = $('#avatarImg');
  if (u?.picture) { img.src = u.picture; img.referrerPolicy = 'no-referrer'; img.hidden = false; $('#gearIcon').style.display = 'none'; }
  else { img.hidden = true; $('#gearIcon').style.display = ''; }
}

// ---------- setup ----------
function normalizePhone(p) {
  const s = String(p).trim();
  const digits = s.replace(/\D/g, '');
  if (s.startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits ? `+${digits}` : '';
}

function addContactRow(c = {}) {
  const row = document.createElement('div');
  row.className = 'contact-row';
  row.innerHTML = '<input class="c-name" placeholder="Name" autocomplete="off" aria-label="Contact name"><input class="c-phone" type="tel" placeholder="Phone" autocomplete="off" aria-label="Contact phone"><button type="button" class="icon" aria-label="Remove contact">×</button><input class="c-email" type="email" placeholder="Email (optional)" autocomplete="off" aria-label="Contact email">';
  row.querySelector('.c-name').value = c.name || '';
  row.querySelector('.c-phone').value = c.phone || '';
  row.querySelector('.c-email').value = c.email || '';
  row.querySelector('button').onclick = () => row.remove();
  $('#contactsList').appendChild(row);
}

// Fill the blank row first, skip numbers that are already listed.
function addContacts(list) {
  const rows = () => [...document.querySelectorAll('.contact-row')];
  const have = new Set(rows().map((r) => normalizePhone(r.querySelector('.c-phone').value)).filter(Boolean));
  let added = 0;
  for (const c of list) {
    const phone = normalizePhone(c.phone || '');
    if (phone && have.has(phone)) continue;
    const blank = rows().find((r) => !r.querySelector('.c-name').value && !r.querySelector('.c-phone').value && !r.querySelector('.c-email').value);
    if (blank) {
      blank.querySelector('.c-name').value = c.name || '';
      blank.querySelector('.c-phone').value = c.phone || '';
      blank.querySelector('.c-email').value = c.email || '';
    } else {
      addContactRow(c);
    }
    if (phone) have.add(phone);
    added++;
  }
  toast(added ? `Added ${added} contact${added > 1 ? 's' : ''}` : 'Those contacts are already on your list');
}

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(navigator.userAgent);
const contactsHelp = () => (isIOS
  ? 'iPhone keeps contacts locked for websites unless you switch it on once: Settings → Apps → Safari → Advanced → Feature Flags → turn on “Contact Picker API”, then reload Crashline. Or use Import contact card (Contacts → Share Contact → Save to Files).'
  : isAndroid
    ? 'Your browser can’t open contacts. Open Crashline in Chrome to pick contacts, or use Import contact card.'
    : 'Computers don’t have a contact list to share. Use Import contact card with a .vcf file, or type contacts in.');
$('#contactsHint').textContent = '';
$('#pickContactsBtn').onclick = async () => {
  if (!pickerSupported()) { $('#contactsHint').textContent = contactsHelp(); return; }
  try { addContacts(await pickContacts()); } catch (e) { if (e?.name !== 'AbortError' && e?.name !== 'InvalidStateError') toast('Couldn’t open your contacts.'); }
};
$('#vcfBtn').onclick = () => $('#vcfInput').click();
$('#vcfInput').onchange = async (e) => {
  const files = e.target.files;
  if (!files?.length) return;
  try {
    const list = await readVcardFiles(files);
    if (!list.length) toast('No phone numbers or emails found in that file.'); else addContacts(list);
  } catch { toast('Couldn’t read that file.'); }
  e.target.value = '';
};

$('#langSelect').innerHTML = LANGUAGES.map((l) => `<option value="${l.key}">${l.name}${l.key !== 'en' ? ` · ${l.english}` : ''}</option>`).join('');

function openSetup() {
  const f = $('#setupForm');
  const u = authUser();
  f.name.value = profile?.name || u?.name || '';
  f.phone.value = profile?.phone || '';
  f.language.value = profile?.language || 'en';
  f.medical.value = profile?.medical || '';
  f.vehicle.value = profile?.vehicle || '';
  f.autoText.checked = settings.autoText !== false;
  $('#contactsList').innerHTML = '';
  (profile?.contacts?.length ? profile.contacts : [{}]).forEach(addContactRow);
  renderSetupAccount();
  show('setup');
}

function renderSetupAccount() {
  const u = authUser();
  if (u) {
    $('#setupAccTitle').textContent = `Signed in as ${u.name || u.email}`;
    $('#setupAccLead').textContent = 'Your profile backs up to your account when you save.';
    $('#setupAccToggle').hidden = true;
    $('#setupAuthPanel').hidden = true;
  } else {
    $('#setupAccTitle').textContent = 'Back up your profile';
    $('#setupAccLead').textContent = 'Create an account or sign in to keep your contacts on every device.';
    $('#setupAccToggle').hidden = false;
    if (authError()) { $('#setupAuthPanel').hidden = false; renderAuthPanel($('#setupAuthPanel'), { onSignedIn }); }
  }
}
$('#setupAccToggle').onclick = () => {
  const panel = $('#setupAuthPanel');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) renderAuthPanel(panel, { onSignedIn, startWith: profile ? 'login' : 'signup' });
};

async function onSignedIn(u, mode) {
  renderAvatar();
  toast(mode === 'signup' ? `Account created. Welcome, ${u.name || u.email}!` : `Signed in as ${u.name || u.email}`);
  await syncNow();
  if (currentScreen() === 'setup') {
    if (profile) { renderHome(); show('home'); } else { renderSetupAccount(); const f = $('#setupForm'); if (!f.name.value) f.name.value = u.name || ''; }
  } else {
    renderAccount();
    renderPeople();
  }
  renderHome();
  refreshRequests();
}
$('#addContact').onclick = () => addContactRow();
$('#setupForm').onsubmit = (e) => {
  e.preventDefault();
  const f = e.target;
  const contacts = [...document.querySelectorAll('.contact-row')]
    .map((r) => ({ name: r.querySelector('.c-name').value.trim(), phone: normalizePhone(r.querySelector('.c-phone').value), email: r.querySelector('.c-email').value.trim() }))
    .filter((c) => c.phone.length >= 8 || /@/.test(c.email));
  if (!contacts.length) { toast('Add at least one contact with a phone number or email.'); return; }
  profile = {
    name: f.name.value.trim(), phone: normalizePhone(f.phone.value), language: f.language.value, medical: f.medical.value.trim(),
    vehicle: f.vehicle.value.trim(), contacts, updatedAt: Date.now(),
    channel: profile?.channel,
  };
  settings.autoText = f.autoText.checked;
  saveSettings();
  store.set('crashline.profile', profile);
  toast(authUser() ? 'Profile saved and backed up' : 'Profile saved');
  if (authUser()) pushCloud({ profile, settings: syncable(), updatedAt: profile.updatedAt }).then(() => { lastSync = Date.now(); }).catch(() => {});
  renderHome();
  show('home');
  ensureChannel().then(refreshAlertsStatus);
};
$('#editProfileBtn').onclick = () => { if (detector?.running) stopTrip(); openSetup(); };

// ---------- home ----------
function renderModes() {
  const box = $('#modeChips');
  box.innerHTML = '';
  Object.entries(MODES).forEach(([key, m]) => {
    const b = document.createElement('button');
    b.className = 'mode-chip';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(settings.mode === key));
    b.innerHTML = `${MODE_ICONS[key]}<span>${m.label}</span>`;
    b.onclick = () => setMode(key);
    box.appendChild(b);
  });
}

function setMode(key) {
  settings.mode = key;
  saveSettings();
  detector?.setMode(key);
  renderModes();
  renderHome();
  drawChart();
}

function renderHome() {
  const L = myLang();
  $('#talkLangName').textContent = L.key === 'en' ? 'any of 10 languages' : `${L.name} (${L.english})`;
  $('#closeCallBtn').hidden = !isVulnerable(settings.mode) && !settings.demo;
  $('#closeCallBtn').textContent = isVulnerable(settings.mode) ? 'Log a close call (a car passed too close)' : 'Log a close call';
  $('#nearCount').textContent = nearCount;
  $('#autoPill').hidden = !settings.autoStart;
  const bits = [];
  if (authUser()) bits.push('Signed in');
  if (settings.dashcam) bits.push('dashcam on');
  if (settings.autoStart) bits.push('auto-start on');
  $('#settingsSummary').textContent = bits.length ? `${bits.join(' · ')}. Phone and car setup.` : 'Google sign-in, black box, auto-start, your phone, your car.';
  setTripLabel(!!detector?.running);
}

function setTripLabel(on) {
  const m = MODES[settings.mode];
  $('#modeLabel').classList.toggle('on', on);
  $('#modeText').textContent = on ? `Monitoring · ${m.doing}${settings.demo ? ' · demo' : ''}` : `Ready · ${m.doing}`;
  $('#driveBtn').textContent = on ? 'End trip' : 'Start trip';
  $('#driveBtn').classList.toggle('primary', !on);
  $('#driveBtn').classList.toggle('ghost', on);
}

// ---------- chart ----------
const chart = $('#gChart');
const cctx = chart.getContext('2d');
let chartQueued = false;

function sizeChart() {
  const dpr = window.devicePixelRatio || 1;
  if (!chart.clientWidth) return;
  chart.width = Math.round(chart.clientWidth * dpr);
  chart.height = Math.round(chart.clientHeight * dpr);
  drawChart();
}

function thresholds() {
  return detector?.cfg ?? (settings.demo ? { impactG: 2.5, nearG: 1.0 } : MODE_THRESHOLDS[settings.mode]);
}

function drawChart() {
  chartQueued = false;
  const W = chart.width, H = chart.height;
  if (!W) return;
  const css = getComputedStyle(document.documentElement);
  const dpr = window.devicePixelRatio || 1;
  const { impactG, nearG } = thresholds();
  const maxG = Math.max(impactG * 1.5, ...samples.map((s) => s.g));
  const y = (g) => H - (g / maxG) * (H - 8) - 4;
  cctx.clearRect(0, 0, W, H);

  const line = (g, color, label) => {
    cctx.strokeStyle = color;
    cctx.fillStyle = color;
    cctx.globalAlpha = 0.6;
    cctx.setLineDash([6 * dpr, 6 * dpr]);
    cctx.lineWidth = 1.5 * dpr;
    cctx.beginPath(); cctx.moveTo(0, y(g)); cctx.lineTo(W, y(g)); cctx.stroke();
    cctx.setLineDash([]);
    cctx.font = `${11 * dpr}px system-ui`;
    cctx.fillText(label, 6 * dpr, y(g) - 4 * dpr);
    cctx.globalAlpha = 1;
  };
  line(impactG, css.getPropertyValue('--danger').trim(), 'crash');
  line(nearG, css.getPropertyValue('--warn').trim(), 'near miss');

  if (samples.length < 2) return;
  const now = performance.now();
  cctx.strokeStyle = css.getPropertyValue('--accent').trim();
  cctx.lineWidth = 2 * dpr;
  cctx.lineJoin = 'round';
  cctx.beginPath();
  samples.forEach((s, i) => {
    const x = W - ((now - s.t) / 6000) * W;
    i ? cctx.lineTo(x, y(s.g)) : cctx.moveTo(x, y(s.g));
  });
  cctx.stroke();
}

function onSample(g) {
  const t = performance.now();
  samples.push({ t, g });
  while (samples.length && t - samples[0].t > 6500) samples.shift();
  peakG = Math.max(peakG, g);
  blackbox.addSample(g);
  $('#gNow').textContent = g.toFixed(2);
  $('#gPeak').textContent = peakG.toFixed(2);
  if (!chartQueued) { chartQueued = true; requestAnimationFrame(drawChart); }
}

// ---------- trips ----------
function haversine(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function onPosition(p) {
  lastPosition = p;
  blackbox.addPosition(p, p.speed);
  if (trip && p.acc < 50) {
    if (trip.last) trip.dist += haversine(trip.last, p);
    trip.last = p;
  }
}

function onSpeed(v) {
  $('#speedNow').textContent = Math.round(v * 2.237);
  if (trip) trip.max = Math.max(trip.max, v);
}

let tripTimer = null;
function renderTripStats() {
  if (!trip) return;
  const s = Math.floor((Date.now() - trip.startedAt) / 1000);
  $('#tripTime').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  $('#tripDist').textContent = (trip.dist / 1609.34).toFixed(1);
  $('#tripMax').textContent = trip.max ? Math.round(trip.max * 2.237) : '–';
}

function makeDetector() {
  return new CrashDetector({
    mode: settings.mode,
    demo: settings.demo,
    sensitivity: settings.sensitivity,
    onIgnored: () => toast('That looked like a dropped phone, so no alarm'),
    useMic: settings.mic,
    onSample,
    onCrash: triggerCrash,
    onNearMiss,
    onPosition,
    onSpeed,
    onNote: (msg) => { $('#sensorNote').textContent = msg; },
  });
}

async function startTrip({ mode, source = 'manual' } = {}) {
  if (detector) return;
  if (mode && mode !== settings.mode) setMode(mode);
  unlockAudio();
  detector = makeDetector();
  try {
    const { notes } = await detector.start();
    $('#sensorNote').textContent = notes.join(' ');
    trip = { startedAt: Date.now(), dist: 0, max: 0, last: null, source };
    clearInterval(tripTimer);
    tripTimer = setInterval(renderTripStats, 1000);
    renderTripStats();
    setTripLabel(true);
    requestWakeLock();
    startDashcam();
    if (source !== 'manual') toast(`Trip started automatically · ${MODES[settings.mode].doing}. Tap a mode to correct it.`);
  } catch (e) {
    detector.stop();
    detector = null;
    toast(e.message);
  }
}

function stopTrip({ quiet = false } = {}) {
  detector?.stop();
  detector = null;
  blackbox.stopCamera();
  $('#camRow').hidden = true;
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
  clearInterval(tripTimer);
  const ended = trip;
  trip = null;
  setTripLabel(false);
  if (!quiet && ended) {
    const mins = Math.max(1, Math.round((Date.now() - ended.startedAt) / 60000));
    toast(`Trip ended · ${mins} min · ${nearCount} near miss${nearCount === 1 ? '' : 'es'} logged`);
  }
}

async function startDashcam() {
  if (!settings.dashcam || blackbox.cameraOn) return;
  try {
    await blackbox.startCamera({ audio: !!settings.dashAudio, preview: $('#camPreview') });
    $('#camRow').hidden = false;
    $('#bbStatus').textContent = 'Recording';
  } catch {
    $('#camRow').hidden = true;
    toast('Couldn’t start the dashcam. Check camera access in Settings.');
  }
}

$('#driveBtn').onclick = () => (detector?.running ? stopTrip() : startTrip());

$('#demoToggle').checked = settings.demo;
$('#micToggle').checked = settings.mic;
$('#shareToggle').checked = settings.share;
$('#demoToggle').onchange = (e) => {
  settings.demo = e.target.checked;
  saveSettings();
  detector?.setDemo(settings.demo);
  renderHome();
  drawChart();
};
$('#micToggle').onchange = async (e) => {
  settings.mic = e.target.checked;
  saveSettings();
  if (detector?.running) { stopTrip({ quiet: true }); await startTrip(); }
};
$('#shareToggle').onchange = (e) => { settings.share = e.target.checked; saveSettings(); };

const anyDetector = () => detector || makeDetector();
$('#simulateBtn').onclick = () => { unlockAudio(); anyDetector().simulate(); };
$('#simulateNearBtn').onclick = () => { unlockAudio(); anyDetector().simulateNearMiss(); };
$('#closeCallBtn').onclick = () => { unlockAudio(); onNearMiss({ manual: true, peak: null }); };
$('#simulateRideBtn').onclick = () => {
  unlockAudio();
  if (detector?.running) { toast('End the current trip first.'); return; }
  const speed = { car: 13, bike: 5.5, scooter: 5, wheelchair: 1.2, walk: 1.4 }[settings.mode];
  ensureAutostart().simulate(speed);
};

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && detector?.running) requestWakeLock();
});

// ---------- auto-start ----------
function ensureAutostart() {
  autostart ??= new AutoStart({
    isRunning: () => !!detector,
    preferred: () => settings.mode,
    onSpeed: (v) => { if (!detector?.running) $('#speedNow').textContent = Math.round(v * 2.237); },
    onStart: (mode) => {
      if (CrashDetector.needsMotionPermission()) showStartOverlay(mode, 'auto');
      else startTrip({ mode, source: 'auto' });
    },
    onStop: () => { if (trip?.source !== 'manual') stopTrip(); },
  });
  return autostart;
}

async function enableAutoStart() {
  // This runs from a tap, so iPhone motion permission can be asked now.
  if (CrashDetector.needsMotionPermission()) {
    try {
      const r = await DeviceMotionEvent.requestPermission();
      CrashDetector.motionGranted = r === 'granted';
    } catch { /* ask later */ }
  }
  ensureAutostart().enable();
  renderHome();
  toast('Auto-start on. Keep Crashline open and start moving.');
}
function disableAutoStart() { autostart?.disable(); renderHome(); }

function showStartOverlay(mode, why) {
  $('#startTitle').textContent = why === 'auto' ? `Looks like you’re ${MODES[mode].doing}` : `Start ${MODES[mode].doing}`;
  $('#startOverlayBtn').textContent = `Start ${MODES[mode].label.toLowerCase()} trip`;
  $('#startOverlay').hidden = false;
  $('#startOverlayBtn').onclick = () => { $('#startOverlay').hidden = true; startTrip({ mode, source: why }); };
  $('#startOverlayCancel').onclick = () => { $('#startOverlay').hidden = true; };
}

// ---------- near misses → city map ----------
async function currentPosition(maxWaitMs = 4000) {
  if (lastPosition && Date.now() - lastPosition.at < 30000) return lastPosition;
  if (!('geolocation' in navigator)) return lastPosition;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(lastPosition), maxWaitMs);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(timer); lastPosition = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, at: Date.now() }; resolve(lastPosition); },
      () => { clearTimeout(timer); resolve(lastPosition); },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: maxWaitMs }
    );
  });
}

const snap = (v) => Math.round(v / 0.0005) * 0.0005;

async function logEvent(kind, severity) {
  if (!settings.share) return false;
  const pos = await currentPosition();
  if (!pos) return false;
  queue.push({
    lat: Number(snap(pos.lat).toFixed(4)),
    lng: Number(snap(pos.lng).toFixed(4)),
    mode: settings.mode,
    kind,
    severity: severity != null ? Number(severity.toFixed(2)) : null,
    hour: new Date().toISOString().slice(0, 13),
  });
  store.set('crashline.queue', queue);
  await flushQueue();
  desktop?.refresh();
  return true;
}

async function flushQueue() {
  if (!navigator.onLine || !queue.length) return;
  const batch = queue.slice(0, 50);
  try {
    await postJSON('/api/events', { events: batch }, 8000);
    queue.splice(0, batch.length);
    store.set('crashline.queue', queue);
  } catch { /* retry later */ }
}

async function onNearMiss(info) {
  if (incident) return;
  nearCount += 1;
  $('#nearCount').textContent = nearCount;
  beep(660, 0.12);
  navigator.vibrate?.(120);
  const what = info.manual ? 'Close call' : info.kind === 'hard_brake' ? 'Hard braking' : 'Near miss';
  const mapped = await logEvent(info.manual ? 'close_call' : 'near_miss', info.peak ?? null);
  toast(mapped ? `${what} logged on the city map` : settings.share ? `${what} counted (no location yet, so not mapped)` : `${what} counted (map sharing is off)`);
}

// ---------- crash flow ----------
function describe(info) {
  if (info.simulated) return 'Simulated crash for demo';
  const parts = info.reasons?.length ? info.reasons.slice() : [`Impact ${info.peak.toFixed(1)} g`];
  if (info.confidence != null) parts.unshift(`${Math.round(info.confidence * 100)}% confidence`);
  return parts.join(' · ');
}

function triggerCrash(info) {
  if (incident) return;
  if (!profile) { openSetup(); toast('Set up your contacts first.'); return; }
  incident = { startedAt: new Date(), info, mode: settings.mode, triage: {}, steps: [] };
  incident.capture = blackbox.capture({ mode: settings.mode, detection: describe(info) });
  $('#bbStatus').textContent = 'Saving';
  let n = settings.demo ? 10 : 30;
  const auto = settings.autoText !== false;
  $('#countdownLead').textContent = auto ? 'Alerting your emergency contacts in' : 'Opening help in';
  $('#countdownNum').textContent = n;
  $('#detectReason').textContent = describe(info);
  show('countdown');
  startAlarm();
  speak(auto ? `Crash detected. Tap I'm OK to cancel. Alerting your contacts in ${n} seconds.` : `Crash detected. Tap I'm OK to cancel.`);
  countdownTimer = setInterval(() => {
    n -= 1;
    $('#countdownNum').textContent = Math.max(n, 0);
    if (n <= 0) sendAlert({ manual: false });
  }, 1000);
}

$('#okBtn').onclick = () => {
  clearInterval(countdownTimer);
  stopAlarm();
  speechSynthesis?.cancel();
  incident?.capture?.cancel();
  incident = null;
  $('#bbStatus').textContent = blackbox.cameraOn ? 'Recording' : 'Ready';
  detector?.resetCooldown();
  show('home');
  toast('Glad you’re OK. Still monitoring.');
};
$('#sendNowBtn').onclick = () => sendAlert({ manual: true });

const mapsLink = (pos) => (pos ? `https://maps.google.com/?q=${pos.lat.toFixed(5)},${pos.lng.toFixed(5)}` : null);

function buildMessage(pos) {
  const time = incident.startedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const L = myLang();
  let s = `CRASHLINE ALERT: ${profile.name} may have ${MODES[incident.mode].crash} at ${time}.`;
  s += pos ? ` Location: ${mapsLink(pos)} (within ${Math.round(pos.acc)}m).` : ' Location unavailable.';
  if (incident.mode === 'car' && profile.vehicle) s += ` Vehicle: ${profile.vehicle}.`;
  if (profile.medical) s += ` Medical notes: ${profile.medical}.`;
  if (L.key !== 'en') s += ` They speak ${L.english}; first responders may need an interpreter.`;
  s += ' Please call them now. If they don’t answer, call 911.';
  return s;
}

function smsHref(phones, body) {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const list = phones.join(',');
  return ios ? `sms:/open?addresses=${list}&body=${encodeURIComponent(body)}` : `sms:${list}?body=${encodeURIComponent(body)}`;
}

async function openHelp() {
  if (incident.helpOpen) return;
  incident.helpOpen = true;
  clearInterval(countdownTimer);
  stopAlarm();
  const L = myLang();
  $('#helpTalkBtn').textContent = L.key === 'en' ? 'Language bridge: talk with someone in another language' : `Talk to police in ${L.name} (${L.english})`;
  show('help');
  renderTriage();
  renderBlackBox();
  const pos = await currentPosition(5000);
  incident.position = pos;
  incident.message = buildMessage(pos);
  $('#smsFallback').href = smsHref(profile.contacts.map((c) => c.phone), incident.message);
  logEvent('crash', incident.info.peak ?? null);
}

async function sendAlert({ manual }) {
  if (!incident || incident.alerted) return;
  await openHelp();
  const status = $('#alertStatus');
  const names = profile.contacts.map((c) => c.name || c.phone).join(', ');

  if (!manual && settings.autoText === false) {
    status.className = 'alert-status warn';
    status.textContent = 'Automatic texts are off. Your contacts haven’t been told yet.';
    $('#manualAlertBtn').hidden = false;
    $('#manualAlertBtn').onclick = () => { $('#manualAlertBtn').hidden = true; sendAlert({ manual: true }); };
    speak('Tap alert my contacts now if you need help.');
    return;
  }

  incident.alerted = true;
  $('#manualAlertBtn').hidden = true;
  status.className = 'alert-status pending';
  status.textContent = `Alerting ${names} with your location…`;

  let result = { sent: false, reason: 'offline' };
  if (navigator.onLine) {
    const ch = await ensureChannel();
    const pos = incident.position;
    const live = await startLiveIncident();
    const message = live ? `${incident.message} Live location, details, and a way to reply: ${live.link}` : incident.message;
    if (live) $('#smsFallback').href = smsHref(profile.contacts.map((c) => c.phone).filter(Boolean), message);
    try {
      result = await postJSON('/api/alert', {
        contacts: profile.contacts,
        message,
        title: `${profile.name} may have crashed`,
        url: live ? live.link : pos ? mapsLink(pos) : undefined,
        channel: ch ? { id: ch.id, key: ch.key } : undefined,
        selfEmail: profile.selfEmail || undefined,
        selfToken: profile.selfEmail ? profile.selfToken : undefined,
        incidentId: live?.id,
        details: {
          name: profile.name, doing: MODES[incident.mode].doing, crashedAt: incident.startedAt.getTime(),
          medical: profile.medical, language: myLang().english, position: pos, incidentId: live?.id,
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      }, 15000);
    }
    catch (e) { result = { sent: false, reason: e.data?.reason || 'server_unreachable' }; }
  }

  if (result.sent) {
    status.className = 'alert-status ok';
    status.textContent = result.self?.sent
      ? `Your iPhone is texting your contacts automatically. ${describeDelivery(result)}`
      : `Alert sent automatically with your location. ${describeDelivery(result)}`;
    speak('Your emergency contacts have been alerted with your location.');
    // Automatic alerts went out, so the manual "text from this phone" button isn't needed.
    $('#smsFallback').hidden = true;
  } else {
    $('#smsFallback').hidden = false;
    status.className = 'alert-status warn';
    status.textContent = result.reason === 'offline' || result.reason === 'server_unreachable'
      ? 'No data connection. Tap “Text my contacts” to send by regular SMS.'
      : result.reason === 'no_channels'
        ? 'None of your contacts are set up for automatic alerts yet. Tap “Text my contacts” to send it now.'
        : `Couldn’t deliver the alert automatically. ${describeDelivery(result)} Tap “Text my contacts” to send it now.`;
    $('#smsFallback').classList.add('pulse');
    speak('Tap text my contacts to alert your emergency contacts.');
  }
}

// ---------- live incident: moving location + replies from contacts ----------
const ACK_TEXT = { seen: 'has seen your alert', on_way: 'is on the way', called_911: 'called 911', reached: 'reached you' };
let liveTimers = [];
let liveWatch = null;

async function startLiveIncident() {
  if (incident.live) return incident.live;
  const pos = incident.position;
  try {
    const r = await postJSON('/api/incidents', {
      name: profile.name, phone: profile.phone, mode: incident.mode, doing: MODES[incident.mode].doing,
      detection: describe(incident.info), medical: profile.medical,
      vehicle: incident.mode === 'car' ? profile.vehicle : '', language: myLang().english,
      crashedAt: incident.startedAt.getTime(), position: pos, channelId: profile.channel?.id,
    }, 8000);
    const link = `${location.origin}/alert.html?i=${encodeURIComponent(r.id)}&v=${encodeURIComponent(r.view)}`;
    incident.live = { id: r.id, key: r.key, link };
    shareLocation(incident.live);
    pollReplies(incident.live);
    return incident.live;
  } catch {
    return null;
  }
}

function shareLocation(live) {
  let lastSent = 0;
  const send = (p) => {
    if (Date.now() - lastSent < 10000) return;
    lastSent = Date.now();
    postJSON(`/api/incidents/${live.id}/location`, { key: live.key, lat: p.lat, lng: p.lng, acc: p.acc }).catch(() => {});
  };
  if ('geolocation' in navigator) {
    liveWatch = navigator.geolocation.watchPosition(
      (g) => send({ lat: g.coords.latitude, lng: g.coords.longitude, acc: g.coords.accuracy }),
      () => {}, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  }
  liveTimers.push(setTimeout(stopLive, 60 * 60 * 1000)); // share for up to an hour
}

function pollReplies(live) {
  const feed = $('#ackFeed');
  const seen = new Set();
  const tick = async () => {
    try {
      const r = await postJSON(`/api/incidents/${live.id}/status`, { key: live.key }, 8000);
      if (!r.acks?.length) return;
      feed.hidden = false;
      feed.innerHTML = '';
      r.acks.forEach((a) => {
        const li = document.createElement('li');
        li.dataset.status = a.status;
        li.textContent = `${a.name} ${ACK_TEXT[a.status] || 'responded'}`;
        feed.appendChild(li);
        const k = `${a.name}|${a.status}`;
        if (!seen.has(k)) { seen.add(k); speak(`${a.name} ${ACK_TEXT[a.status] || 'responded'}.`); navigator.vibrate?.(150); }
      });
    } catch { /* offline */ }
  };
  liveTimers.push(setInterval(tick, 5000));
  tick();
}

function stopLive() {
  liveTimers.forEach((t) => { clearInterval(t); clearTimeout(t); });
  liveTimers = [];
  if (liveWatch != null) navigator.geolocation.clearWatch(liveWatch);
  liveWatch = null;
  $('#ackFeed').hidden = true;
  $('#ackFeed').innerHTML = '';
}

// ---------- black box on the help screen ----------
async function renderBlackBox() {
  const pill = $('#bbPill'), lead = $('#bbLead'), body = $('#bbBody');
  body.hidden = true;
  pill.textContent = 'Saving…';
  lead.textContent = blackbox.cameraOn
    ? 'Saving dashcam video and sensor data from the minute before the crash and 10 seconds after.'
    : 'Saving motion and GPS from the minute before the crash and 10 seconds after.';
  const cap = incident?.capture;
  if (!cap) return;
  const rec = await cap.done;
  if (!rec || !incident) return;
  incident.record = rec;
  pill.textContent = 'Saved on this phone';
  lead.textContent = 'Tamper-evident: the fingerprint below changes if anything in the recording is altered.';
  body.hidden = false;
  renderRecord(body, rec);
  $('#bbStatus').textContent = blackbox.cameraOn ? 'Recording' : 'Saved';
  if (rec.hash && navigator.onLine) {
    try {
      const ev = await postJSON('/api/evidence', { hash: rec.hash }, 8000);
      rec.evidenceAt = ev.receivedAt;
      await saveIncident(rec);
      if (incident?.record === rec) renderRecord(body, rec);
    } catch { /* offline: still saved locally */ }
  }
}

// ---------- guidance ----------
function renderTriage() {
  const box = $('#triage');
  box.innerHTML = '<h2>Quick check</h2>';
  triageFor(incident.mode).forEach((q) => {
    const wrap = document.createElement('div');
    wrap.className = 'q';
    const p = document.createElement('p');
    p.textContent = q.text;
    const row = document.createElement('div');
    row.className = 'row';
    q.options.forEach((o) => {
      const b = document.createElement('button');
      b.className = 'chip';
      b.textContent = o.label;
      b.onclick = () => {
        incident.triage[q.id] = o.value;
        [...row.children].forEach((c) => c.classList.toggle('selected', c === b));
        updateSteps();
      };
      row.appendChild(b);
    });
    wrap.append(p, row);
    box.appendChild(wrap);
  });
  updateSteps();
}

function renderSteps(steps, source) {
  incident.steps = steps;
  $('#stepsSource').textContent = source;
  const list = $('#stepsList');
  list.innerHTML = '';
  list.dir = incident.stepsLang?.dir || 'ltr';
  steps.forEach((s) => {
    const li = document.createElement('li');
    if (s.urgent) li.classList.add('urgent');
    const b = document.createElement('b');
    b.textContent = s.title;
    const d = document.createElement('span');
    d.textContent = s.detail;
    li.append(b, d);
    list.appendChild(li);
  });
}

function context() {
  return {
    travelMode: MODES[incident.mode].doing,
    minutesSinceCrash: Math.round((Date.now() - incident.startedAt) / 60000),
    localTime: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    detection: describe(incident.info),
    vehicle: incident.mode === 'car' ? profile.vehicle || undefined : undefined,
  };
}

let stepsReq = 0;
let aiTimer = null;
function updateSteps() {
  incident.stepsLang = null;
  const steps = offlineSteps(incident.triage, incident.mode);
  renderSteps(steps, 'Built-in safety guide · works offline');
  const first = steps[0];
  if (first?.urgent && !incident.spokeUrgent && Object.keys(incident.triage).length) {
    incident.spokeUrgent = true;
    speak(`${first.title}. ${first.detail}`);
  }
  clearTimeout(aiTimer);
  if (!navigator.onLine || !Object.keys(incident.triage).length) return;
  aiTimer = setTimeout(async () => {
    const id = ++stepsReq;
    const L = myLang();
    $('#stepsSource').textContent = L.key === 'en' ? 'Built-in guide · tailoring to your answers…' : `Built-in guide · tailoring in ${L.name}…`;
    try {
      const j = await postJSON('/api/guidance', { triage: incident.triage, context: context(), language: L.english }, 15000);
      if (id !== stepsReq || !incident) return;
      if (Array.isArray(j.steps) && j.steps.length) {
        incident.stepsLang = L;
        renderSteps(j.steps.slice(0, 8), `Tailored by AI${L.key !== 'en' ? ` in ${L.name}` : ''} · call 911 in an emergency`);
      } else {
        $('#stepsSource').textContent = 'Built-in safety guide · works offline';
      }
    } catch {
      if (id === stepsReq && incident) $('#stepsSource').textContent = 'Built-in safety guide · works offline';
    }
  }, 700);
}

$('#speakBtn').onclick = () => {
  if (!incident?.steps?.length) return;
  const lang = incident.stepsLang?.speech || 'en-US';
  speak(incident.steps.map((s, i) => `${i + 1}. ${s.title}. ${s.detail}`).join(' '), lang);
};

$('#askForm').onsubmit = async (e) => {
  e.preventDefault();
  const q = $('#askInput').value.trim();
  if (!q || !incident) return;
  const out = $('#askAnswer');
  if (!navigator.onLine) {
    out.textContent = 'You’re offline. The guide above covers the essentials. Call 911 for anything urgent.';
    return;
  }
  out.textContent = 'Thinking…';
  const L = myLang();
  try {
    const j = await postJSON('/api/guidance', { triage: incident.triage, context: context(), question: q, language: L.english }, 15000);
    out.textContent = j.answer || 'No answer came back. Follow the steps above, and call 911 if anyone is in danger.';
    speak(j.answer, L.speech);
  } catch {
    out.textContent = 'Couldn’t reach the assistant. Follow the steps above, and call 911 if anyone is in danger.';
  }
};

$('#helpTalkBtn').onclick = () => openTalk('help');
$('#openTalkBtn').onclick = () => { unlockAudio(); openTalk('home'); };

// ---------- report ----------
function reportText() {
  const pos = incident.position;
  const lines = [
    `Crash report: ${incident.startedAt.toLocaleString()}`,
    `Person: ${profile.name} (${MODES[incident.mode].doing})${incident.mode === 'car' && profile.vehicle ? `, ${profile.vehicle}` : ''}`,
    `Location: ${pos ? mapsLink(pos) : 'unavailable'}`,
    `Detection: ${describe(incident.info)}`,
    `Other driver: ${$('#rDriver').value || '–'}`,
    `Their plate: ${$('#rPlate').value || '–'}`,
    `Their insurance: ${$('#rInsurance').value || '–'}`,
    `Notes: ${$('#rNotes').value || '–'}`,
  ];
  if (incident.record?.hash) lines.push(`Black box fingerprint (SHA-256): ${incident.record.hash}`);
  return lines.join('\n');
}

$('#shareReport').onclick = async () => {
  if (!incident) return;
  const text = reportText();
  try {
    if (navigator.share) { await navigator.share({ title: 'Crash report', text }); return; }
    await navigator.clipboard.writeText(text);
    toast('Report copied to clipboard');
  } catch (e) {
    if (e?.name !== 'AbortError') toast('Couldn’t share. Copy it manually.');
  }
};

$('#doneBtn').onclick = () => {
  const live = incident?.live;
  if (live) {
    const ch = profile.channel;
    postJSON(`/api/incidents/${live.id}/safe`, {
      key: live.key, contacts: profile.contacts, url: live.link,
      channel: ch ? { id: ch.id, key: ch.key } : undefined,
    }, 10000).then(() => toast('Your contacts were told you’re safe')).catch(() => {});
  }
  stopLive();
  incident = null;
  ['#rDriver', '#rPlate', '#rInsurance', '#rNotes', '#askInput'].forEach((s) => { $(s).value = ''; });
  $('#askAnswer').textContent = '';
  $('#smsFallback').classList.remove('pulse');
  $('#smsFallback').hidden = false;
  $('#manualAlertBtn').hidden = true;
  $('#bbStatus').textContent = blackbox.cameraOn ? 'Recording' : 'Ready';
  releaseUrls();
  speechSynthesis?.cancel();
  detector?.resetCooldown(10000);
  show('home');
};

// ---------- requests from people who added you ----------
async function refreshRequests() {
  const box = $('#homeRequests');
  if (!authUser()) { box.innerHTML = ''; return; }
  let data;
  try { data = await loadPeople(); } catch { return; }
  box.innerHTML = '';
  data.incoming.forEach((r) => {
    const card = document.createElement('div');
    card.className = 'card req-card';
    card.innerHTML = '<div class="grow"><b></b><p class="muted small">added you as an emergency contact. Accept to get an alert with their live location if they crash.</p></div><div class="row"><button class="primary small">Accept</button><button class="ghost small">Decline</button></div>';
    card.querySelector('b').textContent = r.fromName;
    const [yes, no] = card.querySelectorAll('button');
    yes.onclick = async () => {
      if (!(await thisPhoneHasAlerts())) { try { await enableAlertsOnThisPhone(); } catch { toast('Accepted. Turn on alerts in Settings so this phone gets them.'); } }
      await respondRequest(r.rid, true).catch(() => {});
      toast(`You’ll get ${r.fromName}’s crash alerts`);
      refreshRequests();
    };
    no.onclick = async () => { await respondRequest(r.rid, false).catch(() => {}); refreshRequests(); };
    box.appendChild(card);
  });
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshRequests(); });

// ---------- profile edits from Settings ----------
function updateProfile(patch) {
  if (!profile) return;
  Object.assign(profile, patch, { updatedAt: Date.now() });
  store.set('crashline.profile', profile);
  if (authUser()) pushCloud({ profile, settings: syncable(), updatedAt: profile.updatedAt }).then(() => { lastSync = Date.now(); }).catch(() => {});
}

async function deleteProfile() {
  const ok = confirm('Delete your Crashline profile?\n\nThis removes your contacts, alert invites, live alerts, and black-box recordings from this device and the server. It can’t be undone.');
  if (!ok) return;
  if (detector) stopTrip({ quiet: true });
  stopLive();
  const user = authUser();
  const ch = profile?.channel;
  try { if (ch) await postJSON(`/api/channels/${ch.id}/delete`, { key: ch.key }, 8000); } catch { /* offline */ }
  try { if (user) await deleteCloud(); } catch { /* offline */ }
  try { for (const r of await listIncidents()) await deleteIncident(r.id); } catch { /* storage blocked */ }
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('crashline.') && k !== 'crashline.session' || k.startsWith('@@auth0spajs@@'))
      .forEach((k) => localStorage.removeItem(k));
  } catch { /* storage blocked */ }
  profile = null;
  toast('Your profile was deleted');
  if (user && user.provider !== 'email') { setTimeout(() => signOut(), 700); return; }
  try { localStorage.removeItem('crashline.session'); } catch { /* ignore */ }
  setTimeout(() => location.replace('/'), 700);
}

// ---------- automatic alert channel ----------
function ensureChannel() {
  return ensureAlertChannel(profile, () => {
    // The channel is part of the profile, so it follows the account to new devices.
    profile.updatedAt = Date.now();
    store.set('crashline.profile', profile);
    if (authUser()) pushCloud({ profile, settings: syncable(), updatedAt: profile.updatedAt }).then(() => { lastSync = Date.now(); }).catch(() => {});
  });
}

function renderAlertsReady(joined, ready) {
  $('#alertsReady').hidden = !profile || joined > 0 || ready;
}
async function refreshAlertsStatus() {
  if (!profile) return;
  if (!profile.channel) { renderAlertsReady(0, serverInfo.sms); return; }
  try {
    const r = await postJSON(`/api/channels/${profile.channel.id}/subscribers`, { key: profile.channel.key }, 8000);
    const n = (r.subscribers || []).length;
    renderAlertsReady(n, serverInfo.sms || (serverInfo.email && profile.contacts.some((c) => c.email)));
  } catch { /* offline */ }
}
$('#alertsReadyBtn').onclick = () => {
  openSettings();
  if ($('#inviteBox').hidden) $('#inviteToggleBtn').click();
  setTimeout(() => $('#alertsSettings').scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
};

// ---------- settings screen ----------
function openSettings() {
  returnTo = incident ? 'help' : (currentScreen() === 'settings' ? returnTo : currentScreen() || 'home');
  if (returnTo === 'countdown' || returnTo === 'setup') returnTo = profile ? 'home' : 'setup';
  renderSettings();
  show('settings');
}
$('#settingsBtn').onclick = openSettings;
$('#openSettingsBtn').onclick = openSettings;
$('#settingsBack').onclick = () => show(returnTo);

initSettings({
  settings,
  onSensitivity: (v) => { settings.sensitivity = v; saveSettings(); detector?.setSensitivity(v); },
  refreshRequests,
  updateProfile,
  deleteProfile,
  ensureChannel,
  onSignedIn,
  onAlertsStatus: (joined, ready) => renderAlertsReady(joined, ready),
  saveSettings,
  profile: () => profile,
  serverInfo: () => serverInfo,
  openSetup,
  syncNow,
  syncStatus,
  enableAutoStart,
  disableAutoStart,
  onDashcamChange: () => {
    renderHome();
    if (!detector?.running) return;
    blackbox.stopCamera();
    $('#camRow').hidden = true;
    if (settings.dashcam) startDashcam();
  },
  onCarSpeed: (v) => {
    if (v == null) return;
    if (detector?.running) detector.pushSpeed(v); else onSpeed(v);
    if (settings.autoStart) ensureAutostart().push(Date.now(), v);
  },
});

// ---------- icons ----------
const svg = (d) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const MODE_ICONS = {
  car: svg('<path d="M3 13l2-5a2 2 0 0 1 2-1.3h10A2 2 0 0 1 19 8l2 5v4h-2"/><path d="M5 17H3v-4h18"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>'),
  bike: svg('<circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/><path d="M5.5 16.5L9 9h6l3.5 7.5M9 9l3 7.5L15 9M13 6h3"/>'),
  scooter: svg('<circle cx="5.5" cy="18" r="2.5"/><circle cx="18.5" cy="18" r="2.5"/><path d="M8 18h8M16 18L14 5h3"/>'),
  wheelchair: svg('<circle cx="10" cy="4" r="1.6"/><path d="M10 7v6h5l2 5"/><path d="M14.5 17.5A5 5 0 1 1 8 10"/>'),
  walk: svg('<circle cx="13" cy="4" r="1.6"/><path d="M10 21l2-6 3 3v3M12 15l-1-5 4 1 2 3M11 10l-3 2v3"/>'),
};

// ---------- network + boot ----------
function updateNet() {
  const on = navigator.onLine;
  $('#netStatus').textContent = on ? 'Online' : 'Offline';
  $('#netStatus').classList.toggle('off', !on);
  if (on) flushQueue();
}
window.addEventListener('online', updateNet);
window.addEventListener('offline', updateNet);
window.addEventListener('resize', sizeChart);
window.addEventListener('screenchange', (e) => { if (e.detail.id === 'home') requestAnimationFrame(sizeChart); });

async function loadServerInfo() {
  try {
    serverInfo = await (await fetch('/api/config')).json();
    $('#serverNote').textContent = `Server: AI guidance and live translation ${serverInfo.ai ? 'on' : 'off (built-in guide and phrase cards)'} · auto-texting ${serverInfo.sms ? 'on' : 'off (phone SMS fallback)'}`;
  } catch {
    $('#serverNote').textContent = 'Server unreachable. Built-in guide, phrase cards, and phone SMS still work.';
  }
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

initTalk({ getLang: () => profile?.language || 'en' });
initInstall();
renderModes();
updateNet();
renderQr($('#qrHome'), location.origin, 4);
desktop = initDesktop();

const startParam = readStartParam();
if (profile) { renderHome(); show('home'); } else openSetup();

(async () => {
  await loadServerInfo();

  // Sign-in loads alongside everything else so it never delays a trip.
  initAuth(serverInfo).then(async () => {
    renderAvatar();
    if (authUser()) {
      await syncNow();
      if (!profile && currentScreen() !== 'setup') openSetup();
    }
    if (currentScreen() === 'setup') renderSetupAccount();
    refreshRequests();
    if (new URLSearchParams(location.search).has('people') && profile) {
      history.replaceState({}, '', '/');
      openSettings();
      setTimeout(() => $('#peopleCard').scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    }
    // Coming back from Google/Apple with an error: keep it on screen, not just a toast.
    if (authError() && profile) openSettings();
    renderHome();
    if (currentScreen() === 'settings') renderAccount();
  });

  if (settings.autoStart) ensureAutostart().enable();
  if (startParam && profile) {
    if (startParam === 'auto') {
      settings.autoStart = true; saveSettings(); ensureAutostart().enable(); renderHome();
    } else if (CrashDetector.needsMotionPermission()) {
      showStartOverlay(startParam, 'link');
    } else {
      startTrip({ mode: startParam, source: 'link' });
    }
  }
  renderIncidents().catch(() => {});
  if (profile) ensureChannel().then(refreshAlertsStatus);
})();
