// Renders a saved black-box record: force chart, facts, video, downloads, fingerprint.
import { drawMotion, speedSummary, peakG } from './blackbox.js';

const urls = new Set();
export function releaseUrls() { urls.forEach((u) => URL.revokeObjectURL(u)); urls.clear(); }
const objectUrl = (blob) => { const u = URL.createObjectURL(blob); urls.add(u); return u; };
const mph = (v) => (v == null ? '–' : `${Math.round(v * 2.237)} mph`);

export function renderRecord(container, rec) {
  container.innerHTML = '';
  const css = getComputedStyle(document.documentElement);
  const colors = { accent: css.getPropertyValue('--accent').trim(), danger: css.getPropertyValue('--danger').trim() };

  const canvas = document.createElement('canvas');
  canvas.className = 'bb-chart';
  canvas.setAttribute('aria-label', 'Force in the minute before and 10 seconds after impact');
  const legend = document.createElement('p');
  legend.className = 'muted small';
  legend.textContent = 'Force over the minute before impact (dashed line) and 10 seconds after.';
  container.append(canvas, legend);
  requestAnimationFrame(() => drawMotion(canvas, rec, colors));

  const { maxBefore, lastAfter } = speedSummary(rec);
  const facts = document.createElement('div');
  facts.className = 'bb-facts';
  [
    ['Peak force', `${peakG(rec).toFixed(1)} g`],
    ['Speed before', mph(maxBefore)],
    ['Speed after', mph(lastAfter)],
    ['GPS points', String(rec.track.length)],
  ].forEach(([k, v]) => {
    const d = document.createElement('div');
    d.innerHTML = '<b></b><small></small>';
    d.querySelector('b').textContent = v;
    d.querySelector('small').textContent = k;
    facts.appendChild(d);
  });
  container.appendChild(facts);

  const downloads = document.createElement('div');
  downloads.className = 'row';

  if (rec.video?.length) {
    const video = document.createElement('video');
    video.controls = true;
    video.playsInline = true;
    video.className = 'bb-video';
    const label = document.createElement('p');
    label.className = 'muted small';
    const list = rec.video.map((v) => objectUrl(v.blob));
    let i = 0;
    const load = () => { video.src = list[i]; label.textContent = `Dashcam clip ${i + 1} of ${list.length} · plays straight through`; };
    video.onended = () => { if (i < list.length - 1) { i++; load(); video.play().catch(() => {}); } };
    load();
    container.append(video, label);
    rec.video.forEach((v, n) => {
      const a = document.createElement('a');
      a.className = 'ghost small';
      a.href = list[n];
      a.download = `crashline-${rec.id}-clip${n + 1}.${(v.type || '').includes('mp4') ? 'mp4' : 'webm'}`;
      a.textContent = `Video ${n + 1}`;
      downloads.appendChild(a);
    });
  } else {
    const p = document.createElement('p');
    p.className = 'muted small';
    p.textContent = 'No dashcam video (turn on Dashcam in Settings to record the road).';
    container.appendChild(p);
  }

  const data = { impact: new Date(rec.impact).toISOString(), mode: rec.mode, detection: rec.detection, motion: rec.motion, track: rec.track, sha256: rec.hash };
  const a = document.createElement('a');
  a.className = 'ghost small';
  a.href = objectUrl(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  a.download = `crashline-${rec.id}-sensors.json`;
  a.textContent = 'Sensor data';
  downloads.appendChild(a);
  container.appendChild(downloads);

  if (rec.hash) {
    const h = document.createElement('p');
    h.className = 'hash';
    h.textContent = `Fingerprint (SHA-256): ${rec.hash.slice(0, 16)}…${rec.hash.slice(-8)}`;
    if (rec.evidenceAt) h.textContent += ` · timestamped by the server ${new Date(rec.evidenceAt).toLocaleString()}`;
    h.title = rec.hash;
    container.appendChild(h);
  }
}
