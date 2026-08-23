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
    // Responsive page builders (Duda/Hibu, Wix, etc.) commonly render the full
    // nav menu 2-3 times over — once per breakpoint, plus a mobile drawer
    // copy — all as real <nav> elements ahead of the actual page content in
    // document order. Left in, that boilerplate alone can eat the entire
    // SITE_TEXT_CAP budget before the audit ever reaches the business's real
    // copy, making real content (licensing, warranty, pricing, etc.) look
    // "missing" simply because it was truncated away, not because it's absent.
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { fetchHtml, stripTags };
