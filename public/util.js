export const $ = (s, root = document) => root.querySelector(s);

export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};

let current = null;
export function show(id) {
  const prev = current;
  current = id;
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${id}`));
  window.scrollTo(0, 0);
  window.dispatchEvent(new CustomEvent('screenchange', { detail: { id, prev } }));
}
export const currentScreen = () => current;

export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2800);
}

export async function postJSON(url, body, ms = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { data: j });
    return j;
  } finally {
    clearTimeout(timer);
  }
}

export function speak(text, lang = 'en-US') {
  if (!('speechSynthesis' in window) || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  const prefix = lang.slice(0, 2).toLowerCase();
  const voice = speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith(prefix));
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}
