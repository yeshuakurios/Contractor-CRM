// Free stock photos for generated mockups. Pexels is tried first (generally
// higher-quality curated results); Pixabay is a fallback if no Pexels key is
// set or the request fails. Both APIs' src URLs are meant for direct
// hotlinking, so callers can embed them as-is.

const PEXELS_ENDPOINT = 'https://api.pexels.com/v1/search';
const PIXABAY_ENDPOINT = 'https://pixabay.com/api/';

async function fetchFromPexels(query, count) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(
      `${PEXELS_ENDPOINT}?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape`,
      { headers: { Authorization: key } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return (data.photos || []).map((p) => ({ url: p.src.large, alt: p.alt || query }));
  } catch {
    return null;
  }
}

async function fetchFromPixabay(query, count) {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) return null;
  try {
    // Pixabay rejects per_page below 3.
    const perPage = Math.max(count, 3);
    const res = await fetch(
      `${PIXABAY_ENDPOINT}?key=${key}&q=${encodeURIComponent(query)}&image_type=photo&orientation=horizontal&per_page=${perPage}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return (data.hits || []).slice(0, count).map((h) => ({ url: h.largeImageURL, alt: h.tags || query }));
  } catch {
    return null;
  }
}

async function fetchStockPhotos(query, count = 3) {
  const fromPexels = await fetchFromPexels(query, count);
  if (fromPexels && fromPexels.length) return fromPexels;
  const fromPixabay = await fetchFromPixabay(query, count);
  return fromPixabay || [];
}

module.exports = { fetchStockPhotos };
