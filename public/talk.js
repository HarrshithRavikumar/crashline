// Language bridge: face-to-face translation between the person and the
// officer or other driver. Live translation needs a connection; phrase
// cards work offline.
import { $, show, toast, postJSON, speak } from './util.js';
import { ENGLISH, getLang, PHRASES, RIGHTS_EN, RIGHTS_NOTE } from './i18n.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let opts = null;
let back = 'home';
let rec = null;
const rightsCache = {};

const me = () => getLang(opts.getLang());

export function initTalk(options) {
  opts = options;
  $('#themMic').onclick = () => listen(ENGLISH, $('#themMic'), handleTheirs);
  $('#meMic').onclick = () => listen(me(), $('#meMic'), handleMine);
  $('#themType').onsubmit = (e) => submitTyped(e, handleTheirs);
  $('#meType').onsubmit = (e) => submitTyped(e, handleMine);
  $('#flipBtn').onclick = () => $('#themHalf').classList.toggle('flipped');
  $('#rightsBtn').onclick = toggleRights;
  $('#talkBack').onclick = () => { stopListening(); speechSynthesis?.cancel(); show(back); };
}

export function openTalk(from) {
  back = from || 'home';
  render();
  show('talk');
}

function render() {
  const L = me();
  $('#meHalf').dir = L.dir || 'ltr';
  $('#meLang').textContent = L.name;
  $('#meWho').textContent = L.ui.you;
  $('#meMic').textContent = L.ui.speak;
  $('#meType input').placeholder = L.ui.type;
  $('#phrasesHint').textContent = L.ui.phrases;
  $('#rightsBtn').textContent = L.key === 'en' ? 'Know your rights' : `${L.ui.rights} · Know your rights`;
  $('#meText').textContent = '';
  $('#meSaid').textContent = '';
  $('#themText').textContent = 'Tap “Speak English” and talk. Translations of what the other person says appear here.';
  $('#themSaid').textContent = '';
  $('#rightsBox').hidden = true;

  const box = $('#phrases');
  box.innerHTML = '';
  PHRASES.forEach((p) => {
    const b = document.createElement('button');
    b.className = 'phrase';
    b.textContent = p[L.key] || p.en;
    b.onclick = () => {
      $('#meSaid').textContent = p[L.key] || p.en;
      showToThem(p.en);
    };
    box.appendChild(b);
  });
}

function submitTyped(e, handler) {
  e.preventDefault();
  const input = e.target.querySelector('input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  handler(text);
}

// The person speaks their language → English for the officer.
async function handleMine(text) {
  const L = me();
  $('#meSaid').textContent = text;
  if (L.key === 'en') { showToThem(text); return; }
  $('#themText').textContent = '…';
  try {
    showToThem(await translate(text, L, ENGLISH));
  } catch {
    $('#themText').textContent = 'Live translation needs a connection. Use the phrase buttons.';
  }
}

// The officer speaks English → the person's language.
async function handleTheirs(text) {
  const L = me();
  $('#themSaid').textContent = `“${text}”`;
  if (L.key === 'en') { $('#meText').textContent = text; return; }
  $('#meText').textContent = '…';
  try {
    const out = await translate(text, ENGLISH, L);
    $('#meText').textContent = out;
    speak(out, L.speech);
  } catch {
    $('#meText').textContent = 'Live translation needs a connection. Show the officer the phrase: “I need an interpreter.”';
  }
}

function showToThem(english) {
  $('#themText').textContent = english;
  speak(english, 'en-US');
}

async function translate(text, from, to) {
  if (!navigator.onLine) throw new Error('offline');
  const j = await postJSON('/api/translate', { text, from: from.english, to: to.english }, 15000);
  if (!j.translation) throw new Error('empty');
  return j.translation;
}

function listen(lang, btn, onText) {
  if (!SR) { toast('Voice input isn’t supported in this browser. Type instead.'); return; }
  if (rec) { stopListening(); return; }
  speechSynthesis?.cancel();
  rec = new SR();
  rec.lang = lang.speech;
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  btn.classList.add('listening');
  rec.onresult = (e) => onText(e.results[0][0].transcript);
  rec.onerror = (e) => toast(e.error === 'not-allowed' ? 'Allow microphone access to talk.' : 'Didn’t catch that. Try again or type.');
  rec.onend = () => { btn.classList.remove('listening'); rec = null; };
  try { rec.start(); } catch { btn.classList.remove('listening'); rec = null; }
}

function stopListening() {
  try { rec?.stop(); } catch { /* already stopped */ }
  rec = null;
  document.querySelectorAll('.mic.listening').forEach((b) => b.classList.remove('listening'));
}

async function toggleRights() {
  const box = $('#rightsBox');
  if (!box.hidden) { box.hidden = true; return; }
  box.hidden = false;
  const L = me();
  const renderList = (lines, note) => {
    box.innerHTML = '';
    const ul = document.createElement('ul');
    lines.forEach((l) => { const li = document.createElement('li'); li.textContent = l; ul.appendChild(li); });
    const p = document.createElement('p');
    p.className = 'muted small';
    p.textContent = note;
    box.append(ul, p);
  };
  if (L.key === 'en') { renderList(RIGHTS_EN, RIGHTS_NOTE); return; }
  if (rightsCache[L.key]) { renderList(rightsCache[L.key].lines, rightsCache[L.key].note); return; }
  renderList(RIGHTS_EN, `${RIGHTS_NOTE} Translating…`);
  try {
    const out = await translate([...RIGHTS_EN, RIGHTS_NOTE].join('\n'), ENGLISH, L);
    const lines = out.split('\n').map((s) => s.trim()).filter(Boolean);
    const note = lines.length > RIGHTS_EN.length ? lines.pop() : RIGHTS_NOTE;
    rightsCache[L.key] = { lines, note };
    if (!box.hidden) renderList(lines, note);
  } catch {
    renderList(RIGHTS_EN, `${RIGHTS_NOTE} (Shown in English: translation needs a connection.)`);
  }
}
