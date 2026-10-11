// Accounts: email + password (always available), plus Google and Apple
// through Auth0 when the server has AUTH0_DOMAIN and AUTH0_CLIENT_ID.
import { store } from './util.js';

const TOKEN_KEY = 'crashline.session';
let client = null;      // Auth0 client
let user = null;        // { sub, name, email, picture, provider }
let socialCfg = null;
let lastError = null;

export const authUser = () => user;
export const authEnabled = () => true;
export const socialEnabled = () => !!client;
export const appleEnabled = () => !!(client && socialCfg?.apple);
export const authError = () => lastError;
export const clearAuthError = () => { lastError = null; };

const localToken = () => store.get(TOKEN_KEY, null);

export async function initAuth(config) {
  lastError = null;
  // 1) email session
  const t = localToken();
  if (t) {
    try {
      const r = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${t}` } });
      if (r.ok) user = { ...(await r.json()).user, provider: 'email' };
      else if (r.status === 401) store.set(TOKEN_KEY, null);
    } catch { /* offline: stay signed in locally */ user = store.get('crashline.lastUser', null); }
  }

  // 2) Google / Apple through Auth0
  socialCfg = config?.auth || null;
  if (!socialCfg) return user;
  try {
    const { createAuth0Client } = await import('./vendor/auth0-spa-js.esm.js');
    client = await createAuth0Client({
      domain: socialCfg.domain,
      clientId: socialCfg.clientId,
      cacheLocation: 'localstorage',
      useRefreshTokens: true,
      useRefreshTokensFallback: true,
      authorizeTimeoutInSeconds: 10,
      authorizationParams: { redirect_uri: `${location.origin}/` },
    });
    const q = new URLSearchParams(location.search);
    if (q.has('state') && (q.has('code') || q.has('error'))) {
      try {
        await client.handleRedirectCallback();
      } catch (e) {
        lastError = explain(q.get('error_description') || e.error_description || e.message);
        console.warn('Auth0 returned an error:', q.get('error'), q.get('error_description'), e);
      }
      history.replaceState({}, '', '/');
    }
    if (!user && (await client.isAuthenticated())) {
      const u = await client.getUser();
      user = { sub: u.sub, name: u.name, email: u.email, picture: u.picture, provider: String(u.sub).split('|')[0] };
    }
  } catch (e) {
    console.warn('social sign-in unavailable', e);
    lastError = explain(e.message);
    client = null;
  }
  if (user) store.set('crashline.lastUser', user);
  return user;
}

function explain(msg = '') {
  const m = String(msg);
  if (/callback|redirect_uri|mismatch/i.test(m)) return `Auth0 doesn’t allow this site yet. Add ${location.origin} to Allowed Callback URLs, Logout URLs, and Web Origins.`;
  if (/connection.*(not enabled|disabled)|invalid connection/i.test(m)) return 'That sign-in option isn’t turned on for this app in Auth0 (Authentication → Social).';
  if (/web origin|origin/i.test(m)) return `Add ${location.origin} to Allowed Web Origins in Auth0.`;
  return m ? `Sign-in failed: ${m}` : 'Sign-in failed.';
}

export function signInWith(provider) {
  if (!client) return Promise.reject(new Error('not_configured'));
  const connection = provider === 'apple' ? 'apple' : 'google-oauth2';
  return client.loginWithRedirect({ authorizationParams: { connection, prompt: 'select_account' } });
}
export const signIn = () => signInWith('google');

async function emailAuth(path, body) {
  const r = await fetch(`/api/auth/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong. Try again.');
  store.set(TOKEN_KEY, j.token);
  user = { ...j.user, provider: 'email' };
  store.set('crashline.lastUser', user);
  return user;
}
export const signUpEmail = (email, password, name) => emailAuth('signup', { email, password, name });
export const signInEmail = (email, password) => emailAuth('login', { email, password });

export async function signOut() {
  const t = localToken();
  const wasEmail = user?.provider === 'email';
  user = null;
  store.set('crashline.lastUser', null);
  if (t) {
    store.set(TOKEN_KEY, null);
    fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${t}` } }).catch(() => {});
  }
  if (!wasEmail && client) return client.logout({ logoutParams: { returnTo: `${location.origin}/` } });
  location.reload();
}

async function bearer() {
  const t = localToken();
  if (t && user?.provider === 'email') return t;
  if (!client) return null;
  try { await client.getTokenSilently(); } catch { /* use cached */ }
  return (await client.getIdTokenClaims())?.__raw || null;
}

async function call(method, body) {
  const token = await bearer();
  if (!token) throw new Error('signed_out');
  const r = await fetch('/api/me', {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`sync_${r.status}`);
  return r.json();
}

export const pullCloud = () => call('GET');
export const pushCloud = (data) => call('PUT', data);
export const deleteCloud = () => call('DELETE');

// Signed-in API calls (people finder, this phone's alerts).
export async function authedFetch(path, { method = 'GET', body } = {}) {
  const token = await bearer();
  if (!token) throw new Error('signed_out');
  const r = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status });
  return j;
}
