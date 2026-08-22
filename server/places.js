// Wraps Google's Places API (New) Text Search. Server-side only — the API
// key never reaches the browser.
async function searchPlaces(location, businessType) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    const err = new Error('GOOGLE_PLACES_API_KEY is not configured');
    err.status = 500;
    throw err;
  }

  const textQuery = `${businessType} in ${location}`;
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri',
    },
    body: JSON.stringify({ textQuery }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Places API request failed: ${res.status} ${body}`.slice(0, 500));
    err.status = 502;
    throw err;
  }

  const data = await res.json();
  return (data.places || []).map((p) => ({
    place_id: p.id,
    business_name: p.displayName ? p.displayName.text : '',
    address: p.formattedAddress || '',
    phone: p.nationalPhoneNumber || '',
    website: p.websiteUri || '',
  }));
}

module.exports = { searchPlaces };
