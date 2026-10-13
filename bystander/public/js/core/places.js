// Nearest AEDs and pharmacies from OpenStreetMap, through the public
// Overpass API. Coverage depends on volunteers mapping them, so the app says
// "nearest mapped AED", never "nearest AED".

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

const KINDS = {
  aed: '["emergency"="defibrillator"]',
  pharmacy: '["amenity"="pharmacy"]',
};

export function overpassQuery({ lat, lon, kind = 'aed', radiusM = 1500 }) {
  const filter = KINDS[kind];
  if (!filter) throw new Error(`Unknown place kind: ${kind}`);
  const around = `(around:${Math.round(radiusM)},${lat.toFixed(6)},${lon.toFixed(6)})`;
  return `[out:json][timeout:10];(node${filter}${around};way${filter}${around};);out center 40;`;
}

const toRad = (d) => (d * Math.PI) / 180;

export function distanceM(a, b) {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];

export function direction(a, b) {
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return COMPASS[Math.round(((bearing + 360) % 360) / 45) % 8];
}

// Overpass JSON -> places sorted by distance from `origin`.
export function parsePlaces(json, origin, kind = 'aed') {
  const elements = Array.isArray(json?.elements) ? json.elements : [];
  return elements
    .map((el) => {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const tags = el.tags || {};
      const where = tags['defibrillator:location'] || tags['defibrillator:location:en'] || tags.description || '';
      const fallback = kind === 'aed' ? 'Mapped AED' : 'Pharmacy';
      const name = [tags.name || tags.operator || fallback, where].filter(Boolean).join(', ').slice(0, 120);
      return {
        id: `${el.type}/${el.id}`,
        kind,
        name,
        lat,
        lon,
        distanceM: Math.round(distanceM(origin, { lat, lon })),
        direction: direction(origin, { lat, lon }),
        hours: tags.opening_hours || '',
        access: tags.access || '',
        indoor: tags.indoor === 'yes',
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.distanceM - b.distanceM);
}

export async function findNearby({ lat, lon, kind = 'aed', radiusM = 1500, fetchImpl = fetch, signal }) {
  const res = await fetchImpl(OVERPASS_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(overpassQuery({ lat, lon, kind, radiusM }))}`,
    signal,
  });
  if (!res.ok) throw new Error(`Map lookup failed (${res.status})`);
  return parsePlaces(await res.json(), { lat, lon }, kind);
}

export const mapLink = (p) => `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=19/${p.lat}/${p.lon}`;
