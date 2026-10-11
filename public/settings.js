// Settings & integrations screen.
import { $, toast, postJSON } from './util.js';
import { platform, phoneGuide } from './platform.js';
import { listIncidents, deleteIncident } from './blackbox.js';
import { renderRecord, releaseUrls } from './bbview.js';
import { connectObd, obdSupported } from './obd.js';
import { authUser, signOut } from './auth.js';
import { renderAuthPanel } from './authpanel.js';
import { replay, SENSITIVITY } from './detector.js';
import { SCENARIOS } from './scenarios.js';
import {
  pushSupported, enableAlertsOnThisPhone, thisPhoneHasAlerts, findPeople, requestContact,
  loadPeople, respondRequest, leaveAlerts, removeMember,
} from './people.js';
import { inviteLink, inviteText, listSubscribers, smsInviteHref } from './invites.js';

export function renderQr(el, text, cell = 4) {
  if (!el || typeof window.qrcode === 'undefined') return;
  const q = window.qrcode(0, 'M');
  q.addData(text);
  q.make();
  el.innerHTML = q.createSvgTag({ cellSize: cell, margin: 2, scalable: true });
}

let ctx = null;
let obd = null;
let motionState = 'unknown';
export const setMotionState = (s) => { motionState = s; };

export function initSettings(context) {
  ctx = context;
  const s = ctx.settings;

  $('#autoTextToggle').onchange = (e) => { s.autoText = e.target.checked; ctx.saveSettings(); renderAlerts(); };
  $('#autoStartToggle').onchange = async (e) => {
    s.autoStart = e.target.checked;
    ctx.saveSettings();
    if (s.autoStart) await ctx.enableAutoStart(); else ctx.disableAutoStart();
  };
  $('#dashcamToggle').onchange = async (e) => {
    s.dashcam = e.target.checked;
    ctx.saveSettings();
    if (s.dashcam) {
      // Ask for the camera now (this tap counts as permission), then release it until a trip starts.
      try {
        const st = await navigator.mediaDevices.getUserMedia({ video: true, audio: !!s.dashAudio });
        st.getTracks().forEach((t) => t.stop());
        toast('Dashcam on. It records while a trip is running.');
      } catch {
        s.dashcam = false; e.target.checked = false; ctx.saveSettings();
        toast('Camera access was blocked, so the dashcam is off.');
      }
    }
    ctx.onDashcamChange();
    renderPermissions();
  };
  $('#dashAudioToggle').onchange = (e) => { s.dashAudio = e.target.checked; ctx.saveSettings(); ctx.onDashcamChange(); };

  $('#inviteToggleBtn').onclick = () => { const b = $('#inviteBox'); b.hidden = !b.hidden; if (!b.hidden) renderInvites(); };
  $('#testAlertBtn').onclick = sendTestAlert;
  $('#shareInviteBtn').onclick = shareInvite;
  $('#copyInviteBtn').onclick = async () => {
    const link = await currentInviteLink();
    if (!link) return;
    try { await navigator.clipboard.writeText(link); toast('Invite link copied'); } catch { toast(link); }
  };
  $('#obdBtn').onclick = toggleObd;
  $('#editMedicalBtn').onclick = () => ctx.openSetup();
  $('#selfEmailSave').onclick = saveSelfEmail;
  $('#selfTestBtn').onclick = testSelfText;
  $('#copySender').onclick = async () => {
    const v = $('#senderAddr').dataset.addr;
    if (!v) return;
    try { await navigator.clipboard.writeText(v); toast('Sender email copied. Paste it into the automation.'); } catch { toast(v); }
  };
  $('#deleteProfileBtn').onclick = () => ctx.deleteProfile();
  initDetection();

  $('#phoneGuide').addEventListener('click', async (e) => {
    const text = e.target?.dataset?.copy;
    if (!text) return;
    try { await navigator.clipboard.writeText(text); toast('Link copied'); } catch { toast(text); }
  });
}

export function renderSettings() {
  const s = ctx.settings;
  $('#autoTextToggle').checked = s.autoText !== false;
  $('#autoStartToggle').checked = !!s.autoStart;
  $('#dashcamToggle').checked = !!s.dashcam;
  $('#dashAudioToggle').checked = !!s.dashAudio;
  renderAccount();
  renderAlerts();
  renderSelfText();
  renderPeople();
  renderDetection();
  renderPermissions();
  renderIncidents();
  renderPhone();
  renderObd();
}

// ---------- account ----------
const PROVIDER = { email: 'Email', 'google-oauth2': 'Google', apple: 'Apple' };

export function renderAccount() {
  const box = $('#accountBox');
  const user = authUser();
  if (!user) {
    box.innerHTML = '<p class="muted small">Back up your profile and contacts, and use them on any phone or computer.</p><div class="auth-panel" id="settingsAuth"></div>';
    renderAuthPanel($('#settingsAuth'), { onSignedIn: (u, mode) => ctx.onSignedIn(u, mode) });
    return;
  }
  box.innerHTML = `
    <div class="row account-row">
      <img class="avatar" alt="" referrerpolicy="no-referrer">
      <div class="avatar avatar-letter" aria-hidden="true"></div>
      <div class="grow"><b class="acc-name"></b><p class="muted small acc-email"></p></div>
    </div>
    <p class="muted small" id="syncNote"></p>
    <div class="row"><button class="ghost small" id="syncBtn">Sync now</button><button class="ghost small" id="signOutBtn">Sign out</button></div>`;
  const img = box.querySelector('img.avatar');
  const letter = box.querySelector('.avatar-letter');
  if (user.picture) { img.src = user.picture; letter.remove(); } else { img.remove(); letter.textContent = (user.name || user.email || '?')[0].toUpperCase(); }
  box.querySelector('.acc-name').textContent = user.name || 'Signed in';
  box.querySelector('.acc-email').textContent = `${user.email || ''}${user.provider ? ` · ${PROVIDER[user.provider] || user.provider}` : ''}`;
  $('#syncNote').textContent = ctx.syncStatus();
  $('#syncBtn').onclick = async () => { await ctx.syncNow(true); $('#syncNote').textContent = ctx.syncStatus(); };
  $('#signOutBtn').onclick = () => signOut();
}

// ---------- emergency alerts ----------
async function currentInviteLink() {
  const ch = await ctx.ensureChannel();
  if (!ch) { toast('Couldn’t reach the server to make an invite link.'); return null; }
  return inviteLink(ch);
}

export async function renderAlerts() {
  const s = ctx.settings;
  const info = ctx.serverInfo();
  const p = ctx.profile();
  const list = $('#channelList');
  const emails = (p?.contacts || []).filter((c) => c.email).length;
  const ch = p?.channel || null;
  const subs = ch ? await listSubscribers(ch) : [];
  const joined = subs || [];
  const rows = [
    {
      name: 'Instant alerts', on: joined.length > 0,
      detail: joined.length
        ? `${joined.length} contact${joined.length > 1 ? 's' : ''} ready: ${joined.map((x) => x.name).join(', ')}`
        : 'No one has accepted an invite yet. Free, works on any phone.',
    },
    {
      name: 'Email', on: info.email && emails > 0,
      detail: !info.email ? 'Off: the server needs an email account set up (see README).' : emails ? `${emails} contact${emails > 1 ? 's have' : ' has'} an email address` : 'Add email addresses to your contacts to use this.',
    },
    {
      name: 'Text messages', on: info.sms,
      detail: info.sms ? 'On, through Twilio.' : 'Off: needs a Twilio number that can send custom texts (free trials can’t).',
    },
  ];
  list.innerHTML = '';
  rows.forEach((r) => {
    const li = document.createElement('li');
    li.innerHTML = '<span class="ch-dot"></span><div class="grow"><b></b><p class="muted small"></p></div>';
    li.querySelector('.ch-dot').dataset.on = r.on;
    li.querySelector('b').textContent = r.name;
    li.querySelector('p').textContent = r.detail;
    list.appendChild(li);
  });
  const ready = rows.some((r) => r.on);
  const auto = s.autoText !== false;
  const note = document.createElement('li');
  note.className = 'muted small';
  note.textContent = !auto
    ? 'Automatic sending is off: after a crash, Crashline will ask before alerting anyone.'
    : ready ? 'After the countdown, every channel that’s on fires automatically.'
      : 'Nothing is set up to send automatically yet. Invite contacts so alerts go out on their own.';
  list.appendChild(note);
  ctx.onAlertsStatus?.(joined.length, ready);
}

async function renderInvites() {
  const link = await currentInviteLink();
  if (!link) return;
  renderQr($('#inviteQr'), link, 4);
  const p = ctx.profile();
  const ul = $('#inviteContacts');
  ul.innerHTML = '';
  const text = inviteText(p, link);
  (p?.contacts || []).filter((c) => c.phone).forEach((c) => {
    const li = document.createElement('li');
    li.innerHTML = '<span class="grow"></span><a class="ghost small">Text invite</a>';
    li.querySelector('span').textContent = c.name || c.phone;
    li.querySelector('a').href = smsInviteHref(c.phone, text);
    ul.appendChild(li);
  });
  if (!ul.children.length) ul.innerHTML = '<li class="muted small">Scan the code or share the link.</li>';
}

async function shareInvite() {
  const link = await currentInviteLink();
  if (!link) return;
  const text = inviteText(ctx.profile(), link);
  try {
    if (navigator.share) { await navigator.share({ title: 'Crashline emergency contact', text, url: link }); return; }
    await navigator.clipboard.writeText(text);
    toast('Invite copied. Paste it in a message.');
  } catch (e) {
    if (e?.name !== 'AbortError') toast(link);
  }
}

async function sendTestAlert() {
  const p = ctx.profile();
  const out = $('#testAlertResult');
  if (!p) return;
  const btn = $('#testAlertBtn');
  btn.disabled = true;
  out.textContent = 'Sending…';
  try {
    const ch = await ctx.ensureChannel();
    const r = await postJSON('/api/alert', {
      contacts: p.contacts,
      title: `Test alert from ${p.name}`,
      message: `This is a test from ${p.name}'s Crashline. In a real crash you'd get their location right away.`,
      url: location.origin,
      channel: ch ? { id: ch.id, key: ch.key } : undefined,
    }, 15000);
    out.textContent = describeDelivery(r) || 'No one received it: no alert channel is set up yet. Invite your contacts first.';
  } catch {
    out.textContent = 'Couldn’t reach the server.';
  } finally {
    btn.disabled = false;
  }
}

// ---------- auto-text from my iPhone ----------
export function newSelfToken() {
  const b = crypto.getRandomValues(new Uint8Array(15));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function renderSelfText() {
  const p = ctx.profile();
  const info = ctx.serverInfo();
  $('#selfEmail').value = p?.selfEmail || '';
  if (p?.selfEmail && !p.selfToken) ctx.updateProfile({ selfToken: newSelfToken() });
  const sender = $('#senderAddr');
  sender.textContent = 'the Crashline email';
  sender.dataset.addr = info.emailFrom || '';
  $('#copySender').hidden = !info.emailFrom;
  $('#shortcutBase').textContent = `${location.origin}/s/`;
  const btn = $('#getShortcutBtn');
  if (info.shortcutUrl) { btn.href = info.shortcutUrl; $('#shortcutRow').hidden = false; $('#noShortcutMsg').hidden = true; }
  else { $('#shortcutRow').hidden = true; $('#noShortcutMsg').hidden = false; }
  const warn = $('#selfTextWarn');
  warn.hidden = !!info.email;
  warn.textContent = info.email ? '' : 'The server can’t send the trigger email yet. Add SMTP_USER and SMTP_PASS to .env and redeploy (see README).';
}

function saveSelfEmail() {
  const v = $('#selfEmail').value.trim();
  if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { toast('Enter a valid email'); return false; }
  const patch = { selfEmail: v };
  if (v && !ctx.profile()?.selfToken) patch.selfToken = newSelfToken();
  ctx.updateProfile(patch);
  toast(v ? 'Saved. Crashes will trigger your iPhone Shortcut.' : 'Auto-text from iPhone turned off');
  return true;
}

async function testSelfText() {
  const out = $('#selfTestMsg');
  const email = $('#selfEmail').value.trim();
  if (!email) { out.textContent = 'Enter your iCloud email first.'; return; }
  if (email !== (ctx.profile()?.selfEmail || '') && !saveSelfEmail()) return;
  const p = ctx.profile();
  if (!p?.phone) { out.textContent = 'Add your phone number in your profile first, so the test can text you.'; return; }
  out.textContent = 'Sending the trigger email…';
  try {
    const r = await fetch('/api/selftext/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, token: p.selfToken, phone: p.phone }) });
    const j = await r.json().catch(() => ({}));
    out.textContent = r.ok
      ? 'Sent. In a few seconds you should get a text from yourself. If nothing comes, check step 4 (Sender and Subject) and that iCloud Mail is on.'
      : j.error === 'email_not_configured' ? 'The server isn’t set up to send email yet (see the red note above).' : 'Couldn’t send the trigger email. Check the address.';
  } catch {
    out.textContent = 'Couldn’t reach the server.';
  }
}

export function describeDelivery(r) {
  if (!r) return '';
  const parts = [];
  if (r.self?.sent) parts.push('texts from your iPhone');
  if (r.push?.sent) parts.push(`${r.push.sent} instant alert${r.push.sent > 1 ? 's' : ''}`);
  if (r.email?.sent) parts.push(`${r.email.sent} email${r.email.sent > 1 ? 's' : ''}`);
  if (r.sms?.sent) parts.push(`${r.sms.sent} text${r.sms.sent > 1 ? 's' : ''}`);
  let s = parts.length ? `Delivered: ${parts.join(' · ')}.` : '';
  if (r.sms?.errors?.length) s += ` Texts failed: ${r.sms.errors.join(' ')}`;
  return s.trim();
}

// ---------- permissions ----------
async function queryPerm(name) {
  try { return (await navigator.permissions.query({ name })).state; } catch { return 'unknown'; }
}

async function renderPermissions() {
  const list = $('#permList');
  const iosMotion = typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function';
  const rows = [
    {
      name: 'Motion sensors', why: 'Detects crashes and near misses (required)',
      state: iosMotion ? motionState : ('DeviceMotionEvent' in window ? 'granted' : 'unavailable'),
      ask: iosMotion ? async () => { setMotionState(await DeviceMotionEvent.requestPermission().catch(() => 'denied')); } : null,
    },
    {
      name: 'Location', why: 'Puts your location in alerts and maps near misses',
      state: await queryPerm('geolocation'),
      ask: () => new Promise((res) => navigator.geolocation.getCurrentPosition(() => res(), () => res(), { timeout: 10000 })),
    },
    {
      name: 'Microphone', why: 'Crash sounds and speaking in the language bridge',
      state: await queryPerm('microphone'),
      ask: async () => { const st = await navigator.mediaDevices.getUserMedia({ audio: true }); st.getTracks().forEach((t) => t.stop()); },
    },
    {
      name: 'Camera', why: 'Dashcam video in the black box',
      state: await queryPerm('camera'),
      ask: async () => { const st = await navigator.mediaDevices.getUserMedia({ video: true }); st.getTracks().forEach((t) => t.stop()); },
    },
    {
      name: 'Bluetooth', why: 'Reading speed from your car',
      state: obdSupported() ? 'ask' : 'unavailable',
      ask: null,
    },
  ];
  const label = { granted: 'Allowed', denied: 'Blocked', prompt: 'Not asked yet', ask: 'Asks when used', unknown: 'Asks when used', unavailable: 'Not on this device' };
  list.innerHTML = '';
  rows.forEach((r) => {
    const li = document.createElement('li');
    li.innerHTML = '<div class="grow"><b></b><p class="muted small"></p></div><span class="perm-state"></span>';
    li.querySelector('b').textContent = r.name;
    li.querySelector('p').textContent = r.why;
    const st = li.querySelector('.perm-state');
    st.textContent = label[r.state] || r.state;
    st.dataset.state = r.state;
    if (r.ask && r.state !== 'granted' && r.state !== 'unavailable') {
      const b = document.createElement('button');
      b.className = 'ghost small';
      b.textContent = r.state === 'denied' ? 'How to fix' : 'Allow';
      b.onclick = async () => {
        if (r.state === 'denied') {
          toast(platform().ios ? 'Open iPhone Settings → Safari (or the app) and allow it, then reload.' : 'Tap the lock icon by the address, allow it, then reload.');
          return;
        }
        try { await r.ask(); } catch { /* user said no */ }
        renderPermissions();
      };
      li.appendChild(b);
    }
    list.appendChild(li);
  });
}

// ---------- saved incidents ----------
export async function renderIncidents() {
  const list = $('#incidentList');
  let items = [];
  try { items = await listIncidents(); } catch { /* storage blocked */ }
  list.innerHTML = '';
  if (!items.length) { list.innerHTML = '<li class="muted small">None yet. Recordings from crashes appear here.</li>'; return; }
  items.forEach((rec) => {
    const li = document.createElement('li');
    li.innerHTML = '<div class="row between"><div><b></b><p class="muted small"></p></div><div class="row"><button class="ghost small v">View</button><button class="ghost small d">Delete</button></div></div><div class="stack-sm inc-body" hidden></div>';
    li.querySelector('b').textContent = new Date(rec.impact).toLocaleString();
    li.querySelector('p').textContent = `${rec.mode || ''}${rec.video?.length ? ` · ${rec.video.length} video clip${rec.video.length > 1 ? 's' : ''}` : ' · sensors only'}`;
    const body = li.querySelector('.inc-body');
    li.querySelector('.v').onclick = () => {
      body.hidden = !body.hidden;
      if (!body.hidden) renderRecord(body, rec);
    };
    li.querySelector('.d').onclick = async () => {
      if (!confirm('Delete this recording from this phone?')) return;
      await deleteIncident(rec.id).catch(() => {});
      releaseUrls();
      renderIncidents();
    };
    list.appendChild(li);
  });
}

// ---------- phone ----------
function renderPhone() {
  const p = platform();
  $('#phoneName').textContent = `· ${p.name} detected`;
  $('#phoneGuide').innerHTML = phoneGuide(p, location.origin);
  renderQr($('#qrBox'), location.origin, 5);
}

// ---------- car ----------
function renderObd() {
  const btn = $('#obdBtn');
  if (!obdSupported()) {
    btn.disabled = true;
    $('#obdStatus').textContent = 'This browser can’t use Bluetooth. Try Chrome on Android or a computer.';
    return;
  }
  btn.textContent = obd ? `Disconnect ${obd.name}` : 'Connect to car';
}

async function toggleObd() {
  if (obd) { obd.disconnect(); obd = null; ctx.onCarSpeed(null); renderObd(); return; }
  try {
    obd = await connectObd({
      onSpeed: (v) => ctx.onCarSpeed(v),
      onStatus: (msg) => { $('#obdStatus').textContent = msg; },
    });
  } catch (e) {
    if (e?.name !== 'NotFoundError') $('#obdStatus').textContent = e.message || 'Couldn’t connect.';
  }
  renderObd();
}

// ---------- people on Crashline ----------

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let peopleState = { matches: null };

export async function renderPeople() {
  const box = $('#peopleBody');
  if (!authUser()) {
    box.innerHTML = '<p class="muted small">Sign in (Account, above) to see which of your contacts use Crashline and add them as emergency contacts. They’ll get your alerts on their phone automatically.</p>';
    return;
  }
  let data;
  try { data = await loadPeople(); } catch { box.innerHTML = '<p class="muted small">Couldn’t load people right now.</p>'; return; }
  const p = ctx.profile();
  const ch = await ctx.ensureChannel();
  let mine = [];
  try { mine = ch ? (await postJSON(`/api/channels/${ch.id}/subscribers`, { key: ch.key })).subscribers.filter((x) => x.via === 'account') : []; } catch { /* offline */ }
  const phoneOn = await thisPhoneHasAlerts();

  box.innerHTML = `
    ${data.incoming.length ? `<div class="people-requests">${data.incoming.map((r) => `
      <div class="req"><div class="grow"><b>${esc(r.fromName)}</b><p class="muted small">added you as an emergency contact</p></div>
      <button class="primary small" data-accept="${esc(r.rid)}">Accept</button><button class="ghost small" data-decline="${esc(r.rid)}">Decline</button></div>`).join('')}</div>` : ''}

    <div class="phone-alerts row">
      <span class="ch-dot" data-on="${phoneOn && data.devices > 0}"></span>
      <div class="grow"><b>Alerts on this phone</b><p class="muted small">${phoneOn && data.devices > 0 ? 'On. If someone who added you crashes, this phone gets the alert.' : 'Off. Turn on to get alerts from people who add you.'}</p></div>
      ${phoneOn && data.devices > 0 ? '' : `<button class="ghost small" id="phoneAlertsBtn" ${pushSupported() ? '' : 'disabled'}>Turn on</button>`}
    </div>

    <div class="stack-sm">
      <button class="primary" id="findContactsBtn">Find my contacts on Crashline</button>
      <form class="row" id="peopleSearch"><input class="grow" id="peopleQuery" placeholder="Search by phone or email" autocomplete="off" inputmode="email"><button class="ghost">Find</button></form>
      <ul class="people-list" id="peopleResults"></ul>
    </div>

    <h3>Your emergency contacts on Crashline</h3>
    <ul class="people-list">${mine.length ? mine.map((m) => `
      <li><span class="ch-dot" data-on="${m.devices > 0}"></span><div class="grow"><b>${esc(m.name)}</b><p class="muted small">${m.devices > 0 ? 'Gets your alerts' : 'Accepted, but alerts are off on their phone'}</p></div><button class="ghost small" data-remove="${esc(m.uid)}">Remove</button></li>`).join('')
      : '<li class="muted small">No one yet.</li>'}
      ${data.outgoing.filter((o) => o.status === 'pending').map((o) => `<li><span class="ch-dot"></span><div class="grow"><b>${esc(o.toName)}</b><p class="muted small">Request sent, waiting for them to accept</p></div></li>`).join('')}
    </ul>

    ${data.protecting.length ? `<h3>You get alerts for</h3><ul class="people-list">${data.protecting.map((c) => `
      <li><div class="grow"><b>${esc(c.name)}</b></div><button class="ghost small" data-leave="${esc(c.id)}">Stop</button></li>`).join('')}</ul>` : ''}

    <label class="toggle"><input type="checkbox" id="discoverToggle" ${p?.discoverable === false ? '' : 'checked'}><span>Let people who already have my number or email find me <small class="muted">· exact matches only, no browsing</small></span></label>
  `;
  renderMatches();

  box.querySelectorAll('[data-accept]').forEach((b) => { b.onclick = () => answer(b.dataset.accept, true); });
  box.querySelectorAll('[data-decline]').forEach((b) => { b.onclick = () => answer(b.dataset.decline, false); });
  box.querySelectorAll('[data-remove]').forEach((b) => {
    b.onclick = async () => { if (!confirm('Stop sending this person your crash alerts?')) return; await removeMember(b.dataset.remove, await ctx.ensureChannel()).catch(() => {}); renderPeople(); };
  });
  box.querySelectorAll('[data-leave]').forEach((b) => {
    b.onclick = async () => { if (!confirm('Stop getting this person’s crash alerts?')) return; await leaveAlerts(b.dataset.leave).catch(() => {}); renderPeople(); };
  });
  $('#phoneAlertsBtn')?.addEventListener('click', turnOnPhoneAlerts);
  $('#findContactsBtn').onclick = findMyContacts;
  $('#peopleSearch').onsubmit = (e) => { e.preventDefault(); searchPeople($('#peopleQuery').value.trim()); };
  $('#discoverToggle').onchange = (e) => ctx.updateProfile({ discoverable: e.target.checked });
}

async function turnOnPhoneAlerts() {
  try {
    await enableAlertsOnThisPhone();
    toast('Alerts are on for this phone');
  } catch (e) {
    toast(e.message === 'denied' ? 'Notifications are blocked. Allow them in your browser settings.' : platform().ios ? 'On iPhone, add Crashline to your Home Screen first, then try again.' : 'This browser can’t receive alerts.');
  }
  renderPeople();
  ctx.refreshRequests?.();
}

async function answer(rid, accept) {
  if (accept && !(await thisPhoneHasAlerts())) {
    try { await enableAlertsOnThisPhone(); } catch { toast('Accepted, but turn on alerts on this phone so you actually get them.'); }
  }
  try { await respondRequest(rid, accept); toast(accept ? 'Accepted. You’ll get their crash alerts.' : 'Declined'); } catch { toast('Couldn’t update that request.'); }
  renderPeople();
  ctx.refreshRequests?.();
}

async function findMyContacts() {
  const p = ctx.profile();
  const phones = (p?.contacts || []).map((c) => c.phone).filter(Boolean);
  const emails = (p?.contacts || []).map((c) => c.email).filter(Boolean);
  if (!phones.length && !emails.length) { toast('Add contacts to your profile first.'); return; }
  peopleState.matches = await findPeople({ phones, emails }).catch(() => []);
  peopleState.label = peopleState.matches.length
    ? `${peopleState.matches.length} of your contacts use Crashline`
    : 'None of your contacts are on Crashline yet. Invite them with the link above.';
  renderMatches();
}

async function searchPeople(q) {
  if (!q) return;
  const isEmail = q.includes('@');
  peopleState.matches = await findPeople(isEmail ? { emails: [q] } : { phones: [q] }).catch(() => []);
  peopleState.label = peopleState.matches.length ? '' : 'No one found with that exact phone or email.';
  renderMatches();
}

function renderMatches() {
  const ul = $('#peopleResults');
  if (!ul || !peopleState.matches) return;
  ul.innerHTML = (peopleState.label ? `<li class="muted small">${esc(peopleState.label)}</li>` : '') + peopleState.matches.map((m) => `
    <li><span class="avatar avatar-letter small-av" aria-hidden="true">${esc((m.name || '?')[0].toUpperCase())}</span>
      <div class="grow"><b>${esc(m.name)}</b><p class="muted small">${esc(m.value)}</p></div>
      <button class="primary small" data-add="${esc(m.uid)}">Add</button></li>`).join('');
  ul.querySelectorAll('[data-add]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try {
        const ch = await ctx.ensureChannel();
        const r = await requestContact(b.dataset.add, ch);
        b.textContent = r.status === 'accepted' ? 'Added' : 'Requested';
        toast('Request sent. They’ll get a notification to accept.');
      } catch (e) {
        b.disabled = false;
        toast(e.message && e.message.length < 80 ? e.message : 'Couldn’t send the request.');
      }
    };
  });
}

// ---------- crash detection: sensitivity + Detection Lab ----------

const SENS_NOTE = {
  low: 'Alarms only for clear crashes. Best if you get false alarms.',
  normal: 'Recommended balance between catching crashes and avoiding false alarms.',
  high: 'Alarms for borderline impacts too. You may need to tap “I’m OK” more often.',
};
const OUTCOME = { crash: 'Crash alarm', near_miss: 'Near miss logged', none: 'No alarm' };

export function initDetection() {
  document.querySelectorAll('#sensSeg [data-sens]').forEach((b) => {
    b.onclick = () => { ctx.onSensitivity(b.dataset.sens); renderDetection(); runLab(); };
  });
  $('#labRunAll').onclick = runLab;
}

export function renderDetection() {
  const s = ctx.settings.sensitivity || 'normal';
  document.querySelectorAll('#sensSeg [data-sens]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.sens === s)));
  document.querySelectorAll('#sensSeg [data-sens]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.sens === s)));
  $('#sensNote').textContent = `${SENS_NOTE[s]} (alarm at ${Math.round(SENSITIVITY[s] * 100)}% confidence)`;
}

function sparkline(canvas, scenario) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr) || 240;
  canvas.height = Math.round(canvas.clientHeight * dpr) || 40;
  const x = canvas.getContext('2d');
  const css = getComputedStyle(document.documentElement);
  const g = scenario.samples.map((p) => Math.hypot(...p.lin) / 9.80665);
  const max = Math.max(3, ...g);
  x.strokeStyle = css.getPropertyValue('--accent').trim();
  x.lineWidth = 1.2 * dpr;
  x.beginPath();
  g.forEach((v, i) => {
    const px = (i / (g.length - 1)) * canvas.width;
    const py = canvas.height - (v / max) * (canvas.height - 2) - 1;
    i ? x.lineTo(px, py) : x.moveTo(px, py);
  });
  x.stroke();
}

function runLab() {
  const sens = ctx.settings.sensitivity || 'normal';
  const list = $('#labList');
  list.innerHTML = '';
  let pass = 0;
  for (const sc of SCENARIOS) {
    const data = sc.build();
    const r = replay(data, { sensitivity: sens });
    const ok = r.outcome === sc.expect;
    if (ok) pass++;
    const li = document.createElement('li');
    li.className = ok ? 'pass' : 'fail';
    li.innerHTML = `<div class="row between"><b></b><span class="lab-badge"></span></div><canvas class="lab-spark"></canvas><p class="muted small lab-why"></p>`;
    li.querySelector('b').textContent = sc.name;
    li.querySelector('.lab-badge').textContent = `${ok ? '✓' : '✗'} ${OUTCOME[r.outcome]}${r.outcome !== 'near_miss' ? ` · ${Math.round(r.confidence * 100)}%` : ''}`;
    const why = r.outcome === 'crash' ? r.reasons : r.outcome === 'near_miss' ? ['sustained hard braking, below crash level'] : (r.notes.length ? r.notes : ['impact too small or too brief']);
    li.querySelector('.lab-why').textContent = `${sc.mode === 'car' ? 'Driving' : sc.mode === 'bike' ? 'Biking' : 'Walking'} · ${why.join(' · ')}`;
    list.appendChild(li);
    requestAnimationFrame(() => sparkline(li.querySelector('canvas'), data));
  }
  const sum = document.createElement('li');
  sum.className = 'lab-sum';
  sum.textContent = `${pass} of ${SCENARIOS.length} handled correctly at this sensitivity`;
  list.prepend(sum);
}
