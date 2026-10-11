import './lib/env.js'; // must be first: loads .env
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedEvents } from './lib/seed.js';
import { signUp, signIn, signOutToken, currentUser, deleteAccount, AUTH0, auth0Ready } from './lib/accounts.js';
import {
  deliverAlert, smsReady, emailReady, pushPublicKey,
  createChannel, channelPublic, renameChannel, subscribe, unsubscribe, subscribers,
  deleteChannel, sendSelfTrigger, setSelfJob, getSelfJob, validSelfToken, setDeviceResolver, addMember, removeMember, membersOf, channelsWithMember, pushToSubs, ownsChannel, reachOf,
} from './lib/alerts.js';
import { createIncident, updateLocation, markSafe, viewIncident, addAck, ownerView, latestFor, deleteForChannel, incidentState, setPlace } from './lib/incidents.js';
import { registerDevice, unregisterDevice, devicesOf, dropEndpoint, uidFor, subForUid, lookup, createRequest, requestsFor, respond, forgetPerson, forgetChannel, endMembership } from './lib/people.js';
import { placeName } from './lib/geo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
setDeviceResolver(devicesOf, dropEndpoint);

const PORT = Number(process.env.PORT) || 3000;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
// Use whichever key is set. If both are, AI_PROVIDER=gemini|anthropic picks one (Anthropic by default).
const aiProvider = () => {
  const want = (process.env.AI_PROVIDER || '').toLowerCase();
  if (want === 'gemini' && process.env.GEMINI_API_KEY) return 'gemini';
  if (want === 'anthropic' && process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  return null;
};
const DATA_FILE = path.join(__dirname, 'data', 'events.json');

const app = express();
app.set('trust proxy', 1); // behind Render's proxy, so req.ip is the real visitor
app.use(express.json({ limit: '100kb' }));

// Once the app is public, keep strangers from burning through the AI key or texting credits.
function rateLimit(max, windowMs) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const list = (hits.get(req.ip) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) return res.status(429).json({ error: 'rate_limited', sent: false, reason: 'rate_limited' });
    list.push(now);
    hits.set(req.ip, list);
    if (hits.size > 5000) hits.clear();
    next();
  };
}
app.use(['/api/translate', '/api/guidance'], rateLimit(40, 60_000));
app.use('/api/alert', rateLimit(5, 60_000));
app.use('/api/events', rateLimit(60, 60_000));
app.use(['/api/me', '/api/evidence', '/api/channels'], rateLimit(30, 60_000));
app.use('/api/incidents', rateLimit(120, 60_000));
app.use('/api/selftext', rateLimit(6, 60_000));
app.use(['/api/people', '/api/devices'], rateLimit(40, 60_000));
app.use('/api/auth', rateLimit(10, 60_000));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, file) { if (file.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache'); },
}));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ai: !!aiProvider(), aiProvider: aiProvider(), sms: smsReady(), email: emailReady(), push: true, events: events.length });
});

// ---------------------------------------------------------------- alerts
// One call, every channel: instant push to contacts who accepted an invite,
// email, and SMS. Whatever is set up gets used.
app.post('/api/alert', async (req, res) => {
  const { contacts = [], message, title, url, channel, selfEmail, selfToken, details, incidentId } = req.body || {};
  if (!Array.isArray(contacts) || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ sent: false, reason: 'bad_request' });
  }
  const r = await deliverAlert({
    contacts: contacts.slice(0, 5),
    message: message.slice(0, 1500),
    title: String(title || 'Crashline alert').slice(0, 120),
    url: typeof url === 'string' && /^https?:\/\//.test(url) ? url : undefined,
    channel,
    selfEmail: typeof selfEmail === 'string' ? selfEmail.slice(0, 120) : undefined,
    selfToken: validSelfToken(selfToken) ? selfToken : undefined,
    push: details ? await crashPush(details, url) : undefined,
  });
  if (details && incidentId && r.push.total) scheduleNoResponse(String(incidentId), channel, url, details);
  const anyChannel = r.push.total || (emailReady() && (r.email.total || r.self.total)) || (smsReady() && r.sms.total);
  res.json({ ...r, reason: r.sent ? undefined : anyChannel ? 'delivery_failed' : 'no_channels' });
});

// ---- urgent, detailed push for a crash ----
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
function clockTime(ms, tz) {
  try { return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz || 'America/New_York' }); }
  catch { return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
}
async function crashPush(d, url) {
  const p = d.position;
  const place = p ? await placeName(Number(p.lat), Number(p.lng)) : null;
  const lines = [`${cap(String(d.doing || 'traveling'))} · ${clockTime(Number(d.crashedAt) || Date.now(), d.tz)} · didn’t cancel the crash alarm`];
  lines.push(place ? `📍 ${place}` : p ? '📍 Location shared, tap to see it' : '📍 Location unavailable');
  if (d.medical) lines.push(`⚕️ ${String(d.medical).slice(0, 80)}`);
  if (d.language && d.language !== 'English') lines.push(`🗣️ Speaks ${d.language}`);
  lines.push('Tap for live map, call, and reply');
  return {
    kind: 'crash',
    title: `🚨 ${String(d.name || 'Your contact').slice(0, 40)} may have crashed`,
    body: lines.join('\n'),
    url, tag: `crash-${d.incidentId || Date.now()}`,
    actions: [{ action: 'open', title: 'Open live map' }, { action: 'onway', title: 'I’m on my way' }],
  };
}

// If nobody replies within 2 minutes, alert everyone again, louder.
function scheduleNoResponse(incidentId, channel, url, d) {
  setTimeout(async () => {
    const st = incidentState(incidentId);
    if (!st || st.status !== 'active' || st.acks.length) return;
    const mins = Math.max(1, Math.round((Date.now() - st.crashedAt) / 60000));
    const loc = st.position ? `Location updated ${Math.max(0, Math.round((Date.now() - st.position.at) / 60000))} min ago${st.place ? ` · ${st.place}` : ''}.` : 'Location unavailable.';
    await deliverAlert({
      contacts: [], message: '', channel,
      push: {
        kind: 'crash', title: `⚠️ No one has responded: ${st.name} may need help`,
        body: `Crash detected ${mins} min ago and no one has replied yet.\n📍 ${loc}\nTap to open the live map, or call 911.`,
        url, tag: `crash-${incidentId}-2`,
        actions: [{ action: 'open', title: 'Open live map' }, { action: 'onway', title: 'I’m on my way' }],
      },
    }).catch(() => {});
  }, Number(process.env.NO_RESPONSE_MS) || 120000).unref?.();
}

// Live incident pages: richer than a location pin. Contacts see a live map,
// details, call buttons, and can reply; the crashed phone sees replies.
app.post('/api/incidents', (req, res) => {
  const r = createIncident(req.body || {});
  const p = req.body?.position;
  if (p) placeName(Number(p.lat), Number(p.lng)).then((name) => setPlace(r.id, name));
  res.json(r);
});
app.post('/api/incidents/:id/location', (req, res) => res.json({ ok: updateLocation(req.params.id, req.body?.key, req.body) }));
app.post('/api/incidents/:id/status', (req, res) => {
  const r = ownerView(req.params.id, req.body?.key);
  if (!r) return res.status(403).json({ error: 'forbidden' });
  res.json(r);
});
app.post('/api/incidents/:id/safe', async (req, res) => {
  const inc = markSafe(req.params.id, req.body?.key);
  if (!inc) return res.status(403).json({ error: 'forbidden' });
  const { channel, contacts = [] } = req.body || {};
  const time = new Date(inc.safeAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: process.env.TZ || 'America/New_York' });
  await deliverAlert({
    contacts: Array.isArray(contacts) ? contacts.slice(0, 5) : [],
    title: `${inc.name} is safe`,
    message: `Update from Crashline: ${inc.name} marked themselves safe at ${time}.`,
    url: typeof req.body?.url === 'string' && /^https?:\/\//.test(req.body.url) ? req.body.url : undefined,
    channel,
  }).catch(() => {});
  res.json({ ok: true });
});
app.get('/api/incidents/:id', (req, res) => {
  const inc = viewIncident(req.params.id, String(req.query.v || ''));
  if (!inc) return res.status(404).json({ error: 'not_found' });
  res.json(inc);
});
app.post('/api/incidents/:id/ack', (req, res) => res.json({ ok: addAck(req.params.id, String(req.query.v || ''), req.body) }));

// Fixed link used in texts sent by the iPhone Shortcut: always opens the
// newest live alert for this person.
app.get('/l/:channel', (req, res) => {
  const inc = latestFor(String(req.params.channel).slice(0, 32));
  if (!inc) return res.status(404).send('<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;background:#0b0d12;color:#eef1f7;padding:24px"><h2>No active Crashline alert</h2><p>There’s no recent alert for this person.</p></body>');
  res.redirect(302, `/alert.html?i=${encodeURIComponent(inc.id)}&v=${encodeURIComponent(inc.view)}`);
});

// Test the iPhone auto-text Shortcut: queues a test text to the user's own
// number, then sends the trigger email.
app.post('/api/selftext/test', async (req, res) => {
  if (!emailReady()) return res.status(503).json({ error: 'email_not_configured' });
  const { email, token, phone } = req.body || {};
  if (validSelfToken(token)) setSelfJob(token, [phone], 'Crashline test: your auto-text is set up. If you crash and don’t cancel, your contacts get a text like this with your location and a live map.');
  const r = await sendSelfTrigger(email, token);
  res.status(r.sent ? 200 : 400).json(r);
});

// Read by the shared "Crashline SOS" iPhone Shortcut: who to text and what to say.
app.get('/s/:token', rateLimit(30, 60_000), (req, res) => {
  const j = getSelfJob(req.params.token);
  res.set('Cache-Control', 'no-store');
  res.json(j ? { to: j.to, text: j.text } : { to: [], text: '' });
});

// Contact invites for instant push alerts.
app.get('/api/push/key', (_req, res) => res.json({ key: pushPublicKey() }));
app.post('/api/channels', (req, res) => res.json(createChannel(req.body?.name)));
app.get('/api/channels/:id', (req, res) => {
  const c = channelPublic(req.params.id);
  if (!c) return res.status(404).json({ error: 'not_found' });
  res.json(c);
});
app.post('/api/channels/:id/name', (req, res) => {
  res.json({ ok: renameChannel(req.params.id, req.body?.key, req.body?.name) });
});
app.post('/api/channels/:id/subscribe', (req, res) => {
  const r = subscribe(req.params.id, req.body?.subscription, req.body?.name);
  res.status(r.error ? 400 : 200).json(r);
});
app.post('/api/channels/:id/delete', (req, res) => {
  const ok = deleteChannel(req.params.id, req.body?.key);
  if (ok) { deleteForChannel(req.params.id); forgetChannel(req.params.id); }
  res.json({ ok });
});
app.post('/api/channels/:id/unsubscribe', (req, res) => {
  unsubscribe(req.params.id, String(req.body?.endpoint || ''));
  res.json({ ok: true });
});
app.post('/api/channels/:id/subscribers', (req, res) => {
  const list = subscribers(req.params.id, req.body?.key);
  if (!list) return res.status(403).json({ error: 'forbidden' });
  const members = membersOf(req.params.id).map((sub) => ({
    name: profiles[sub]?.profile?.name || 'Crashline user', via: 'account', uid: uidFor(sub), devices: devicesOf(sub).length,
  }));
  res.json({ subscribers: [...list, ...members] });
});
// Per-invite manifest so an iPhone that adds the invite page to its Home
// Screen opens straight back into it (iPhone push needs a Home Screen app).
app.get('/api/manifest/join', (req, res) => {
  const c = String(req.query.c || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  const name = channelPublic(c)?.name || 'Crashline';
  res.type('application/manifest+json').json({
    id: `/join/${c}`, name: `Crashline · ${name}`, short_name: 'Crashline', start_url: `/join.html?c=${c}`, scope: '/',
    display: 'standalone', background_color: '#0b0d12', theme_color: '#0b0d12',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  });
});

// ---------------------------------------------------------------- AI
async function askClaude(system, prompt, maxTokens = 700) {
  if (aiProvider() === 'gemini') return askGemini(system, prompt, maxTokens);
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`ai_${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const json = extractJson(text);
  if (!json) throw new Error('bad_ai_output');
  return json;
}

async function askGemini(system, prompt, maxTokens) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      // Extra room in case the model spends tokens thinking before it answers.
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: maxTokens + 1500 },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`gemini_${r.status}: ${(await r.text()).slice(0, 300)}`);
  const data = await r.json();
  const text = (data.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
  const json = extractJson(text);
  if (!json) throw new Error(`bad_ai_output: ${text.slice(0, 200)}`);
  return json;
}

const LANGUAGE_NAMES = new Set(['English', 'Spanish', 'Chinese (Simplified)', 'Vietnamese', 'Korean', 'Arabic', 'Haitian Creole', 'Portuguese', 'French', 'Hindi']);

const GUIDE_SYSTEM = `You are Crashline, a calm assistant for someone in the United States who was just in a crash. They may have been driving, or biking, riding a scooter, using a wheelchair, or walking when a vehicle hit them.
Rules:
- Safety first. Smoke, fire, or fuel smell: get away, then call 911. Anyone hurt, unsure, or a head hit: call 911. A hit-and-run: call 911.
- Basic first aid only. Never diagnose. Never tell someone they can skip 911 or medical care when anyone may be hurt.
- Do not move someone with neck or back pain unless there is immediate danger.
- Plain, short sentences a shaken person can follow. General information only, no legal advice beyond common practice.
- Reply with JSON only, no prose and no code fences.`;

app.post('/api/guidance', async (req, res) => {
  if (!aiProvider()) return res.status(503).json({ error: 'ai_not_configured' });
  const { triage = {}, context = {}, question } = req.body || {};
  const language = LANGUAGE_NAMES.has(req.body?.language) ? req.body.language : 'English';
  const situation = JSON.stringify({ triage, context });
  const prompt = question
    ? `Situation: ${situation}\nThey ask: "${String(question).slice(0, 500)}"\nAnswer in ${language}, in at most 60 words, as {"answer": "..."}.`
    : `Situation: ${situation}\nGive the next steps, most urgent first, written in ${language}, as {"steps":[{"title":"short imperative","detail":"one sentence, under 25 words","urgent":true|false}]} with 4 to 7 steps.`;
  try {
    const json = await askClaude(GUIDE_SYSTEM, prompt);
    if (question) {
      if (typeof json.answer !== 'string') throw new Error('bad_ai_output');
      return res.json({ answer: json.answer });
    }
    if (!Array.isArray(json.steps)) throw new Error('bad_ai_output');
    res.json({
      steps: json.steps.filter((s) => s && typeof s.title === 'string')
        .map((s) => ({ title: s.title, detail: String(s.detail || ''), urgent: !!s.urgent })),
    });
  } catch (e) {
    console.warn('guidance:', e.message);
    res.status(502).json({ error: 'ai_failed' });
  }
});

const TRANSLATE_SYSTEM = `You translate a spoken conversation at the scene of a traffic crash, between a person and a police officer or another driver.
Translate faithfully and naturally, in the spoken register. Keep names, numbers, plates, and addresses exactly. Do not add, soften, explain, or answer anything.
If the input has several lines, keep the same number of lines in the same order.
Reply with JSON only: {"translation": "..."}`;

app.post('/api/translate', async (req, res) => {
  const { text, from, to } = req.body || {};
  if (typeof text !== 'string' || !text.trim() || !LANGUAGE_NAMES.has(from) || !LANGUAGE_NAMES.has(to)) {
    return res.status(400).json({ error: 'bad_request' });
  }
  if (!aiProvider()) return res.status(503).json({ error: 'ai_not_configured' });
  try {
    const json = await askClaude(TRANSLATE_SYSTEM, `Translate from ${from} to ${to}:\n"""\n${text.slice(0, 2000)}\n"""`, 900);
    if (typeof json.translation !== 'string') throw new Error('bad_ai_output');
    res.json({ translation: json.translation });
  } catch (e) {
    console.warn('translate:', e.message);
    res.status(502).json({ error: 'ai_failed' });
  }
});

// ---------------------------------------------------------------- accounts
// Email + password works out of the box; Google and Apple come through Auth0.
const PROFILES_FILE = path.join(__dirname, 'data', 'profiles.json');
const EVIDENCE_FILE = path.join(__dirname, 'data', 'evidence.json');
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFile(file, JSON.stringify(value), () => {}); };
let profiles = readJson(PROFILES_FILE, {});
let evidence = readJson(EVIDENCE_FILE, []);

app.get('/api/config', (_req, res) => {
  res.json({
    auth: auth0Ready() ? { domain: AUTH0.domain, clientId: AUTH0.clientId, apple: AUTH0.apple } : null,
    accounts: true,
    ai: !!aiProvider(),
    sms: smsReady(),
    email: emailReady(),
    emailFrom: emailReady() ? (process.env.SMTP_FROM || process.env.SMTP_USER) : null,
    shortcutUrl: /^https:\/\/(www\.)?icloud\.com\/shortcuts\//.test(process.env.SHORTCUT_URL || '') ? process.env.SHORTCUT_URL : null,
    push: true,
  });
});

app.post('/api/auth/signup', async (req, res) => {
  const r = await signUp(req.body || {});
  res.status(r.error ? (r.code || 400) : 200).json(r);
});
app.post('/api/auth/login', async (req, res) => {
  const r = await signIn(req.body || {});
  res.status(r.error ? (r.code || 400) : 200).json(r);
});
app.post('/api/auth/logout', (req, res) => {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) signOutToken(h.slice(7));
  res.json({ ok: true });
});
app.get('/api/auth/me', async (req, res) => {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: 'signed_out' });
  res.json({ user });
});

app.get('/api/me', async (req, res) => {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: 'signed_out' });
  res.json(profiles[user.sub] || { profile: null, settings: null, updatedAt: 0 });
});

app.put('/api/me', async (req, res) => {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: 'signed_out' });
  const { profile, settings, updatedAt } = req.body || {};
  if (!profile || typeof profile !== 'object' || JSON.stringify(req.body).length > 20000) return res.status(400).json({ error: 'bad_request' });
  profiles[user.sub] = { profile, settings: settings || null, updatedAt: Number(updatedAt) || Date.now(), email: user.email || profiles[user.sub]?.email || null };
  writeJson(PROFILES_FILE, profiles);
  res.json({ ok: true });
});

// Delete everything the server holds for this person (and the email account itself).
app.delete('/api/me', async (req, res) => {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: 'signed_out' });
  delete profiles[user.sub];
  writeJson(PROFILES_FILE, profiles);
  for (const c of channelsWithMember(user.sub)) removeMember(c.id, user.sub);
  forgetPerson(user.sub);
  if (user.provider === 'email') deleteAccount(user.sub);
  res.json({ ok: true, accountDeleted: user.provider === 'email' });
});

// Tamper evidence: the phone sends only a SHA-256 fingerprint of its black-box
// recording; the server records when it first saw it. No video leaves the phone.
app.post('/api/evidence', (req, res) => {
  const hash = String(req.body?.hash || '');
  if (!/^[a-f0-9]{64}$/.test(hash)) return res.status(400).json({ error: 'bad_request' });
  let entry = evidence.find((e) => e.hash === hash);
  if (!entry) {
    entry = { hash, receivedAt: Date.now() };
    evidence.push(entry);
    if (evidence.length > 10000) evidence = evidence.slice(-10000);
    writeJson(EVIDENCE_FILE, evidence);
  }
  res.json(entry);
});

// ---------------------------------------------------------------- people on Crashline
const needUser = async (req, res) => {
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: 'signed_out' }); return null; }
  return user;
};
const displayName = (sub, fallback) => profiles[sub]?.profile?.name || fallback || 'Crashline user';
const notify = (sub, payload) => pushToSubs(devicesOf(sub), payload).then((r) => r.dead.forEach(dropEndpoint)).catch(() => {});

// This phone gets alerts for this account (from anyone who added you).
app.post('/api/devices', async (req, res) => {
  const user = await needUser(req, res); if (!user) return;
  res.json({ ok: registerDevice(user.sub, req.body?.subscription) });
});
app.post('/api/devices/remove', async (req, res) => {
  const user = await needUser(req, res); if (!user) return;
  unregisterDevice(user.sub, String(req.body?.endpoint || ''));
  res.json({ ok: true });
});

app.post('/api/people/lookup', async (req, res) => {
  const user = await needUser(req, res); if (!user) return;
  const phones = Array.isArray(req.body?.phones) ? req.body.phones.slice(0, 500) : [];
  const emails = Array.isArray(req.body?.emails) ? req.body.emails.slice(0, 500) : [];
  res.json({ matches: lookup(profiles, user.sub, { phones, emails }) });
});

app.post('/api/people/request', async (req, res) => {
  const user = await needUser(req, res); if (!user) return;
  const toSub = subForUid(String(req.body?.uid || ''));
  const ch = req.body?.channel;
  if (!toSub || toSub === user.sub) return res.status(400).json({ error: 'That person can’t be added.' });
  if (!ch?.id || !ownsChannel(ch.id, ch.key)) return res.status(400).json({ error: 'bad_channel' });
  const fromName = displayName(user.sub, user.name);
  const { request, existing } = createRequest({ fromSub: user.sub, fromName, toSub, toName: displayName(toSub), channelId: ch.id });
  if (!existing) {
    notify(toSub, {
      kind: 'request', title: `${fromName} added you as an emergency contact`,
      body: 'Accept to get an alert with their live location if they’re ever in a crash.',
      url: '/?people=1', tag: `req-${request.rid}`,
    });
  }
  res.json({ ok: true, status: request.status });
});

app.get('/api/people/requests', async (req, res) => {
  const user = await needUser(req, res); if (!user) return;
  res.json({ ...requestsFor(user.sub), protecting: channelsWithMember(user.sub), devices: devicesOf(user.sub).length });
});

app.post('/api/people/requests/:rid/respond', async (req, res) => {
  const user = await needUser(req, res); if (!user) return;
  const r = respond(req.params.rid, user.sub, !!req.body?.accept);
  if (!r) return res.status(404).json({ error: 'not_found' });
  if (r.status === 'accepted') {
    addMember(r.channelId, user.sub);
    notify(r.from, {
      kind: 'request', title: `${displayName(user.sub, user.name)} is now your emergency contact`,
      body: 'They’ll get an alert with your live location if Crashline detects a crash.', url: '/', tag: `acc-${r.rid}`,
    });
  }
  res.json({ ok: true, status: r.status });
});

// A member stops getting someone's alerts, or an owner removes a member.
app.post('/api/people/leave', async (req, res) => {
  const user = await needUser(req, res); if (!user) return;
  removeMember(String(req.body?.channelId || ''), user.sub);
  res.json({ ok: true });
});
app.post('/api/people/remove', async (req, res) => {
  const user = await needUser(req, res); if (!user) return;
  const ch = req.body?.channel;
  const sub = subForUid(String(req.body?.uid || ''));
  if (!ch?.id || !ownsChannel(ch.id, ch.key) || !sub) return res.status(400).json({ error: 'bad_request' });
  removeMember(ch.id, sub);
  endMembership(user.sub, sub);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- city map
const MODES = new Set(['car', 'bike', 'scooter', 'wheelchair', 'walk']);
const KINDS = new Set(['near_miss', 'close_call', 'crash']);
const WEIGHT = { crash: 5, near_miss: 1, close_call: 1.5 };
const snap = (v) => Number((Math.round(v / 0.0005) * 0.0005).toFixed(4));

let events = loadEvents();
let latestLive = null;
let saveTimer = null;

function loadEvents() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { /* first run */ }
  const seeded = seedEvents();
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(seeded));
  return seeded;
}
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(DATA_FILE, JSON.stringify(events), () => {}), 500);
}

app.post('/api/events', (req, res) => {
  const list = Array.isArray(req.body?.events) ? req.body.events.slice(0, 50) : [];
  let accepted = 0;
  for (const e of list) {
    const lat = Number(e.lat), lng = Number(e.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    if (!MODES.has(e.mode) || !KINDS.has(e.kind)) continue;
    const hour = typeof e.hour === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}$/.test(e.hour) ? e.hour : new Date().toISOString().slice(0, 13);
    const severity = Number.isFinite(Number(e.severity)) && e.severity !== null ? Math.min(20, Math.max(0, Number(e.severity))) : null;
    const ev = { lat: snap(lat), lng: snap(lng), mode: e.mode, kind: e.kind, severity, hour, place: null, sample: false, receivedAt: Date.now() };
    events.push(ev);
    latestLive = { ...ev };
    accepted++;
  }
  if (events.length > 50000) events = events.slice(-50000);
  if (accepted) saveSoon();
  res.json({ accepted });
});

app.get('/api/hotspots', (req, res) => {
  const mode = MODES.has(req.query.mode) ? req.query.mode : 'all';
  const includeSample = req.query.sample !== '0';
  const pool = events.filter((e) => (includeSample || !e.sample) && (mode === 'all' || e.mode === mode));

  const cells = new Map();
  const stats = { total: 0, crash: 0, near_miss: 0, close_call: 0, live: 0 };
  for (const e of pool) {
    const id = `${Math.round(e.lat / 0.0008)}:${Math.round(e.lng / 0.0008)}`;
    let c = cells.get(id);
    if (!c) { c = { id, sumLat: 0, sumLng: 0, total: 0, score: 0, live: 0, kinds: { crash: 0, near_miss: 0, close_call: 0 }, modes: {}, places: {} }; cells.set(id, c); }
    c.sumLat += e.lat; c.sumLng += e.lng; c.total++;
    c.score += WEIGHT[e.kind];
    c.kinds[e.kind]++;
    c.modes[e.mode] = (c.modes[e.mode] || 0) + 1;
    if (e.place) c.places[e.place] = (c.places[e.place] || 0) + 1;
    if (!e.sample) c.live++;
    stats.total++; stats[e.kind]++; if (!e.sample) stats.live++;
  }
  const out = [...cells.values()].map((c) => ({
    id: c.id,
    lat: Number((c.sumLat / c.total).toFixed(5)),
    lng: Number((c.sumLng / c.total).toFixed(5)),
    label: Object.entries(c.places).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
    total: c.total, score: Number(c.score.toFixed(1)), live: c.live, kinds: c.kinds, modes: c.modes,
  })).sort((a, b) => b.score - a.score);

  res.json({ cells: out, stats, latest: latestLive, sampleIncluded: includeSample });
});

// Named spots (from sample data) so live reports read "Near Peachtree St NE & 10th St NE".
const PLACES = (() => {
  const acc = new Map();
  for (const e of events) {
    if (!e.place) continue;
    const p = acc.get(e.place) || { place: e.place, lat: 0, lng: 0, n: 0 };
    p.lat += e.lat; p.lng += e.lng; p.n++;
    acc.set(e.place, p);
  }
  return [...acc.values()].map((p) => ({ place: p.place, lat: p.lat / p.n, lng: p.lng / p.n }));
})();
function nearestPlace(lat, lng) {
  let best = null, bestD = Infinity;
  for (const p of PLACES) {
    const d = Math.hypot(p.lat - lat, (p.lng - lng) * Math.cos((lat * Math.PI) / 180));
    if (d < bestD) { bestD = d; best = p; }
  }
  return best && bestD < 0.0025 ? `Near ${best.place}` : null;
}

app.get('/api/recent', (req, res) => {
  const includeSample = req.query.sample !== '0';
  const live = events.filter((e) => !e.sample && e.receivedAt).slice(-20).reverse();
  const sample = includeSample
    ? events.filter((e) => e.sample).sort((a, b) => b.hour.localeCompare(a.hour)).slice(0, Math.max(0, 12 - live.length))
    : [];
  res.json({
    items: [...live, ...sample].map((e) => ({
      mode: e.mode, kind: e.kind, lat: e.lat, lng: e.lng, sample: !!e.sample,
      at: e.receivedAt || null, hour: e.hour,
      place: e.place || nearestPlace(e.lat, e.lng),
    })),
  });
});

app.get('/api/events.csv', (_req, res) => {
  const rows = ['lat,lng,mode,kind,severity,hour,place,sample'];
  for (const e of events) {
    rows.push([e.lat, e.lng, e.mode, e.kind, e.severity ?? '', e.hour, e.place ? `"${e.place.replace(/"/g, '""')}"` : '', e.sample].join(','));
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="crashline-near-misses.csv"');
  res.send(rows.join('\n'));
});

// ---------------------------------------------------------------- helpers
function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}


app.listen(PORT, () => {
  console.log(`Crashline running at http://localhost:${PORT}`);
  console.log(`  City map:      http://localhost:${PORT}/map.html`);
  const p = aiProvider();
  console.log(`  AI + translation: ${p === 'gemini' ? `on (Gemini, ${GEMINI_MODEL})` : p ? 'on (Claude)' : 'off (set GEMINI_API_KEY or ANTHROPIC_API_KEY)'}`);
  console.log('  Instant push alerts: on');
  console.log(`  Email alerts:  ${emailReady() ? 'on' : 'off (set SMTP_USER and SMTP_PASS)'}`);
  console.log(`  Text alerts:   ${smsReady() ? 'on' : 'off (set TWILIO_* vars)'}`);
  console.log(`  Accounts:      email on · Google/Apple ${auth0Ready() ? 'on (Auth0)' : 'off (set AUTH0_DOMAIN and AUTH0_CLIENT_ID)'}`);
});
