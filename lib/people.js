// People on Crashline: phones registered to accounts, finding contacts who
// already use the app, and "add me as your emergency contact" requests.
import crypto from 'node:crypto';
import { load, save } from './store.js';

let devices = load('devices.json', {});                      // sub → [{ endpoint, keys, at }]
let people = load('people.json', { ids: {}, requests: [] });  // ids: sub → public id

const digits = (p) => String(p || '').replace(/\D/g, '').slice(-10);
const savePeople = () => save('people.json', people);

// ---- devices ----
export function registerDevice(sub, subscription) {
  if (!subscription?.endpoint || !/^https:\/\//.test(subscription.endpoint) || !subscription.keys?.p256dh || !subscription.keys?.auth) return false;
  for (const list of Object.values(devices)) {
    const i = list.findIndex((d) => d.endpoint === subscription.endpoint);
    if (i >= 0) list.splice(i, 1); // a phone belongs to one account at a time
  }
  const list = (devices[sub] ||= []);
  list.push({ endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth }, at: Date.now() });
  if (list.length > 5) list.splice(0, list.length - 5);
  save('devices.json', devices);
  return true;
}
export function unregisterDevice(sub, endpoint) {
  devices[sub] = (devices[sub] || []).filter((d) => d.endpoint !== endpoint);
  save('devices.json', devices);
}
export const devicesOf = (sub) => devices[sub] || [];
export function dropEndpoint(endpoint) {
  let changed = false;
  for (const sub of Object.keys(devices)) {
    const n = devices[sub].length;
    devices[sub] = devices[sub].filter((d) => d.endpoint !== endpoint);
    if (devices[sub].length !== n) changed = true;
  }
  if (changed) save('devices.json', devices);
}

// ---- public ids (so real account ids never leave the server) ----
export function uidFor(sub) {
  if (!people.ids[sub]) { people.ids[sub] = crypto.randomBytes(8).toString('base64url'); savePeople(); }
  return people.ids[sub];
}
export const subForUid = (uid) => Object.keys(people.ids).find((s) => people.ids[s] === uid) || null;

// ---- matching contacts ----
// Exact matches only (no browsing), and only people who left "discoverable" on.
export function lookup(profiles, selfSub, { phones = [], emails = [] } = {}) {
  const wantP = new Set(phones.map(digits).filter((d) => d.length >= 7));
  const wantE = new Set(emails.map((e) => String(e).trim().toLowerCase()).filter((e) => e.includes('@')));
  const out = [];
  for (const [sub, rec] of Object.entries(profiles)) {
    if (sub === selfSub) continue;
    const p = rec.profile || {};
    if (p.discoverable === false) continue;
    const ph = digits(p.phone), em = String(rec.email || '').toLowerCase();
    let match = null;
    if (ph && wantP.has(ph)) match = { by: 'phone', value: p.phone };
    else if (em && wantE.has(em)) match = { by: 'email', value: rec.email };
    if (match) out.push({ uid: uidFor(sub), name: p.name || 'Crashline user', ...match, gettingAlerts: devicesOf(sub).length > 0 });
  }
  return out.slice(0, 50);
}

// ---- requests ----
export function createRequest({ fromSub, fromName, toSub, toName, channelId }) {
  const dup = people.requests.find((r) => r.from === fromSub && r.to === toSub && r.channelId === channelId && r.status !== 'declined');
  if (dup) return { request: dup, existing: true };
  const r = { rid: crypto.randomBytes(8).toString('base64url'), from: fromSub, fromName, to: toSub, toName, channelId, status: 'pending', at: Date.now() };
  people.requests.push(r);
  if (people.requests.length > 5000) people.requests = people.requests.slice(-5000);
  savePeople();
  return { request: r, existing: false };
}

export function requestsFor(sub) {
  const mine = people.requests;
  return {
    incoming: mine.filter((r) => r.to === sub && r.status === 'pending').map((r) => ({ rid: r.rid, fromName: r.fromName, at: r.at })),
    outgoing: mine.filter((r) => r.from === sub).map((r) => ({ rid: r.rid, toName: r.toName, status: r.status, at: r.at, uid: uidFor(r.to) })),
  };
}

export function respond(rid, sub, accept) {
  const r = people.requests.find((x) => x.rid === rid && x.to === sub && x.status === 'pending');
  if (!r) return null;
  r.status = accept ? 'accepted' : 'declined';
  r.respondedAt = Date.now();
  savePeople();
  return r;
}

export function forgetPerson(sub) {
  delete devices[sub];
  delete people.ids[sub];
  people.requests = people.requests.filter((r) => r.from !== sub && r.to !== sub);
  save('devices.json', devices);
  savePeople();
}
export function forgetChannel(channelId) {
  people.requests = people.requests.filter((r) => r.channelId !== channelId);
  savePeople();
}
export function endMembership(fromSub, toSub) {
  for (const r of people.requests) if (r.from === fromSub && r.to === toSub && r.status === 'accepted') r.status = 'removed';
  savePeople();
}
