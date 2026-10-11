// Crashline detection engine.
//
// A crash isn't just "a big number on the accelerometer". This engine looks at
// the whole event the way phone-maker crash detection does, and weighs several
// independent signals into one confidence score:
//
//   impact      peak force, how long it lasts (crash ≈ 50–150 ms; a dropped
//               phone ≈ one sharp sample), and the velocity change it implies
//   free fall   a phone that's weightless right before the hit was probably
//               dropped. Strong evidence against, unless speed also collapsed
//   rotation    tumbling/spinning (bike, scooter, and pedestrian falls)
//   tip-over    how far the phone's "down" direction changed (bike on its side)
//   speed       moving before and stopped after (GPS or the car's OBD-II port)
//   aftermath   stays still = worrying; picked up / walking again = fine
//   sound       a loud bang at the same moment (optional microphone)
//
// Near misses: sustained hard braking/swerving from the accelerometer, plus
// hard braking from GPS speed (works no matter how the phone is held).
//
// The engine is driven by sample timestamps, so recorded scenarios can be
// replayed through it exactly (see scenarios.js and tests/detector.test.mjs).

const G = 9.80665;

// impactG: force that opens a candidate event. nearG/nearMs: sustained force for a
// near miss. minSpeed: moving (m/s). dropFrom: speed before a crash that counts.
// brakeDecel: GPS deceleration (m/s²) that counts as hard braking.
export const MODE_THRESHOLDS = {
  car:        { impactG: 3.0, nearG: 0.45, nearMs: 400, minSpeed: 4.5, dropFrom: 6.7, brakeDecel: 4.5, profile: 'vehicle' },
  bike:       { impactG: 2.5, nearG: 0.6,  nearMs: 300, minSpeed: 2.0, dropFrom: 3.0, brakeDecel: 3.5, profile: 'rider' },
  scooter:    { impactG: 2.5, nearG: 0.6,  nearMs: 300, minSpeed: 2.0, dropFrom: 3.0, brakeDecel: 3.5, profile: 'rider' },
  wheelchair: { impactG: 2.0, nearG: 0.4,  nearMs: 300, minSpeed: 0.5, dropFrom: 0.8, brakeDecel: 2.0, profile: 'rider' },
  walk:       { impactG: 2.5, nearG: 1.2,  nearMs: 300, minSpeed: 0.8, dropFrom: 1.2, brakeDecel: 99,  profile: 'person' },
};
// Demo: a moderate shake is a near miss, a hard shake then setting it down is a crash.
const DEMO = { impactG: 2.5, nearG: 1.0, nearMs: 150, minSpeed: 0, dropFrom: 3.0, brakeDecel: 99, profile: 'demo' };

const SHARED = {
  real: { stillStd: 0.12, stillMean: 0.25, window: 3000, cooldown: 30000, loudRms: 0.4, nearCooldown: 5000 },
  demo: { stillStd: 0.25, stillMean: 0.5, window: 1600, cooldown: 8000, loudRms: 0.25, nearCooldown: 2500 },
};

// How confident (0–1) an event must be to sound the alarm.
export const SENSITIVITY = { low: 0.72, normal: 0.62, high: 0.52 };

// Signal weights per travel style (each row sums to 1).
const WEIGHTS = {
  vehicle: { peak: 0.20, duration: 0.15, deltaV: 0.10, rotation: 0.05, tilt: 0.05, still: 0.15, speed: 0.25, sound: 0.05 },
  rider:   { peak: 0.18, duration: 0.10, deltaV: 0.07, rotation: 0.15, tilt: 0.15, still: 0.15, speed: 0.15, sound: 0.05 },
  person:  { peak: 0.18, duration: 0.10, deltaV: 0.07, rotation: 0.15, tilt: 0.15, still: 0.20, speed: 0.10, sound: 0.05 },
  demo:    { peak: 0.25, duration: 0.15, deltaV: 0.10, rotation: 0.05, tilt: 0.05, still: 0.25, speed: 0.10, sound: 0.05 },
};

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const stddev = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const norm = (v) => Math.hypot(v[0], v[1], v[2]);
const angleBetween = (a, b) => {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return 0;
  const c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (na * nb);
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
};
const meanVec = (list) => {
  if (!list.length) return null;
  const s = [0, 0, 0];
  for (const v of list) { s[0] += v[0]; s[1] += v[1]; s[2] += v[2]; }
  return [s[0] / list.length, s[1] / list.length, s[2] / list.length];
};

export class CrashDetector {
  static motionGranted = false;
  // iPhone asks for motion access once per page load, and only from a tap.
  static needsMotionPermission() {
    return !CrashDetector.motionGranted && typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function';
  }

  constructor(opts = {}) {
    this.opts = opts;
    this.mode = opts.mode || 'car';
    this.demo = !!opts.demo;
    this.sensitivity = opts.sensitivity || 'normal';
    this.applyConfig();
    this.samples = [];   // { t, g, total, grav:[x,y,z], rot }
    this.speeds = [];    // { t, v }
    this.lastLoudAt = -Infinity;
    this.gravEst = null;
    this.pending = null;
    this.run = null;
    this.cooldownUntil = 0;
    this.nearCooldownUntil = 0;
    this.running = !!opts.replay; // replay mode (lab/tests) needs no sensors
    this.rate = { n: 0, since: 0, hz: 0 };
  }

  applyConfig() {
    this.cfg = { ...SHARED[this.demo ? 'demo' : 'real'], ...(this.demo ? DEMO : MODE_THRESHOLDS[this.mode]) };
    this.threshold = this.demo ? 0.42 : (SENSITIVITY[this.sensitivity] ?? SENSITIVITY.normal);
  }
  setDemo(demo) { this.demo = demo; this.applyConfig(); }
  setMode(mode) { this.mode = mode; this.applyConfig(); }
  setSensitivity(s) { this.sensitivity = s; this.applyConfig(); }

  // ------------------------------------------------------------ sensors
  // Call directly from a tap handler (iOS asks for motion permission here).
  async start() {
    const notes = [];
    if (CrashDetector.needsMotionPermission()) {
      const res = await DeviceMotionEvent.requestPermission();
      if (res !== 'granted') throw new Error('Motion access was denied. Allow Motion & Orientation access in Safari settings, then try again.');
      CrashDetector.motionGranted = true;
    }
    if (!('DeviceMotionEvent' in window)) notes.push('No motion sensor on this device. Use the simulate buttons to demo.');

    this._onMotion = (e) => this.handleMotion(e);
    window.addEventListener('devicemotion', this._onMotion);

    if ('geolocation' in navigator) {
      this.geoId = navigator.geolocation.watchPosition(
        (p) => this.handlePosition(p),
        (err) => this.opts.onNote?.(`Location unavailable (${err.message}). Alerts go out without a map link and near misses can't be mapped.`),
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }
      );
    } else {
      notes.push('Location is not available in this browser.');
    }

    if (this.opts.useMic) {
      try { await this.startMic(); } catch { notes.push('Microphone unavailable, so crash-sound detection is off.'); }
    }

    this.running = true;
    setTimeout(() => {
      if (!this.running) return;
      if (this.samples.length === 0) this.opts.onNote?.('No motion data yet. On a laptop, use the simulate buttons. On a phone, open the app over HTTPS.');
      else if (this.rate.hz && this.rate.hz < 25) this.opts.onNote?.(`Motion sensor is slow on this device (${Math.round(this.rate.hz)} readings/sec), so detection may be less accurate.`);
    }, 3000);
    return { notes };
  }

  stop() {
    this.running = false;
    this.pending = this.run = null;
    clearTimeout(this.fallbackTimer);
    if (this._onMotion) window.removeEventListener('devicemotion', this._onMotion);
    if (this.geoId != null) navigator.geolocation.clearWatch(this.geoId);
    clearInterval(this.micTimer);
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micCtx?.close().catch(() => {});
    this.micStream = this.micCtx = null;
  }

  resetCooldown(ms = 5000) {
    this.pending = this.run = null;
    this.cooldownUntil = this.now() + ms;
  }

  now() { return this.samples.length ? this.samples[this.samples.length - 1].t : performance.now(); }

  // Turn a browser motion event into linear acceleration + gravity (m/s²) and rotation (deg/s).
  handleMotion(e) {
    const t = performance.now();
    const inc = e.accelerationIncludingGravity;
    const acc = e.acceleration;
    let lin, grav;
    if (acc && acc.x != null && inc && inc.x != null) {
      lin = [acc.x, acc.y, acc.z];
      grav = [inc.x - acc.x, inc.y - acc.y, inc.z - acc.z];
    } else if (inc && inc.x != null) {
      // No separate linear acceleration: estimate gravity with a low-pass filter.
      const raw = [inc.x, inc.y, inc.z];
      this.gravEst = this.gravEst ? this.gravEst.map((gv, i) => 0.9 * gv + 0.1 * raw[i]) : raw.slice();
      grav = this.gravEst.slice();
      lin = raw.map((v, i) => v - grav[i]);
    } else if (acc && acc.x != null) {
      lin = [acc.x, acc.y, acc.z];
      grav = [0, 0, 0];
    } else {
      return;
    }
    const r = e.rotationRate;
    const rot = r ? Math.hypot(r.alpha || 0, r.beta || 0, r.gamma || 0) : 0;
    this.trackRate(t);
    this.ingest(t, lin, grav, rot);
  }

  trackRate(t) {
    if (!this.rate.since) this.rate.since = t;
    this.rate.n++;
    if (t - this.rate.since >= 2000) { this.rate.hz = (this.rate.n * 1000) / (t - this.rate.since); this.rate.n = 0; this.rate.since = t; }
  }

  handlePosition(p) {
    const { latitude: lat, longitude: lng, accuracy: acc, speed } = p.coords;
    this.opts.onPosition?.({ lat, lng, acc, at: Date.now(), speed: speed != null && !Number.isNaN(speed) ? speed : null });
    if (this.externalSpeedAt && Date.now() - this.externalSpeedAt < 5000) return; // the car's own speed wins
    if (speed != null && !Number.isNaN(speed)) this.ingestSpeed(performance.now(), speed);
  }

  // Speed from another source (the car's OBD-II port).
  pushSpeed(v) {
    this.externalSpeedAt = Date.now();
    this.ingestSpeed(performance.now(), v);
  }

  // ------------------------------------------------------------ core (timestamp driven)
  ingest(t, lin, grav, rot = 0) {
    const g = norm(lin) / G;
    const total = norm([lin[0] + grav[0], lin[1] + grav[1], lin[2] + grav[2]]) / G;
    this.samples.push({ t, g, total, grav, rot });
    while (this.samples.length && t - this.samples[0].t > 12000) this.samples.shift();
    this.opts.onSample?.(g);
    if (!this.running) return;

    this.trackNearMiss(t, g);

    if (this.pending) {
      if (t - this.pending.t >= this.cfg.window) this.evaluate();
      return;
    }
    if (t < this.cooldownUntil) return;
    if (g >= this.cfg.impactG) {
      this.pending = { t, speedBefore: this.maxSpeed(t - 10000, t) };
      // If sensors go quiet after the hit (phone damaged), still decide.
      clearTimeout(this.fallbackTimer);
      if (!this.opts.replay) this.fallbackTimer = setTimeout(() => this.pending && this.evaluate(), this.cfg.window + 2000);
    }
  }

  ingestSpeed(t, v) {
    const prev = this.speeds[this.speeds.length - 1];
    this.speeds.push({ t, v });
    while (this.speeds.length && t - this.speeds[0].t > 30000) this.speeds.shift();
    this.opts.onSpeed?.(v);
    if (!this.running || !prev) return;
    // Hard braking from GPS: big speed drop between fixes, without a crash.
    const dt = (t - prev.t) / 1000;
    if (dt > 0.4 && dt < 3.5 && prev.v >= this.cfg.minSpeed) {
      const decel = (prev.v - v) / dt;
      if (decel >= this.cfg.brakeDecel && !this.pending && t >= this.nearCooldownUntil && t >= this.cooldownUntil && v > 0.5) {
        this.nearCooldownUntil = t + this.cfg.nearCooldown;
        this.opts.onNearMiss?.({ kind: 'hard_brake', peak: null, decel: Number(decel.toFixed(1)), speed: prev.v, manual: false, source: 'gps' });
      }
    }
  }

  trackNearMiss(t, g) {
    const c = this.cfg;
    if (g >= c.nearG) {
      if (!this.run) this.run = { start: t, peak: g };
      else this.run.peak = Math.max(this.run.peak, g);
      return;
    }
    if (!this.run) return;
    const run = this.run;
    this.run = null;
    const dur = t - run.start;
    if (dur < c.nearMs || run.peak >= c.impactG) return;
    if (this.pending || t < this.cooldownUntil || t < this.nearCooldownUntil) return;
    const speed = this.latestSpeed();
    if (!this.demo && c.minSpeed > 0 && (speed == null || speed < c.minSpeed)) return;
    this.nearCooldownUntil = t + c.nearCooldown;
    this.opts.onNearMiss?.({ kind: 'near_miss', peak: run.peak, durationMs: Math.round(dur), speed, manual: false, source: 'motion' });
  }

  // Decide whether the event that started at pending.t was a crash.
  evaluate() {
    const p = this.pending;
    this.pending = null;
    clearTimeout(this.fallbackTimer);
    if (!p || !this.running) return null;
    const f = this.features(p);
    const result = this.score(f);
    this.opts.onEvaluate?.(result);
    if (result.crash) {
      this.cooldownUntil = (this.samples.at(-1)?.t ?? p.t) + this.cfg.cooldown;
      this.opts.onCrash?.({
        simulated: false, peak: f.peakG, still: f.still, speedDrop: f.speedDrop, speedBefore: f.speedBefore,
        loud: f.loud, score: result.confidence, confidence: result.confidence, reasons: result.reasons, features: f,
      });
    } else if (result.dropped) {
      this.opts.onIgnored?.(result);
    }
    return result;
  }

  features(p) {
    const s = this.samples;
    const c = this.cfg;
    const t0 = p.t;
    const between = (a, b) => s.filter((x) => x.t >= t0 + a && x.t <= t0 + b);

    // Impact: from just before the trigger to 400 ms after.
    const impact = between(-120, 400);
    const peakG = Math.max(0, ...impact.map((x) => x.g));
    const dts = [];
    for (let i = 1; i < impact.length; i++) dts.push(impact[i].t - impact[i - 1].t);
    const dt = dts.length ? dts.sort((a, b) => a - b)[Math.floor(dts.length / 2)] : 16;
    const strong = Math.max(2.0, c.impactG * 0.6);
    const impactMs = impact.filter((x) => x.g >= strong).length * dt;
    let deltaV = 0;
    for (const x of impact) if (x.g >= 1) deltaV += x.g * G * (dt / 1000);

    // Free fall right before the hit (phone weightless = dropped or thrown).
    let ff = 0, best = 0, last = null;
    for (const x of between(-800, 0)) {
      if (x.total < 0.4) { ff += last ? x.t - last.t : dt; best = Math.max(best, ff); } else ff = 0;
      last = x;
    }
    const freeFallMs = Math.round(best);

    // Rotation during and just after the hit.
    const rotPeak = Math.max(0, ...between(-200, 1500).map((x) => x.rot));

    // Tip-over: "down" direction before vs. after.
    const before = meanVec(between(-1800, -300).filter((x) => x.total > 0.6).map((x) => x.grav));
    const afterS = between(1000, c.window);
    const after = meanVec(afterS.map((x) => x.grav));
    const tilt = before && after ? angleBetween(before, after) : 0;

    // Aftermath: still vs. moving again (picked up, walking).
    const ag = afterS.map((x) => x.g);
    const speedBefore = p.speedBefore;
    const speedAfter = this.latestSpeed();
    // A mounted phone on a smooth road barely vibrates, so "still" only counts if GPS agrees we stopped.
    const gpsMoving = speedAfter != null && speedAfter > c.minSpeed;
    const still = !gpsMoving && ag.length >= 5 && stddev(ag) < c.stillStd && mean(ag) < c.stillMean;
    const moving = gpsMoving || (ag.length >= 5 && ag.filter((g) => g > 0.35).length / ag.length > 0.25);

    // Speed.
    const speedDrop = speedBefore != null && speedBefore >= c.dropFrom && speedAfter != null && speedAfter < 1;
    const loud = Math.abs(this.lastLoudAt - t0) < 1500;

    return {
      peakG: Number(peakG.toFixed(2)), impactMs: Math.round(impactMs), deltaV: Number(deltaV.toFixed(2)),
      freeFallMs, rotPeak: Math.round(rotPeak), tilt: Math.round(tilt), still, moving,
      speedBefore, speedAfter, speedDrop, loud, samplesAfter: ag.length,
    };
  }

  score(f) {
    const c = this.cfg;
    const w = WEIGHTS[c.profile] || WEIGHTS.vehicle;
    const ev = {
      peak: clamp01((f.peakG - c.impactG) / c.impactG + 0.3),
      duration: clamp01((f.impactMs - 20) / 80),
      deltaV: clamp01((f.deltaV - 1) / 3),
      rotation: clamp01((f.rotPeak - 120) / 300),
      tilt: clamp01((f.tilt - 25) / 50),
      still: f.still ? 1 : f.samplesAfter < 5 ? 0.5 : 0,
      // Moving, then stopped = strong. Already stopped (e.g. rear-ended at a light) or no GPS = neutral.
      // Kept moving at the same speed = against.
      speed: f.speedDrop ? 1 : (f.speedBefore == null || f.speedBefore < c.minSpeed) ? 0.4 : 0,
      sound: f.loud ? 1 : 0,
    };
    let score = 0;
    for (const k of Object.keys(w)) score += w[k] * ev[k];

    const reasons = [];
    const notes = [];
    if (f.peakG >= c.impactG) reasons.push(`Impact ${f.peakG.toFixed(1)} g`);
    if (ev.duration >= 0.5) reasons.push(`sustained ${f.impactMs} ms`);
    if (ev.rotation >= 0.5) reasons.push('tumbling');
    if (ev.tilt >= 0.5) reasons.push(`tipped ${f.tilt}°`);
    if (f.speedDrop) reasons.push(`speed ${Math.round(f.speedBefore * 2.237)} → 0 mph`);
    if (f.still) reasons.push('no movement after');
    if (f.loud) reasons.push('loud crash sound');

    // Evidence against.
    let dropped = false;
    const isDrop = f.freeFallMs >= 120 && f.impactMs <= 40;
    if (c.profile === 'vehicle' && f.freeFallMs >= 120 && !f.speedDrop) {
      score *= 0.3; dropped = true; notes.push('phone fell freely before the hit, like a drop');
    } else if (c.profile !== 'demo' && isDrop && (f.speedBefore == null || f.speedBefore < c.minSpeed)) {
      score *= 0.45; dropped = true; notes.push('short hard spike after a free fall, like a dropped phone');
    }
    if (f.moving && !f.speedDrop) { score *= 0.45; notes.push('moving normally again after'); }
    if (!f.still && !f.speedDrop && f.samplesAfter >= 5 && c.profile !== 'demo') { score *= 0.7; notes.push('no stillness and speed didn’t drop'); }
    if (f.impactMs <= 20 && f.deltaV < 1 && !f.speedDrop) { score *= 0.6; notes.push('a single jolt, like a pothole or bump'); }

    // Severe and sustained (≥2× the trigger force for ≥60 ms) with no free fall and no normal
    // movement afterward: everyday handling never does this, so treat it as a crash.
    if (c.profile !== 'demo' && f.peakG >= 2 * c.impactG && f.impactMs >= 60 && f.freeFallMs < 120 && !f.moving) {
      if (score < 0.8) reasons.push('severe sustained impact');
      score = Math.max(score, 0.8);
    }

    const confidence = Number(clamp01(score).toFixed(2));
    return { crash: confidence >= this.threshold, confidence, threshold: this.threshold, reasons, notes, dropped, evidence: ev, features: f };
  }

  // ------------------------------------------------------------ demo helpers
  simulate() {
    [0.2, 1.4, 5.8, 6.4, 3.1, 0.9, 0.2, 0.05].forEach((g, i) => setTimeout(() => this.opts.onSample?.(g), i * 40));
    setTimeout(() => {
      this.opts.onCrash?.({ simulated: true, peak: 6.4, still: true, speedDrop: true, speedBefore: 8, loud: true, score: 0.95, confidence: 0.95, reasons: ['Simulated crash for demo'] });
    }, 400);
  }

  simulateNearMiss() {
    [0.2, 0.7, 1.3, 1.6, 1.5, 1.2, 0.6, 0.1].forEach((g, i) => setTimeout(() => this.opts.onSample?.(g), i * 40));
    setTimeout(() => this.opts.onNearMiss?.({ kind: 'near_miss', peak: 1.6, durationMs: 220, speed: null, manual: false, simulated: true }), 350);
  }

  // ------------------------------------------------------------ helpers
  maxSpeed(from, to) {
    const r = this.speeds.filter((s) => s.t >= from && s.t <= to);
    return r.length ? Math.max(...r.map((s) => s.v)) : null;
  }
  maxRecentSpeed(t, windowMs) { return this.maxSpeed(t - windowMs, t); }
  latestSpeed() { return this.speeds.length ? this.speeds[this.speeds.length - 1].v : null; }

  async startMic() {
    this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.micCtx = new Ctx();
    const src = this.micCtx.createMediaStreamSource(this.micStream);
    const analyser = this.micCtx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    this.micTimer = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      const rms = Math.sqrt(mean(Array.from(buf, (x) => x * x)));
      this.opts.onSound?.(rms);
      if (rms > this.cfg.loudRms) this.lastLoudAt = performance.now();
    }, 100);
  }
}

// Replay a recorded/synthetic scenario through a fresh detector (Detection Lab, tests).
export function replay(scenario, { sensitivity = 'normal', onSample } = {}) {
  const out = { crash: null, nearMisses: [], evaluations: [], ignored: [] };
  const d = new CrashDetector({
    mode: scenario.mode, sensitivity, replay: true,
    onSample, onCrash: (i) => { if (!out.crash) out.crash = i; },
    onNearMiss: (i) => out.nearMisses.push(i),
    onEvaluate: (r) => out.evaluations.push(r),
    onIgnored: (r) => out.ignored.push(r),
  });
  const events = [
    ...scenario.samples.map((x) => ({ t: x.t, kind: 'm', x })),
    ...(scenario.speeds || []).map((x) => ({ t: x.t, kind: 's', x })),
  ].sort((a, b) => a.t - b.t);
  for (const e of events) {
    if (e.kind === 's') d.ingestSpeed(e.t, e.x.v);
    else {
      if (e.x.loud) d.lastLoudAt = e.t;
      d.ingest(e.t, e.x.lin, e.x.grav, e.x.rot);
    }
  }
  if (d.pending) d.evaluate();
  const last = out.evaluations.at(-1) || null;
  out.outcome = out.crash ? 'crash' : out.nearMisses.length ? 'near_miss' : 'none';
  out.confidence = out.crash ? out.crash.confidence : last ? last.confidence : 0;
  out.notes = last ? last.notes : [];
  out.reasons = out.crash ? out.crash.reasons : last ? last.reasons : [];
  return out;
}
