// Live crash incidents: what a contact sees when they open an alert.
// The crashed phone keeps updating its location; contacts can reply
// ("I'm on my way") and the crashed phone sees those replies.
import crypto from 'node:crypto';
import { load, save } from './store.js';

const TTL_MS = 48 * 3600 * 1000;
let incidents = load('incidents.json', {});
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const clip = (v, n) => (v == null ? null : String(v).slice(0, n));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

function prune() {
  const now = Date.now();
  let changed = false;
  for (const [id, inc] of Object.entries(incidents)) {
    if (now - inc.createdAt > TTL_MS) { delete incidents[id]; changed = true; }
  }
  if (changed) save('incidents.json', incidents);
}
setInterval(prune, 3600 * 1000).unref?.();

export function createIncident(body) {
  prune();
  const id = crypto.randomBytes(9).toString('base64url');
  const view = crypto.randomBytes(12).toString('base64url');   // in the link contacts get
  const key = crypto.randomBytes(24).toString('base64url');    // stays on the crashed phone
  const p = body.position;
  incidents[id] = {
    viewHash: sha(view), keyHash: sha(key), createdAt: Date.now(), status: 'active',
    channel: clip(body.channelId, 32), viewToken: view,
    name: clip(body.name, 60) || 'Your contact',
    phone: clip(body.phone, 20),
    mode: clip(body.mode, 20), doing: clip(body.doing, 40),
    detection: clip(body.detection, 160),
    medical: clip(body.medical, 300), vehicle: clip(body.vehicle, 120),
    language: clip(body.language, 40),
    crashedAt: num(body.crashedAt) || Date.now(),
    position: p && num(p.lat) != null ? { lat: num(p.lat), lng: num(p.lng), acc: num(p.acc), at: Date.now() } : null,
    track: [],
    acks: [],
    safeAt: null,
  };
  if (incidents[id].position) incidents[id].track.push(incidents[id].position);
  save('incidents.json', incidents);
  return { id, view, key };
}

const can = (inc, field, secret) => {
  if (!inc || !secret) return false;
  const a = Buffer.from(inc[field]), b = Buffer.from(sha(secret));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

export function updateLocation(id, key, p) {
  const inc = incidents[id];
  if (!can(inc, 'keyHash', key) || num(p?.lat) == null) return false;
  inc.position = { lat: num(p.lat), lng: num(p.lng), acc: num(p.acc), at: Date.now() };
  inc.track.push(inc.position);
  if (inc.track.length > 120) inc.track = inc.track.slice(-120);
  save('incidents.json', incidents);
  return true;
}

export function markSafe(id, key) {
  const inc = incidents[id];
  if (!can(inc, 'keyHash', key)) return null;
  inc.status = 'safe';
  inc.safeAt = Date.now();
  save('incidents.json', incidents);
  return inc;
}

export function viewIncident(id, view) {
  const inc = incidents[id];
  if (!can(inc, 'viewHash', view)) return null;
  const { viewHash, keyHash, viewToken, channel, ...rest } = inc;
  return rest;
}

export function addAck(id, view, body) {
  const inc = incidents[id];
  if (!can(inc, 'viewHash', view)) return false;
  const status = ['seen', 'on_way', 'called_911', 'reached'].includes(body?.status) ? body.status : 'seen';
  const name = clip(body?.name, 40) || 'A contact';
  const existing = inc.acks.find((a) => a.name === name);
  if (existing) { existing.status = status; existing.at = Date.now(); } else inc.acks.push({ name, status, at: Date.now() });
  if (inc.acks.length > 20) inc.acks = inc.acks.slice(-20);
  save('incidents.json', incidents);
  return true;
}

export function ownerView(id, key) {
  const inc = incidents[id];
  if (!can(inc, 'keyHash', key)) return null;
  return { status: inc.status, acks: inc.acks };
}

export const ownsIncident = (id, key) => can(incidents[id], 'keyHash', key);

// Newest incident for an alert channel, for the fixed link in self-texts.
export function latestFor(channelId) {
  let best = null, bestId = null;
  for (const [id, inc] of Object.entries(incidents)) {
    if (inc.channel === channelId && (!best || inc.createdAt > best.createdAt)) { best = inc; bestId = id; }
  }
  return best ? { id: bestId, view: best.viewToken } : null;
}

export function deleteForChannel(channelId) {
  for (const [id, inc] of Object.entries(incidents)) if (inc.channel === channelId) delete incidents[id];
  save('incidents.json', incidents);
}

// Server-side only (no secrets needed): used for the 'no response' re-alert.
export function incidentState(id) {
  const inc = incidents[id];
  return inc ? { status: inc.status, acks: inc.acks, name: inc.name, position: inc.position, crashedAt: inc.crashedAt, phone: inc.phone, place: inc.place } : null;
}
export function setPlace(id, place) {
  if (incidents[id] && place) { incidents[id].place = place; save('incidents.json', incidents); }
}
