import { $, store, postJSON } from './util.js';

const id = new URLSearchParams(location.search).get('c') || '';
const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const KEY = `crashline.joined.${id}`;
let ownerName = 'They';

function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function showDone() {
  $('#joinForm').hidden = true;
  $('#iosSteps').hidden = true;
  $('#joinDone').hidden = false;
  $('#doneText').textContent = `If ${ownerName} is in a crash, this phone gets an alert with their location.`;
}

async function registration() {
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  return reg;
}

async function join() {
  const msg = $('#joinMsg');
  msg.textContent = '';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    if (ios && !standalone) { $('#iosSteps').hidden = false; msg.textContent = 'Follow the steps above, then come back here.'; return; }
    msg.textContent = 'This browser can’t receive alerts. Try Chrome, Edge, Firefox, or Safari on a recent phone.';
    return;
  }
  const btn = $('#joinBtn');
  btn.disabled = true;
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { msg.textContent = 'Notifications are blocked. Allow them for this site in your browser settings, then try again.'; return; }
    const reg = await registration();
    const { key } = await (await fetch('/api/push/key')).json();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
    const name = $('#joinName').value.trim() || 'Contact';
    await postJSON(`/api/channels/${encodeURIComponent(id)}/subscribe`, { subscription: sub.toJSON(), name }, 10000);
    store.set(KEY, { name, endpoint: sub.endpoint, at: Date.now() });
    showDone();
  } catch (e) {
    msg.textContent = e?.data?.error
      || (e?.name === 'AbortError' ? 'Your browser’s notification service couldn’t be reached. Check your connection, or try Chrome or Safari.'
        : e?.name === 'NotAllowedError' ? 'Notifications are blocked for this site. Allow them in your browser settings, then try again.'
          : 'Couldn’t turn on alerts. Check your connection and try again.');
  } finally {
    btn.disabled = false;
  }
}

async function leave() {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await postJSON(`/api/channels/${encodeURIComponent(id)}/unsubscribe`, { endpoint: sub.endpoint });
      await sub.unsubscribe();
    }
  } catch { /* ignore */ }
  store.set(KEY, null);
  $('#joinDone').hidden = true;
  $('#joinForm').hidden = false;
  $('#joinMsg').textContent = 'Alerts are off.';
}

async function preview() {
  const reg = await registration();
  reg.showNotification(`${ownerName} may have crashed`, {
    body: `Example only. A real alert includes their location, travel mode, and medical notes. Tap to open the map.`,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'crashline-preview',
    data: { url: location.href },
  });
}

(async () => {
  if (!id) { $('#joinTitle').textContent = 'This invite link is incomplete'; $('#joinForm').hidden = true; return; }
  try {
    const r = await fetch(`/api/channels/${encodeURIComponent(id)}`);
    if (!r.ok) throw new Error();
    ownerName = (await r.json()).name || 'They';
    $('#joinTitle').textContent = `${ownerName} added you as an emergency contact`;
    $('#joinLead').textContent = `Turn on alerts once. If ${ownerName} is ever in a crash, your phone gets an instant notification with their location, even if they can’t call.`;
  } catch {
    $('#joinTitle').textContent = 'This invite link isn’t valid anymore';
    $('#joinForm').hidden = true;
    return;
  }
  const saved = store.get(KEY, null);
  if (saved && 'Notification' in window && Notification.permission === 'granted') showDone();
  else if (ios && !standalone && !('PushManager' in window)) $('#iosSteps').hidden = false;
  $('#joinBtn').onclick = join;
  $('#leaveBtn').onclick = leave;
  $('#testLocalBtn').onclick = preview;
})();
