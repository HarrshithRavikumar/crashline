// Street-level place names for alerts ("Near Peachtree St NE, Midtown").
// OpenStreetMap Nominatim: identify the app, keep requests light, cache results.
const cache = new Map();
export async function placeName(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const k = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (cache.has(k)) return cache.get(k);
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&lat=${lat}&lon=${lng}&accept-language=en`, {
      headers: { 'User-Agent': 'Crashline/1.0 (hackathon crash-safety app)' },
      signal: AbortSignal.timeout(2500),
    });
    if (!r.ok) throw new Error(String(r.status));
    const a = (await r.json()).address || {};
    const road = a.road || a.pedestrian || a.footway || a.cycleway || a.path;
    const area = a.neighbourhood || a.suburb || a.quarter;
    const city = a.city || a.town || a.village || a.county;
    const name = [road && `Near ${road}`, area, city].filter(Boolean).join(', ') || null;
    cache.set(k, name);
    if (cache.size > 2000) cache.delete(cache.keys().next().value);
    return name;
  } catch {
    return null;
  }
}
