// Sample events around Georgia Tech / Midtown Atlanta so the map has
// something to show on first run. Every seeded event is marked sample: true
// and the map labels it as sample data.
const HOTSPOTS = [
  { place: '10th St NW & Northside Dr NW',        lat: 33.7815, lng: -84.4075, n: 34, modes: { car: 6, bike: 2, walk: 2 } },
  { place: 'North Ave NW & Techwood Dr NW',       lat: 33.7713, lng: -84.3925, n: 46, modes: { scooter: 4, bike: 3, walk: 4, car: 1 } },
  { place: '14th St NW & Spring St NW',           lat: 33.7864, lng: -84.3891, n: 30, modes: { car: 5, scooter: 3, walk: 1 } },
  { place: 'Peachtree St NE & 10th St NE',        lat: 33.7816, lng: -84.3836, n: 41, modes: { bike: 5, walk: 4, scooter: 2, car: 1 } },
  { place: 'Ponce de Leon Ave NE & Boulevard NE', lat: 33.7727, lng: -84.3713, n: 28, modes: { car: 4, walk: 4, wheelchair: 1 } },
  { place: 'North Ave NE & Spring St NW',         lat: 33.7713, lng: -84.3887, n: 22, modes: { scooter: 5, car: 2, walk: 2 } },
  { place: '10th St NW & Hemphill Ave NW',        lat: 33.7816, lng: -84.4022, n: 24, modes: { bike: 6, car: 2, scooter: 2 } },
  { place: 'Marietta St NW & Northside Dr NW',    lat: 33.7690, lng: -84.4045, n: 18, modes: { car: 4, wheelchair: 2, walk: 2 } },
  { place: 'Edgewood Ave SE & Boulevard SE',      lat: 33.7543, lng: -84.3720, n: 26, modes: { bike: 4, scooter: 4, walk: 2 } },
  { place: 'Moreland Ave NE & Euclid Ave NE',     lat: 33.7646, lng: -84.3495, n: 20, modes: { walk: 4, bike: 3, car: 2 } },
];

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(rand, weights) {
  const entries = Object.entries(weights);
  let r = rand() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of entries) { if ((r -= w) <= 0) return k; }
  return entries[0][0];
}

const RUSH = { 7: 3, 8: 4, 9: 2, 12: 2, 16: 3, 17: 5, 18: 4, 19: 2, 22: 1.5, 23: 1.5 };

export function seedEvents(now = new Date()) {
  const rand = mulberry32(2027);
  const events = [];
  const hourWeights = Object.fromEntries([...Array(24).keys()].map((h) => [h, RUSH[h] || 0.6]));

  const make = (lat, lng, place, modes) => {
    const mode = pickWeighted(rand, modes);
    const kind = pickWeighted(rand, { near_miss: 70, close_call: mode === 'car' ? 4 : 26, crash: 7 });
    const day = new Date(now.getTime() - Math.floor(rand() * 120) * 86400000);
    const hour = pickWeighted(rand, hourWeights).padStart(2, '0');
    const severity = kind === 'close_call' ? null : Number((kind === 'crash' ? 3 + rand() * 4 : 0.5 + rand() * 1.4).toFixed(2));
    events.push({
      lat: Number((lat + (rand() - 0.5) * 0.0006).toFixed(4)),
      lng: Number((lng + (rand() - 0.5) * 0.0006).toFixed(4)),
      mode, kind, severity,
      hour: `${day.toISOString().slice(0, 10)}T${hour}`,
      place, sample: true,
    });
  };

  for (const h of HOTSPOTS) for (let i = 0; i < h.n; i++) make(h.lat, h.lng, h.place, h.modes);
  // Scattered background noise across Midtown and downtown.
  for (let i = 0; i < 90; i++) {
    make(33.775 + (rand() - 0.5) * 0.04, -84.385 + (rand() - 0.5) * 0.05, null, { car: 4, bike: 2, scooter: 2, walk: 2, wheelchair: 0.5 });
  }
  return events;
}
