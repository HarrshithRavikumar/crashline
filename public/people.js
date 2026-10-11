// Finding people on Crashline and managing who gets your alerts.
import { authedFetch } from './auth.js';

function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// Let this phone receive alerts for the signed-in account.
export async function enableAlertsOnThisPhone() {
  if (!pushSupported()) throw new Error('unsupported');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('denied');
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const { key } = await (await fetch('/api/push/key')).json();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
  await authedFetch('/api/devices', { method: 'POST', body: { subscription: sub.toJSON() } });
  return true;
}

export async function thisPhoneHasAlerts() {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(await reg?.pushManager.getSubscription());
}

export const findPeople = ({ phones = [], emails = [] }) => authedFetch('/api/people/lookup', { method: 'POST', body: { phones, emails } }).then((r) => r.matches);
export const requestContact = (uid, channel) => authedFetch('/api/people/request', { method: 'POST', body: { uid, channel: { id: channel.id, key: channel.key } } });
export const loadPeople = () => authedFetch('/api/people/requests');
export const respondRequest = (rid, accept) => authedFetch(`/api/people/requests/${encodeURIComponent(rid)}/respond`, { method: 'POST', body: { accept } });
export const leaveAlerts = (channelId) => authedFetch('/api/people/leave', { method: 'POST', body: { channelId } });
export const removeMember = (uid, channel) => authedFetch('/api/people/remove', { method: 'POST', body: { uid, channel: { id: channel.id, key: channel.key } } });
