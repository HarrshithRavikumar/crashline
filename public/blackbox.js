// Black box: keeps a rolling minute of motion + GPS (always) and, if turned
// on, dashcam video in 10-second segments. When a crash is detected it keeps
// recording 10 more seconds, then saves everything on the phone with a
// SHA-256 fingerprint so it's tamper-evident.
const KEEP_MS = 60_000;      // history kept before the crash
const AFTER_MS = 10_000;     // keep recording this long after impact
const SEG_MS = 10_000;       // video segment length (each segment plays on its own)

const DB_NAME = 'crashline';
const STORE = 'incidents';

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no_indexeddb'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  });
}
export const saveIncident = (rec) => tx('readwrite', (s) => s.put(rec));
export const getIncident = (id) => tx('readonly', (s) => s.get(id));
export const deleteIncident = (id) => tx('readwrite', (s) => s.delete(id));
export async function listIncidents() {
  const all = await tx('readonly', (s) => s.getAll());
  return (all || []).sort((a, b) => b.id - a.id);
}

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  const options = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return options.find((m) => MediaRecorder.isTypeSupported?.(m)) || '';
}

async function sha256Hex(parts) {
  const bufs = await Promise.all(parts.map((p) => (p instanceof Blob ? p.arrayBuffer() : new TextEncoder().encode(p).buffer)));
  const total = bufs.reduce((n, b) => n + b.byteLength, 0);
  const all = new Uint8Array(total);
  let off = 0;
  for (const b of bufs) { all.set(new Uint8Array(b), off); off += b.byteLength; }
  const hash = await crypto.subtle.digest('SHA-256', all);
  return [...new Uint8Array(hash)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export class BlackBox {
  constructor() {
    this.motion = [];   // [t, g]
    this.track = [];    // { t, lat, lng, acc, speed }
    this.segments = []; // { t, end, blob }
    this.stream = null;
    this.recorder = null;
    this.mime = null;
    this.capturing = null;
  }

  get cameraOn() { return !!this.stream; }

  addSample(g) {
    const t = Date.now();
    this.motion.push([t, Number(g.toFixed(3))]);
    while (this.motion.length && t - this.motion[0][0] > KEEP_MS + AFTER_MS + 5000) this.motion.shift();
  }

  addPosition(p, speed = null) {
    this.track.push({ t: p.at || Date.now(), lat: p.lat, lng: p.lng, acc: Math.round(p.acc || 0), speed: speed != null ? Number(speed.toFixed(2)) : null });
    const t = Date.now();
    while (this.track.length && t - this.track[0].t > KEEP_MS + AFTER_MS + 5000) this.track.shift();
  }

  // ---- dashcam ----
  async startCamera({ audio = false, preview = null } = {}) {
    if (this.stream) return;
    this.mime = pickMime();
    if (this.mime === null) throw new Error('This browser can’t record video.');
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio,
    });
    if (preview) { preview.srcObject = this.stream; preview.muted = true; preview.play?.().catch(() => {}); }
    this.cycle();
  }

  stopCamera() {
    clearTimeout(this.segTimer);
    const s = this.stream;
    this.stream = null;
    try { if (this.recorder?.state === 'recording') this.recorder.stop(); } catch { /* ignore */ }
    s?.getTracks().forEach((t) => t.stop());
    this.recorder = null;
  }

  cycle() {
    if (!this.stream) return;
    let rec;
    try {
      rec = new MediaRecorder(this.stream, { ...(this.mime ? { mimeType: this.mime } : {}), videoBitsPerSecond: 1_500_000 });
    } catch {
      rec = new MediaRecorder(this.stream);
    }
    const chunks = [];
    const start = Date.now();
    rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    rec.onstop = () => {
      if (chunks.length) {
        this.segments.push({ t: start, end: Date.now(), blob: new Blob(chunks, { type: chunks[0].type || this.mime || 'video/webm' }) });
        while (this.segments.length > 8) this.segments.shift();
      }
      this.onSegment?.();
      if (this.stream) this.cycle();
    };
    rec.start();
    this.recorder = rec;
    this.segTimer = setTimeout(() => { if (rec.state === 'recording') rec.stop(); }, SEG_MS);
  }

  // Close the current video segment now (so the moment of impact is included).
  flushSegment() {
    return new Promise((resolve) => {
      if (!this.recorder || this.recorder.state !== 'recording') return resolve();
      clearTimeout(this.segTimer);
      this.onSegment = () => { this.onSegment = null; resolve(); };
      this.recorder.stop();
      setTimeout(resolve, 2000);
    });
  }

  // ---- capture on crash ----
  // Returns { done: Promise<record|null>, cancel() }.
  capture(meta = {}) {
    const impact = Date.now();
    let cancelled = false;
    const done = (async () => {
      await new Promise((r) => setTimeout(r, AFTER_MS));
      if (cancelled) return null;
      if (this.stream) await this.flushSegment();
      const from = impact - KEEP_MS, to = impact + AFTER_MS + 1000;
      const motion = this.motion.filter(([t]) => t >= from && t <= to);
      const track = this.track.filter((p) => p.t >= from && p.t <= to);
      const segments = this.segments.filter((s) => s.end >= from && s.t <= to);
      const data = JSON.stringify({ impact, mode: meta.mode, motion, track });
      const hash = await sha256Hex([data, ...segments.map((s) => s.blob)]).catch(() => null);
      const rec = {
        id: impact, impact, mode: meta.mode || null, detection: meta.detection || '',
        motion, track, hash,
        video: segments.map((s) => ({ t: s.t, end: s.end, type: s.blob.type, blob: s.blob })),
      };
      if (!cancelled) await saveIncident(rec).catch(() => {});
      return cancelled ? null : rec;
    })();
    this.capturing = { done, cancel: () => { cancelled = true; } };
    return this.capturing;
  }
}

// ---- helpers for showing a saved record ----
export function speedSummary(rec) {
  const before = rec.track.filter((p) => p.t < rec.impact && p.speed != null);
  const after = rec.track.filter((p) => p.t > rec.impact + 2000 && p.speed != null);
  const maxBefore = before.length ? Math.max(...before.map((p) => p.speed)) : null;
  const lastAfter = after.length ? after[after.length - 1].speed : null;
  return { maxBefore, lastAfter };
}

export function peakG(rec) {
  return rec.motion.length ? Math.max(...rec.motion.map(([, g]) => g)) : 0;
}

export function drawMotion(canvas, rec, colors) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (!rec.motion.length) return;
  const t0 = rec.impact - KEEP_MS, t1 = rec.impact + AFTER_MS;
  const maxG = Math.max(2, ...rec.motion.map(([, g]) => g));
  const x = (t) => ((t - t0) / (t1 - t0)) * W;
  const y = (g) => H - (g / maxG) * (H - 6) - 3;
  ctx.strokeStyle = colors.danger; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.5 * dpr;
  ctx.setLineDash([4 * dpr, 4 * dpr]);
  ctx.beginPath(); ctx.moveTo(x(rec.impact), 0); ctx.lineTo(x(rec.impact), H); ctx.stroke();
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  ctx.strokeStyle = colors.accent; ctx.lineWidth = 1.6 * dpr; ctx.lineJoin = 'round';
  ctx.beginPath();
  rec.motion.forEach(([t, g], i) => (i ? ctx.lineTo(x(t), y(g)) : ctx.moveTo(x(t), y(g))));
  ctx.stroke();
}
