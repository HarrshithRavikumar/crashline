// Auto-start: while Crashline is open, watch for steady movement and start a
// trip on its own, guessing the travel mode from speed. Ends the trip after
// 3 minutes stopped (only if it started it). A website can't run in the
// background, so the app has to be open; a native app would lift that limit.
const WINDOW_MS = 30_000;
const STOP_MS = 180_000;
const MOVING = 0.8;  // m/s, a slow walk

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

function haversine(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function guessMode(speed, preferred) {
  if (speed > 8.5) return 'car';                       // ~19 mph+
  if (preferred === 'car' && speed > 4) return 'car';  // city traffic
  if (speed >= 2.4) return preferred === 'scooter' ? 'scooter' : 'bike';
  return preferred === 'wheelchair' ? 'wheelchair' : 'walk';
}

export class AutoStart {
  constructor({ onStart, onStop, isRunning, preferred, onSpeed }) {
    Object.assign(this, { onStart, onStop, isRunning, preferred, onSpeed });
    this.samples = []; // { t, v }
    this.last = null;
    this.watchId = null;
    this.autoStarted = false;
  }

  get enabled() { return this.watchId != null || this.simulating; }

  enable() {
    if (this.watchId != null || !('geolocation' in navigator)) return;
    this.watchId = navigator.geolocation.watchPosition(
      (p) => this.onPosition(p.coords, p.timestamp),
      () => {},
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 30000 }
    );
  }

  disable() {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    this.samples = [];
  }

  onPosition(c, ts = Date.now()) {
    let v = c.speed;
    const pos = { lat: c.latitude, lng: c.longitude, t: ts, acc: c.accuracy };
    if ((v == null || Number.isNaN(v)) && this.last && pos.acc < 50 && this.last.acc < 50) {
      const dt = (pos.t - this.last.t) / 1000;
      if (dt > 0.5) v = haversine(this.last, pos) / dt;
    }
    this.last = pos;
    if (v == null || Number.isNaN(v)) return;
    this.push(ts, v);
  }

  push(t, v) {
    this.samples.push({ t, v });
    while (this.samples.length && t - this.samples[0].t > STOP_MS + 5000) this.samples.shift();
    this.onSpeed?.(v);
    this.evaluate(t);
  }

  evaluate(now = Date.now()) {
    const running = this.isRunning();
    if (!running) {
      this.autoStarted = false;
      const recent = this.samples.filter((s) => now - s.t <= WINDOW_MS);
      if (recent.length < 5) return;
      const spanOk = now - recent[0].t >= WINDOW_MS * 0.6;
      const movingShare = recent.filter((s) => s.v >= MOVING).length / recent.length;
      if (spanOk && movingShare >= 0.8) {
        const speed = median(recent.map((s) => s.v));
        this.autoStarted = true;
        this.onStart(guessMode(speed, this.preferred()), speed);
      }
    } else if (this.autoStarted) {
      const window = this.samples.filter((s) => now - s.t <= STOP_MS);
      const covered = window.length && now - window[0].t >= STOP_MS * 0.9;
      if (covered && window.every((s) => s.v < 0.5)) {
        this.autoStarted = false;
        this.onStop();
      }
    }
  }

  // Demo: pretend the last 30 seconds were spent moving at `speed` m/s.
  simulate(speed) {
    const now = Date.now();
    this.samples = [];
    for (let i = 10; i >= 0; i--) this.samples.push({ t: now - i * 3000, v: speed * (0.9 + Math.random() * 0.2) });
    this.onSpeed?.(speed);
    this.evaluate(now);
  }
}

// Links like /?start=car let phone automations (iPhone Shortcuts on CarPlay or
// Bluetooth connect, Android routines) open Crashline straight into a trip.
export function readStartParam() {
  const p = new URLSearchParams(location.search);
  const mode = p.get('start');
  if (!mode) return null;
  p.delete('start');
  const q = p.toString();
  history.replaceState({}, '', location.pathname + (q ? `?${q}` : '') + location.hash);
  return ['car', 'bike', 'scooter', 'wheelchair', 'walk', 'auto'].includes(mode) ? mode : null;
}
