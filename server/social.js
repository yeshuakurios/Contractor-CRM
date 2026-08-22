const { fetchHtml, stripTags } = require('./fetchSite');

const PLATFORM_PATTERNS = {
  facebook: /https?:\/\/(?:www\.)?facebook\.com\/[a-zA-Z0-9._/-]+/i,
  instagram: /https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9._/-]+/i,
  x: /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[a-zA-Z0-9._/-]+/i,
};

function normalizeDigits(s) {
  return (s || '').replace(/\D/g, '');
}

// Pulls the first "word chunk" of a street address (e.g. "705" + "Albany")
// to look for on a social profile page — good enough as a loose match signal,
// not meant to be a precise address parser.
function addressFragments(address) {
  if (!address) return [];
  const tokens = address.split(',')[0].trim().split(/\s+/).filter((t) => t.length > 2);
  return tokens.slice(0, 3);
}

function findSocialLinks(html) {
  const found = {};
  for (const [platform, pattern] of Object.entries(PLATFORM_PATTERNS)) {
    const match = html.match(pattern);
    if (match) found[platform] = match[0].split(/[?#]/)[0];
  }
  return found;
}

async function verifyAgainstProfile(url, phone, address) {
  const html = await fetchHtml(url);
  if (!html) return { status: 'unconfirmed', verified_via: null };
  const text = stripTags(html);
  const textDigits = normalizeDigits(text);

  const phoneDigits = normalizeDigits(phone);
  if (phoneDigits && phoneDigits.length >= 7 && textDigits.includes(phoneDigits)) {
    return { status: 'confirmed', verified_via: 'phone' };
  }

  const fragments = addressFragments(address);
  if (fragments.length && fragments.every((f) => text.toLowerCase().includes(f.toLowerCase()))) {
    return { status: 'confirmed', verified_via: 'address' };
  }

  return { status: 'unconfirmed', verified_via: null };
}

// Finds social links referenced on the business's own website, then makes a
// best-effort attempt to verify each by looking for the lead's phone or
// address on the social page itself. Anything short of a concrete match is
// left "unconfirmed" rather than guessed — social platforms frequently gate
// content behind a login wall for unauthenticated fetches, so "unconfirmed"
// is an expected, common outcome, not a bug.
async function discoverAndVerifySocials(websiteUrl, phone, address) {
  const results = { facebook: null, instagram: null, x: null };
  if (!websiteUrl) return results;

  const html = await fetchHtml(websiteUrl);
  if (!html) return results;
  const links = findSocialLinks(html);

  for (const platform of Object.keys(results)) {
    const url = links[platform];
    if (!url) {
      results[platform] = { url: null, status: 'not_found', verified_via: null };
      continue;
    }
    const verification = await verifyAgainstProfile(url, phone, address);
    results[platform] = { url, ...verification };
  }
  return results;
}

module.exports = { discoverAndVerifySocials };
