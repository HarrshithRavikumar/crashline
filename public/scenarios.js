// Synthetic sensor recordings for the Detection Lab and automated tests.
// Each one models what a phone's accelerometer, gyroscope, and GPS report in a
// real situation, including look-alikes that must NOT trigger an alarm.
// Units: linear acceleration and gravity in m/s², rotation in deg/s, speed in m/s.
const G = 9.80665;
const HZ = 60;
const DT = 1000 / HZ;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function rotateGrav(from, to, k) {
  const v = from.map((a, i) => a + (to[i] - a) * k);
  const n = Math.hypot(...v) || 1;
  return v.map((x) => (x / n) * G);
}

class Rec {
  constructor(seed) { this.t = 0; this.samples = []; this.speeds = []; this.rand = rng(seed); this.grav = [0, G, 0]; }
  noise(sd) { return (this.rand() - 0.5) * 2 * sd * G; }
  push(lin, rot = 0, extra = {}) { this.samples.push({ t: Math.round(this.t), lin, grav: this.grav.slice(), rot, ...extra }); this.t += DT; }
  // steady motion with vibration (sd in g) and an optional periodic component (amp in g, f in Hz)
  steady(ms, sd, { amp = 0, f = 0, rot = 0 } = {}) {
    const n = Math.round(ms / DT);
    for (let i = 0; i < n; i++) {
      const wave = amp ? amp * G * Math.sin((2 * Math.PI * f * this.t) / 1000) : 0;
      this.push([this.noise(sd) + wave, this.noise(sd), this.noise(sd)], rot * this.rand());
    }
  }
  // half-sine impact pulse
  pulse(ms, peakG, { rot = 0, axis = 0, loud = false } = {}) {
    const n = Math.max(1, Math.round(ms / DT));
    for (let i = 0; i < n; i++) {
      const a = peakG * G * Math.sin((Math.PI * (i + 0.5)) / n);
      const lin = [this.noise(0.05), this.noise(0.05), this.noise(0.05)];
      lin[axis] += a;
      this.push(lin, rot, i === 0 && loud ? { loud: true } : {});
    }
  }
  spike(g) { this.push([g * G, this.noise(0.1), this.noise(0.1)], 60); }
  freeFall(ms, rot = 0) {
    const n = Math.round(ms / DT);
    for (let i = 0; i < n; i++) this.push(this.grav.map((x) => -x + this.noise(0.02)), rot);
  }
  tumble(ms, toGrav, rot, decayFrom = 1.5) {
    const n = Math.round(ms / DT);
    const from = this.grav.slice();
    for (let i = 0; i < n; i++) {
      this.grav = rotateGrav(from, toGrav, (i + 1) / n);
      const amp = decayFrom * (1 - i / n);
      this.push([this.noise(amp), this.noise(amp), this.noise(amp)], rot * (1 - i / n));
    }
  }
  speed(atMs, v) { this.speeds.push({ t: atMs, v }); }
  speedsEvery(fromMs, toMs, fn) { for (let t = fromMs; t <= toMs; t += 1000) this.speed(t, fn(t)); }
  done(meta) { return { ...meta, samples: this.samples, speeds: this.speeds, durationMs: Math.round(this.t) }; }
}

export const SCENARIOS = [
  {
    id: 'car_crash', name: 'Car crash at 34 mph', mode: 'car', expect: 'crash',
    build() {
      const r = new Rec(1);
      r.steady(8000, 0.04);
      r.pulse(120, 8, { rot: 150, loud: true });
      r.tumble(600, [0, G * 0.94, G * 0.34], 120, 1.5);
      r.steady(4000, 0.01);
      r.speedsEvery(0, 8000, () => 15);
      r.speed(9000, 2); r.speed(10000, 0); r.speed(11000, 0); r.speed(12000, 0);
      return r.done(this);
    },
  },
  {
    id: 'hard_brake', name: 'Hard braking (no crash)', mode: 'car', expect: 'near_miss',
    build() {
      const r = new Rec(2);
      r.steady(5000, 0.04);
      r.steady(2800, 0.05, { amp: 0.6, f: 0 });
      for (let i = 0; i < Math.round(2800 / DT); i++) r.samples[r.samples.length - 1 - i].lin[0] += 0.58 * G;
      r.steady(3000, 0.01);
      r.speedsEvery(0, 5000, () => 15);
      r.speed(6000, 9.6); r.speed(7000, 4.2); r.speed(8000, 0); r.speed(9000, 0); r.speed(10000, 0);
      return r.done(this);
    },
  },
  {
    id: 'pothole', name: 'Pothole while driving', mode: 'car', expect: 'none',
    build() {
      const r = new Rec(3);
      r.steady(5000, 0.05);
      r.spike(3.3); r.spike(2.4); r.steady(130, 0.05); r.spike(3.1); r.spike(2.0);
      r.steady(5000, 0.05);
      r.speedsEvery(0, 10000, () => 12);
      return r.done(this);
    },
  },
  {
    id: 'drop_parked', name: 'Phone dropped in a parked car', mode: 'car', expect: 'none',
    build() {
      const r = new Rec(4);
      r.steady(3000, 0.05);
      r.freeFall(350, 200);
      r.spike(9); r.spike(3);
      r.grav = [0, 0, G];
      r.steady(4000, 0.01);
      r.speedsEvery(0, 7000, () => 0);
      return r.done(this);
    },
  },
  {
    id: 'drop_driving', name: 'Phone falls off the seat while driving', mode: 'car', expect: 'none',
    build() {
      const r = new Rec(5);
      r.steady(4000, 0.05);
      r.freeFall(250, 150);
      r.spike(6); r.spike(2);
      r.grav = [G * 0.2, 0, G * 0.98];
      r.steady(5000, 0.06);
      r.speedsEvery(0, 9000, () => 13);
      return r.done(this);
    },
  },
  {
    id: 'bike_crash', name: 'Bike crash (rider thrown)', mode: 'bike', expect: 'crash',
    build() {
      const r = new Rec(6);
      r.steady(6000, 0.06, { amp: 0.15, f: 1.4 });
      r.pulse(80, 6, { rot: 450, loud: true });
      r.tumble(800, [G, 0, 0], 450, 2);
      r.steady(4000, 0.01);
      r.speedsEvery(0, 6000, () => 6);
      r.speed(7000, 1); r.speed(8000, 0); r.speed(9000, 0); r.speed(10000, 0);
      return r.done(this);
    },
  },
  {
    id: 'curb_bump', name: 'Bike hits a curb edge (no fall)', mode: 'bike', expect: 'none',
    build() {
      const r = new Rec(7);
      r.steady(5000, 0.06, { amp: 0.15, f: 1.4 });
      r.spike(3.0); r.spike(2.2);
      r.steady(5000, 0.06, { amp: 0.15, f: 1.4 });
      r.speedsEvery(0, 10000, () => 6);
      return r.done(this);
    },
  },
  {
    id: 'pedestrian_hit', name: 'Pedestrian hit by a car', mode: 'walk', expect: 'crash',
    build() {
      const r = new Rec(8);
      r.grav = [0, -G, 0];
      r.steady(6000, 0.05, { amp: 0.25, f: 1.8 });
      r.pulse(100, 5, { rot: 350, loud: true });
      r.tumble(500, [0, 0, -G], 350, 1.2);
      r.pulse(60, 3, { rot: 100 });
      r.steady(4000, 0.01);
      r.speedsEvery(0, 6000, () => 1.4);
      r.speed(7000, 0.3); r.speed(8000, 0); r.speed(9000, 0); r.speed(10000, 0);
      return r.done(this);
    },
  },
  {
    id: 'drop_walking', name: 'Phone dropped while walking, picked up', mode: 'walk', expect: 'none',
    build() {
      const r = new Rec(9);
      r.grav = [0, -G, 0];
      r.steady(5000, 0.05, { amp: 0.25, f: 1.8 });
      r.freeFall(450, 250);
      r.spike(8); r.spike(2.5);
      r.grav = [0, 0, G];
      r.steady(1800, 0.01);
      r.grav = [0, -G, 0];
      r.steady(3000, 0.08, { amp: 0.3, f: 1.8 });
      r.speedsEvery(0, 5000, () => 1.4);
      r.speed(6000, 0.2); r.speed(7000, 0.5); r.speed(8000, 1.3); r.speed(9000, 1.4); r.speed(10000, 1.4);
      return r.done(this);
    },
  },
  {
    id: 'rear_ended', name: 'Rear-ended while stopped at a light', mode: 'car', expect: 'crash',
    build() {
      const r = new Rec(10);
      r.steady(5000, 0.02);
      r.pulse(110, 5, { rot: 80, loud: true });
      r.tumble(500, [0, G * 0.97, G * 0.24], 60, 1.2);
      r.steady(4000, 0.01);
      r.speedsEvery(0, 10000, (t) => (t > 5000 && t < 7000 ? 1.5 : 0));
      return r.done(this);
    },
  },
  {
    id: 'crash_no_gps', name: 'Car crash with GPS unavailable', mode: 'car', expect: 'crash',
    build() {
      const r = new Rec(11);
      r.steady(8000, 0.05);
      r.pulse(130, 7, { rot: 200, loud: false });
      r.tumble(700, [0, G * 0.9, G * 0.44], 150, 1.6);
      r.steady(4000, 0.01);
      return r.done(this);
    },
  },
];

export const buildScenario = (id) => SCENARIOS.find((s) => s.id === id).build();
