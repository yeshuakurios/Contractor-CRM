const { fetchHtml, stripTags } = require('./fetchSite');
const { callClaude } = require('./claude');
const { fetchStockPhotos } = require('./stockPhotos');
const { extractLogoUrl, extractAccentColor } = require('./branding');
const { detectEmbeddedFeatures, detectTextSignals } = require('./featureDetect');
const { SECTION_GUIDE, pickTemplate } = require('./mockupTemplates');

const SITE_TEXT_CAP = 6000; // keep the prompt (and cost) small

function escapeHtml(s) {
  return (s || '').toString().replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function analyzeWeaknesses(businessName, siteText, detectedFeatures) {
  const detectedNote = (detectedFeatures && detectedFeatures.length)
    ? `\n\nThe page also embeds the following third-party widgets (detected via <script>/<iframe> tags in the raw ` +
      `HTML): ${detectedFeatures.join(', ')}. These render via JavaScript, so their content does not appear in the ` +
      `text content above — but they ARE present and working on the site. Do not list any of them, or the ` +
      `functionality they provide, as a weakness or missing feature.`
    : '';
  const textSignals = detectTextSignals(siteText);
  const textSignalNote = textSignals.length
    ? `\n\nAn automated keyword scan of the text content above already found: ${textSignals.join(', ')}. Before ` +
      `writing a weakness that claims one of these is missing, re-read the text content for it — if the scan found ` +
      `it, it's there, so do not claim it's absent.`
    : '';
  const raw = await callClaude(
    `Business: ${businessName}\n\nWebsite text content:\n${siteText}${detectedNote}${textSignalNote}`,
    {
      system:
        'You are a website auditor for a plumbing-automation agency that pitches redesigns to independent plumbers. ' +
        'Given a business name and their current website\'s text content, identify concrete weaknesses ' +
        '(e.g. missing online booking, no reviews/testimonials shown, no clear phone/CTA, dated or generic copy, ' +
        'no service area or emergency-service messaging). Only report something as missing if you cannot find it, ' +
        'or a close synonym of it, anywhere in the given text — quote or closely paraphrase the site\'s own words ' +
        'when confirming a strength is present, and never claim an absence you have not actually checked the full ' +
        'text for. Also check whether the text names an owner, founder, or ' +
        'manager (e.g. an "About Us" or "Meet the Owner" blurb) — only extract a name if the site actually states one; ' +
        'never guess or infer one from the business name. If you name a specific person anywhere in your weaknesses ' +
        'or recommendations text, you MUST also put that same name in decision_maker — never mention someone by name ' +
        'in the write-up while leaving decision_maker null. Respond with ONLY valid JSON, no other text, in this shape: ' +
        '{"weaknesses": ["...", "..."], "recommendations": "a short markdown-formatted recommendations write-up, 150-300 words", ' +
        '"decision_maker": "the named owner/founder/manager, or null if the site does not name one"}',
      maxTokens: 1200,
    }
  );
  try {
    const parsed = JSON.parse(raw.trim().replace(/^```json\n?|```$/g, ''));
    return {
      weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses : [],
      recommendations: typeof parsed.recommendations === 'string' ? parsed.recommendations : raw,
      decisionMaker: typeof parsed.decision_maker === 'string' && parsed.decision_maker.trim() ? parsed.decision_maker.trim() : null,
    };
  } catch {
    return { weaknesses: [], recommendations: raw, decisionMaker: null };
  }
}

// Free stock libraries have thin, inconsistently-tagged coverage of niche
// trades — a generic "professional plumber" search can return unrelated
// results (an electrician, an office worker) that just happen to rank for
// that query. Filtering on the photo's own alt/tags text for an actual
// plumbing keyword catches those before they end up on a mockup; if
// filtering leaves nothing (a thin result set), falling back to the
// unfiltered pool beats showing no photo at all.
const PLUMBING_KEYWORDS = /plumb|pipe|faucet|drain|sink|water heater|leak|wrench|bathroom|toilet|shower/i;

// Fetches a larger pool than we need and prefers photos not already used by
// another lead in the same market (see leads.js), so nearby leads don't end
// up with a literally identical hero photo — the single most noticeable
// "these sites look copy-pasted" tell.
async function pickPhotos(avoidPhotoUrls) {
  const pool = await fetchStockPhotos('plumber fixing pipe', 8);
  const relevant = pool.filter((p) => PLUMBING_KEYWORDS.test(p.alt || ''));
  const candidates = relevant.length ? relevant : pool;
  const avoid = new Set(avoidPhotoUrls || []);
  const fresh = candidates.filter((p) => !avoid.has(p.url));
  return (fresh.length ? fresh : candidates).slice(0, 2);
}

async function generateMockup({ businessName, weaknesses, address, template, photos, logoUrl, accentColor }) {
  // Ask Claude for placeholder tokens rather than real photo URLs — long CDN
  // URLs are exactly the kind of string an LLM can subtly mistype, and a
  // wrong src just shows a broken image. Swapping in the real URL afterward
  // is deterministic and can't fail that way.
  const photoTokens = (photos || []).map((p, i) => ({ token: `PHOTO_${i + 1}`, ...p }));
  const photoInstructions = photoTokens.length
    ? `Real photos are available. Use these EXACT placeholder tokens as <img> src values (they get swapped for ` +
      `real photo URLs afterward — do not alter them): ${photoTokens.map((p) => `${p.token} (${p.alt})`).join(', ')}.\n\n`
    : `No stock photos are available — omit the <img> tags the section guide mentions and let those spots stay CSS-only.\n\n`;

  // A business name alone is exactly the kind of proper noun an LLM can
  // conflate with a real, similarly-named company it knows from training —
  // this has actually happened (a mockup pulled in a real NY-based
  // business's location). Grounding it to the lead's real address and
  // explicitly forbidding outside knowledge closes that off.
  const locationInstruction = address
    ? `This business's real address is: ${address}. Any location-specific copy (service area, city mentions, etc.) ` +
      `must use ONLY this location — never a different city, state, or region.\n`
    : `No address was provided for this business — keep any location references generic (e.g. "your area", "the ` +
      `local community") rather than inventing a specific city or state.\n`;

  // A real logo almost always already has the business name baked into the
  // graphic (a wordmark or a badge with the name inside it) — printing the
  // name again as separate text next to it just duplicates what's already
  // shown, and gets cramped/truncated on narrow screens for no reason.
  const logoInstruction = logoUrl
    ? `A real logo image was found on this business's own site — use ONLY the image, no business-name text next ` +
      `to it (the logo almost certainly already shows the name): <a class="brand"><img src="${logoUrl}" ` +
      `alt="${businessName} logo" style="height:36px;width:auto;"></a>\n`
    : `No logo image was found — the .brand element should be the business name as styled text only, no <img>.\n`;

  const accentInstruction = accentColor
    ? `This business's own site uses ${accentColor} as its brand color — after the section markup, add exactly one ` +
      `line <style>:root{${template.accentVar}: ${accentColor};}</style> so the mockup picks up their real branding.\n`
    : '';

  const html = await callClaude(
    `Business: ${businessName}\nWeaknesses to address: ${weaknesses.join('; ') || 'general modernization'}\n\n` +
      locationInstruction +
      'IMPORTANT: Do not use any outside knowledge you may have about a real business with this or a similar name. ' +
      'Treat the business name as a label only — invent no specific facts (founding year, awards, service area ' +
      'beyond the address above, etc.) not given in this prompt. Any testimonials/reviews you write must be ' +
      'generic and clearly illustrative, never attributed to a real person or a real business.\n\n' +
      logoInstruction + accentInstruction + '\n' +
      photoInstructions +
      SECTION_GUIDE +
      '\n\nRespond with ONLY the HTML that goes between <body> and </body> — no <!DOCTYPE>, <html>, <head>, or ' +
      '<body> tags themselves, no markdown code fences, no explanation before or after.',
    {
      system: 'You produce compact, realistic website mockup content for sales outreach, filling a fixed, ' +
        'already-styled section template with a specific business\'s content.',
      maxTokens: 8192,
    }
  );

  let fragment = html.trim().replace(/^```html\n?|```$/g, '').replace(/```$/g, '').trim();
  fragment = fragment.replace(/^<body[^>]*>/i, '').replace(/<\/body>\s*$/i, '').trim();

  // Truncation check, adapted for a body fragment rather than a full
  // document: every opened <section> must close, and the fragment must
  // reach the footer — a previous 3000-token cap cut generation off
  // mid-document in practice, so failing loudly beats storing a partial page.
  const openSections = (fragment.match(/<section\b/gi) || []).length;
  const closeSections = (fragment.match(/<\/section>/gi) || []).length;
  if (!fragment || openSections !== closeSections || !fragment.includes('</footer>')) {
    const err = new Error('Mockup generation was truncated before completing — try running the audit again');
    err.status = 502;
    throw err;
  }

  for (const p of photoTokens) {
    fragment = fragment.split(p.token).join(p.url);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(businessName)}</title>
${template.fontImport}
<style>${template.css}</style>
</head>
<body>
${fragment}
</body>
</html>`;
}

async function runAudit(businessName, websiteUrl, address, opts = {}) {
  const { leadId, avoidTemplateIds, avoidPhotoUrls } = opts;

  const html = await fetchHtml(websiteUrl);
  if (!html) {
    const err = new Error('Could not fetch the website — check the URL is reachable');
    err.status = 422;
    throw err;
  }
  const siteText = stripTags(html).slice(0, SITE_TEXT_CAP);
  const detectedFeatures = detectEmbeddedFeatures(html);

  const { weaknesses, recommendations, decisionMaker } = await analyzeWeaknesses(businessName, siteText, detectedFeatures);

  const template = pickTemplate(leadId, avoidTemplateIds);
  const logoUrl = extractLogoUrl(html, websiteUrl);
  const accentColor = extractAccentColor(html);
  const photos = await pickPhotos(avoidPhotoUrls);

  const mockupHtml = await generateMockup({ businessName, weaknesses, address, template, photos, logoUrl, accentColor });

  return {
    weaknesses,
    recommendations_text: recommendations,
    mockup_html: mockupHtml,
    decision_maker: decisionMaker,
    style_template: template.id,
    style_photo_urls: photos.map((p) => p.url),
  };
}

module.exports = { runAudit };
