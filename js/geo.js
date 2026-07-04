/**
 * CubanSocial — Geolocation & Haversine utilities
 */

const EARTH_RADIUS_MI = 3958.8;

/**
 * Haversine distance between two lat/lon points (in miles).
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} distance in miles
 */
export function haversine(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat  = toRad(lat2 - lat1);
  const dLon  = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_MI * 2 * Math.asin(Math.sqrt(a));
}

/**
 * Request browser geolocation. Returns a {lat, lon} promise.
 * Resolves null if denied or unavailable.
 */
export function requestGeolocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lon: coords.longitude }),
      ()           => resolve(null),
      { timeout: 8000, maximumAge: 60_000 }
    );
  });
}

/**
 * Given user coords and the cities array, return the nearest city
 * within maxMiles, or null if none found.
 * @param {{lat:number, lon:number}} userCoords
 * @param {Array<{id:string, lat:number, lon:number}>} cities
 * @param {number} maxMiles
 */
export function nearestCity(userCoords, cities, maxMiles = 30) {
  let best = null;
  let bestDist = Infinity;
  for (const city of cities) {
    const d = haversine(userCoords.lat, userCoords.lon, city.lat, city.lon);
    if (d < bestDist && d <= maxMiles) { best = city; bestDist = d; }
  }
  return best;
}

/**
 * Return all cities within maxMiles of userCoords.
 */
export function citiesWithinRadius(userCoords, cities, maxMiles = 80) {
  return cities.filter((c) =>
    haversine(userCoords.lat, userCoords.lon, c.lat, c.lon) <= maxMiles
  );
}

const STORAGE_KEY        = 'cubansocial_city';
const RADIUS_STORAGE_KEY = 'cubansocial_radius';

export function saveCity(cityId) {
  try { localStorage.setItem(STORAGE_KEY, cityId); } catch {}
}

export function loadCity() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

/**
 * Persist the selected radius (miles; 0 = Any distance).
 * @param {number} miles
 */
export function saveRadius(miles) {
  try { localStorage.setItem(RADIUS_STORAGE_KEY, String(miles)); } catch {}
}

/**
 * Restore the saved radius, defaulting to 25 miles (per PRD §6.3).
 * @returns {number}
 */
export function loadRadius() {
  try {
    const v = localStorage.getItem(RADIUS_STORAGE_KEY);
    return v !== null ? parseInt(v, 10) : 25;
  } catch { return 25; }
}
