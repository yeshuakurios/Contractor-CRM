// Best-effort brand extraction from a business's own site HTML — reuses the
// HTML already fetched for weakness analysis, no extra request. Confidence
// gated like socials/email: return null rather than guess, and the mockup
// falls back to a clean text wordmark / the template's default accent.

const LOGO_HINT = /logo/i;
const NEAR_NEUTRAL = /^#?(fff+|000+|[0-9a-f]{2})\1\1$/i; // pure white/black/gray shorthand-ish

function resolveUrl(src, baseUrl) {
  try {
    return new URL(src, baseUrl).href;
  } catch {
    return null;
  }
}

// Looks for an <img> whose src, alt, or class hints "logo", preferring ones
// that also appear early in the document (header/nav area). Doesn't parse
// the DOM — a plain regex scan over <img ...> tags is good enough here and
// avoids pulling in an HTML parser dependency for a best-effort heuristic.
function extractLogoUrl(html, baseUrl) {
  const imgTagPattern = /<img\b[^>]*>/gi;
  const tags = html.match(imgTagPattern) || [];
  for (const tag of tags.slice(0, 60)) {
    // only look near the top of the page — a logo late in the document is
    // most likely something else entirely.
    if (!LOGO_HINT.test(tag)) continue;
    const srcMatch = tag.match(/\bsrc=["']([^"']+)["']/i);
    if (!srcMatch) continue;
    const src = srcMatch[1];
    if (src.startsWith('data:')) continue; // inline placeholder, not a real asset
    const resolved = resolveUrl(src, baseUrl);
    if (resolved) return resolved;
  }
  return null;
}

function isNearNeutral(hex) {
  const h = hex.replace('#', '').toLowerCase();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (full.length !== 6) return true;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  // low saturation (grayscale-ish) or extreme lightness/darkness — not a
  // useful "brand" accent color even if it's technically not pure #fff/#000.
  const lightness = (max + min) / 2 / 255;
  const saturation = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
  return saturation < 0.25 || lightness > 0.92 || lightness < 0.08;
}

// Tallies hex colors found in inline styles and <style> blocks, ignoring
// grayscale/near-white/near-black, and returns the most common one — a
// reasonable proxy for "the color this business uses for buttons/accents"
// without needing a real CSS parser.
function extractAccentColor(html) {
  const styleContent = (html.match(/<style[\s\S]*?<\/style>/gi) || []).join(' ')
    + ' ' + (html.match(/style=["'][^"']*["']/gi) || []).join(' ');
  const hexMatches = styleContent.match(/#[0-9a-f]{3}(?:[0-9a-f]{3})?\b/gi) || [];
  const counts = new Map();
  for (const hex of hexMatches) {
    if (isNearNeutral(hex)) continue;
    const key = hex.toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (!counts.size) return null;
  let best = null, bestCount = 0;
  for (const [hex, count] of counts) {
    if (count > bestCount) { best = hex; bestCount = count; }
  }
  // Seeing it only once is too weak a signal to commit a business's whole
  // mockup accent color to — could just be one random decorative element.
  return bestCount >= 2 ? best : null;
}

module.exports = { extractLogoUrl, extractAccentColor };
