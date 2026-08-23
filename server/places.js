// Wraps Google's Places API (New) Text Search. Server-side only — the API
// key never reaches the browser.
const FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,nextPageToken';
const MAX_PAGES = 3; // Text Search caps each request at 20 results; 3 pages = up to 60.
const PAGE_TOKEN_DELAY_MS = 2000; // Google's next_page_token needs a moment to become valid.

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
// so this returns up to 60) — a single request only returned Google's first
// page, which is why imports were capped at ~20 regardless of how many
// matching businesses actually existed in the area.
async function searchPlaces(location, businessType) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    const err = new Error('GOOGLE_PLACES_API_KEY is not configured');
    err.status = 500;
    throw err;
  }

  const textQuery = `${businessType} in ${location}`;
  const results = [];
  let pageToken;

  for (let page = 0; page < MAX_PAGES; page++) {
    const body = pageToken ? { textQuery, pageToken } : { textQuery, pageSize: 20 };
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
