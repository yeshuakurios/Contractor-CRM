// Wraps Google's Places API (New) Text Search, plus Geocoding to turn a
// city name into a search radius. Server-side only — the API key never
// reaches the browser.
const FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,nextPageToken';
const MAX_PAGES = 3; // Text Search caps each request at 20 results; 3 pages = up to 60.
const PAGE_TOKEN_DELAY_MS = 2000; // Google's next_page_token needs a moment to become valid.
const DEFAULT_RADIUS_METERS = 40000; // ~25 miles — covers a city's suburbs, not just its core.

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Best-effort: a plain city/state string only tells Text Search's relevance
// ranking to *prefer* that area, which under-covers suburbs (e.g. "plumber
// in Cincinnati, OH" barely surfaces West Chester, ~20mi out). Geocoding the
// location and biasing Text Search to a real radius around it fixes that.
// Returns null on any failure so callers can fall back to the plain query
// instead of failing the whole import over a geocoding hiccup.
async function geocodeLocation(location) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.status !== 'OK' || !data.results || !data.results[0]) {
      console.error('Geocoding failed for', location, ':', data.status, data.error_message || '');
      return null;
    }
    const { lat, lng } = data.results[0].geometry.location;
    return { latitude: lat, longitude: lng };
  } catch (err) {
    console.error('Geocoding request failed for', location, err.message);
    return null;
  }
}

async function fetchPage(apiKey, body) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Places API request failed: ${res.status} ${text}`.slice(0, 500));
    err.status = 502;
    throw err;
  }
  return res.json();
}

// Fetches up to MAX_PAGES pages (Text Search's per-request cap is 20 results,
// so this returns up to 60), biased to a real radius around the geocoded
// location when geocoding succeeds — falls back to a plain text query
// otherwise (e.g. Geocoding API not yet enabled on the project).
async function searchPlaces(location, businessType, radiusMeters = DEFAULT_RADIUS_METERS) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    const err = new Error('GOOGLE_PLACES_API_KEY is not configured');
    err.status = 500;
    throw err;
  }

  const center = await geocodeLocation(location);
  const textQuery = `${businessType} near ${location}`;
  const locationBias = center ? { circle: { center, radius: radiusMeters } } : undefined;

  const results = [];
  let pageToken;

  for (let page = 0; page < MAX_PAGES; page++) {
    const body = pageToken
      ? { textQuery, pageToken }
      : { textQuery, pageSize: 20, ...(locationBias ? { locationBias } : {}) };
    const data = await fetchPage(apiKey, body);

    for (const p of data.places || []) {
      results.push({
        place_id: p.id,
        business_name: p.displayName ? p.displayName.text : '',
        address: p.formattedAddress || '',
        phone: p.nationalPhoneNumber || '',
        website: p.websiteUri || '',
      });
    }

    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
    await sleep(PAGE_TOKEN_DELAY_MS);
  }

  return results;
}

module.exports = { searchPlaces };
