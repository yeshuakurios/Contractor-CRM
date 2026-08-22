// Fetches a URL's HTML with a timeout and size cap, and provides a crude
// tag-stripped text view — no HTML parser dependency needed for our uses
// (regex link-scraping and feeding readable text to an LLM prompt).
const MAX_BYTES = 300_000;
const TIMEOUT_MS = 10_000;

async function fetchHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ContractorCRM-Audit/1.0)' },
    });
    if (!res.ok) return null;
    // Cap how much we read to avoid huge pages ballooning memory/token cost.
    const buf = await res.arrayBuffer();
    const bytes = buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf;
    return Buffer.from(bytes).toString('utf8');
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { fetchHtml, stripTags };
