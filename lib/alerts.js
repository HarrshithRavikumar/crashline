// Emergency alert delivery: instant push notifications to contacts who
// accepted an invite (free, no setup), email (Gmail app password or any
// SMTP), and SMS (Twilio, when the account can send custom texts).
import crypto from 'node:crypto';
import webpush from 'web-push';
import nodemailer from 'nodemailer';
import { load, save, saveNow } from './store.js';

// ---- push (VAPID keys are generated once and kept in data/) ----
let vapid = load('vapid.json', null);
if (!vapid) { vapid = webpush.generateVAPIDKeys(); saveNow('vapid.json', vapid); }
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', vapid.publicKey, vapid.privateKey);
export const pushPublicKey = () => vapid.publicKey;

// channel id → { keyHash, name, createdAt, subs: [{ endpoint, keys, name, joinedAt }] }
let channels = load('channels.json', {});
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

export function createChannel(name) {
  const id = crypto.randomBytes(9).toString('base64url');
  const key = crypto.randomBytes(24).toString('base64url');
  channels[id] = { keyHash: sha(key), name: String(name || 'Your contact').slice(0, 60), createdAt: Date.now(), subs: [] };
  save('channels.json', channels);
  return { id, key };
}

export function channelPublic(id) {
  const c = channels[id];
  return c ? { name: c.name } : null;
}

export function ownsChannel(id, key) {
  const c = channels[id];
  if (!c || !key) return false;
  const a = Buffer.from(c.keyHash), b = Buffer.from(sha(key));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function renameChannel(id, key, name) {
  if (!ownsChannel(id, key)) return false;
  channels[id].name = String(name || '').slice(0, 60) || channels[id].name;
  save('channels.json', channels);
  return true;
}

export function subscribe(id, sub, name) {
  const c = channels[id];
  if (!c) return { error: 'This invite link isn’t valid anymore.' };
  if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return { error: 'bad_subscription' };
  c.subs = c.subs.filter((s) => s.endpoint !== sub.endpoint);
  c.subs.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, name: String(name || 'Contact').slice(0, 60), joinedAt: Date.now() });
  if (c.subs.length > 20) c.subs = c.subs.slice(-20);
  save('channels.json', channels);
  return { ok: true, name: c.name };
}

export function unsubscribe(id, endpoint) {
  const c = channels[id];
  if (!c) return;
  c.subs = c.subs.filter((s) => s.endpoint !== endpoint);
  save('channels.json', channels);
}

export function deleteChannel(id, key) {
  if (!ownsChannel(id, key)) return false;
  delete channels[id];
  save('channels.json', channels);
  return true;
}

export function subscribers(id, key) {
  if (!ownsChannel(id, key)) return null;
  return channels[id].subs.map((s) => ({ name: s.name, joinedAt: s.joinedAt, via: 'invite' }));
}

// ---- people on Crashline who accepted a contact request ----
// Their phones are registered to their account, so alerts reach them with no invite link.
let resolveDevices = () => [];
let dropDevice = () => {};
export function setDeviceResolver(fn, onDead) { resolveDevices = fn; dropDevice = onDead || dropDevice; }

export function addMember(id, sub) {
  const c = channels[id];
  if (!c) return false;
  c.members = [...new Set([...(c.members || []), sub])];
  save('channels.json', channels);
  return true;
}
export function removeMember(id, sub) {
  const c = channels[id];
  if (!c) return false;
  c.members = (c.members || []).filter((m) => m !== sub);
  save('channels.json', channels);
  return true;
}
export const membersOf = (id) => channels[id]?.members || [];
export const channelsWithMember = (sub) => Object.entries(channels).filter(([, c]) => (c.members || []).includes(sub)).map(([id, c]) => ({ id, name: c.name }));

const PUSH_OPTS = { TTL: 6 * 3600, urgency: 'high' };

// Send one payload to a list of push subscriptions; report dead ones.
export async function pushToSubs(subs, payload) {
  if (process.env.PUSH_LOG) console.log('PUSH', JSON.stringify(payload));
  let sent = 0;
  const dead = [];
  const seen = new Set();
  await Promise.all(subs.filter((s) => s?.endpoint && !seen.has(s.endpoint) && seen.add(s.endpoint)).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload), PUSH_OPTS);
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) dead.push(s.endpoint);
      else console.warn('push failed:', e.statusCode || e.message);
    }
  }));
  return { sent, total: seen.size, dead };
}

async function sendPush(id, payload) {
  const c = channels[id];
  if (!c) return { sent: 0, total: 0 };
  const memberDevices = (c.members || []).flatMap((sub) => resolveDevices(sub));
  const r = await pushToSubs([...c.subs, ...memberDevices], payload);
  if (r.dead.length) {
    c.subs = c.subs.filter((s) => !r.dead.includes(s.endpoint));
    save('channels.json', channels);
    r.dead.forEach((ep) => dropDevice(ep));
  }
  return { sent: r.sent, total: r.total };
}

// Number of people who'd get a push for this channel (invite subscribers + members).
export function reachOf(id) {
  const c = channels[id];
  if (!c) return { invited: 0, members: 0 };
  return { invited: c.subs.length, members: (c.members || []).length };
}

// ---- email ----
const smtp = process.env.SMTP_USER && process.env.SMTP_PASS
  ? nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })
  : null;
export const emailReady = () => !!smtp;

async function sendEmails(contacts, subject, text) {
  const to = contacts.map((c) => String(c.email || '').trim()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)).slice(0, 5);
  if (!smtp || !to.length) return { sent: 0, total: to.length };
  let sent = 0;
  await Promise.all(to.map((addr) => smtp.sendMail({
    from: `"Crashline Alerts" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
    to: addr, subject, text,
  }).then(() => { sent++; }).catch((e) => console.warn('email failed:', addr, e.message))));
  return { sent, total: to.length };
}

// ---- SMS ----
export const smsReady = () => !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);

const TWILIO_HINTS = {
  21608: 'This Twilio trial can only text numbers you verified in the Twilio console.',
  21610: 'This contact replied STOP and has opted out of texts.',
  21211: 'This phone number isn’t valid.',
  30034: 'Twilio blocked it: US numbers need A2P 10DLC registration (or use a verified toll-free number).',
  30032: 'Twilio blocked it: the toll-free number isn’t verified yet.',
};

async function sendSms(contacts, body) {
  const phones = contacts.map((c) => String(c.phone || '')).filter((p) => p.length >= 8).slice(0, 5);
  if (!smsReady() || !phones.length) return { sent: 0, total: phones.length, errors: [] };
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM: from } = process.env;
  let sent = 0;
  const errors = [];
  await Promise.all(phones.map(async (to) => {
    try {
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: to, From: from, Body: body.slice(0, 1500) }),
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) { sent++; return; }
      const j = await r.json().catch(() => ({}));
      errors.push(TWILIO_HINTS[j.code] || j.message || `Twilio error ${r.status}`);
    } catch (e) {
      errors.push(e.message);
    }
  }));
  return { sent, total: phones.length, errors: [...new Set(errors)] };
}

// ---- texts from the user's own iPhone ----
// The server emails the user's own iCloud address with the subject
// "CRASHLINE SOS". An iPhone Shortcuts automation (Email trigger, Run
// Immediately) then sends a real text from their own number.
export const SELF_TEXT_SUBJECT = 'CRASHLINE SOS';

// What the shared "Crashline SOS" Shortcut should send. Each phone has a random
// token; the trigger email's subject carries it ("CRASHLINE SOS <token>"), and the
// Shortcut fetches /s/<token> to get the recipients and the message. That way one
// Shortcut works for everyone and contacts are managed in the app, not in Shortcuts.
const SELF_TTL = 30 * 60_000;
const selfJobs = new Map();
export const validSelfToken = (t) => /^[A-Za-z0-9_-]{12,40}$/.test(String(t || ''));
export function setSelfJob(token, to, text) {
  if (!validSelfToken(token)) return false;
  const nums = (Array.isArray(to) ? to : [])
    .map((n) => String(n || '').replace(/[^\d+]/g, ''))
    .filter((n) => n.replace(/\D/g, '').length >= 7);
  const now = Date.now();
  for (const [k, v] of selfJobs) if (now - v.at > SELF_TTL) selfJobs.delete(k);
  selfJobs.set(token, { to: [...new Set(nums)].slice(0, 6), text: String(text || '').slice(0, 1200), at: now });
  return true;
}
export function getSelfJob(token) {
  const j = selfJobs.get(String(token || ''));
  return j && Date.now() - j.at < SELF_TTL ? j : null;
}

export async function sendSelfTrigger(selfEmail, token) {
  const addr = String(selfEmail || '').trim();
  if (!smtp || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return { sent: 0, total: addr ? 1 : 0 };
  try {
    // Keep this email plain and link-free: iCloud's spam filter rejects messages with
    // unfamiliar links (554 5.7.1 HM07). The Shortcut fetches the real text itself.
    await smtp.sendMail({
      from: `"Crashline" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to: addr,
      subject: validSelfToken(token) ? `${SELF_TEXT_SUBJECT} ${token}` : SELF_TEXT_SUBJECT,
      text: 'Crashline trigger for your iPhone Shortcut. You can delete this email.',
    });
    return { sent: 1, total: 1 };
  } catch (e) {
    console.warn('self-text trigger failed:', e.message);
    return { sent: 0, total: 1, error: e.message };
  }
}

// ---- one call that uses every channel available ----
export async function deliverAlert({ contacts = [], message, title, url, channel, selfEmail, selfToken, push: pushOverride }) {
  if (selfEmail && selfToken) setSelfJob(selfToken, contacts.map((c) => c?.phone), message);
  const pushOk = channel?.id && ownsChannel(channel.id, channel.key);
  const payload = pushOverride || { title, body: message.length > 220 ? `${message.slice(0, 217)}…` : message, url, tag: `crashline-${Date.now()}` };
  const [push, email, sms, self] = await Promise.all([
    pushOk ? sendPush(channel.id, payload) : { sent: 0, total: 0 },
    sendEmails(contacts, title, message),
    sendSms(contacts, message),
    selfEmail ? sendSelfTrigger(selfEmail, selfToken) : { sent: 0, total: 0 },
  ]);
  return { sent: push.sent + email.sent + sms.sent + self.sent > 0, push, email, sms, self };
}
