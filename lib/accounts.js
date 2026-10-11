// Email + password accounts that work with no outside service, plus
// verification of Google/Apple sign-ins that come through Auth0.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { load, save } from './store.js';

const scrypt = promisify(crypto.scrypt);
const SESSION_DAYS = 90;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

let users = load('users.json', {});       // email → { sub, email, name, salt, hash, createdAt }
let sessions = load('sessions.json', {}); // sha256(token) → { sub, email, name, createdAt }

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function hashPassword(password, salt) {
  return (await scrypt(password, salt, 64)).toString('hex');
}

function newSession(user) {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions[sha(token)] = { sub: user.sub, email: user.email, name: user.name, createdAt: Date.now() };
  save('sessions.json', sessions);
  return token;
}

const publicUser = (u) => ({ sub: u.sub, email: u.email, name: u.name, provider: 'email' });

export async function signUp({ email, password, name }) {
  email = String(email || '').trim().toLowerCase();
  name = String(name || '').trim().slice(0, 80);
  if (!EMAIL_RE.test(email)) return { error: 'Enter a valid email address.' };
  if (String(password || '').length < 8) return { error: 'Use a password with at least 8 characters.' };
  if (users[email]) return { error: 'There’s already an account with that email. Sign in instead.', code: 409 };
  const salt = crypto.randomBytes(16).toString('hex');
  const user = { sub: `email|${crypto.randomBytes(12).toString('hex')}`, email, name: name || email.split('@')[0], salt, hash: await hashPassword(password, salt), createdAt: Date.now() };
  users[email] = user;
  save('users.json', users);
  return { token: newSession(user), user: publicUser(user) };
}

export async function signIn({ email, password }) {
  email = String(email || '').trim().toLowerCase();
  const user = users[email];
  const fail = { error: 'Email or password is incorrect.', code: 401 };
  if (!user) { await hashPassword(String(password || ''), 'x'.repeat(32)); return fail; }
  const got = Buffer.from(await hashPassword(String(password || ''), user.salt), 'hex');
  const want = Buffer.from(user.hash, 'hex');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return fail;
  return { token: newSession(user), user: publicUser(user) };
}

export function signOutToken(token) {
  delete sessions[sha(token)];
  save('sessions.json', sessions);
}

function sessionUser(token) {
  const s = sessions[sha(token)];
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_DAYS * 86400000) { delete sessions[sha(token)]; save('sessions.json', sessions); return null; }
  return { sub: s.sub, email: s.email, name: s.name, provider: 'email' };
}

// ---- Auth0 (Google / Apple) ----
export const AUTH0 = {
  domain: (process.env.AUTH0_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/+$/, ''),
  clientId: process.env.AUTH0_CLIENT_ID || '',
  apple: /^(1|true|yes)$/i.test(process.env.AUTH0_APPLE || ''),
};
export const auth0Ready = () => !!(AUTH0.domain && AUTH0.clientId);
const jwks = auth0Ready() ? createRemoteJWKSet(new URL(`https://${AUTH0.domain}/.well-known/jwks.json`)) : null;

export async function currentUser(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  const token = h.slice(7);
  const local = sessionUser(token);
  if (local) return local;
  if (!jwks || token.split('.').length !== 3) return null;
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: `https://${AUTH0.domain}/`, audience: AUTH0.clientId });
    return { sub: payload.sub, email: payload.email, name: payload.name, provider: String(payload.sub).split('|')[0] };
  } catch {
    return null;
  }
}

export function deleteAccount(sub) {
  for (const [email, u] of Object.entries(users)) if (u.sub === sub) delete users[email];
  for (const [h, sess] of Object.entries(sessions)) if (sess.sub === sub) delete sessions[h];
  save('users.json', users);
  save('sessions.json', sessions);
}
