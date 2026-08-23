const { fetchHtml, stripTags } = require('./fetchSite');
const { callClaude } = require('./claude');
const { fetchStockPhotos } = require('./stockPhotos');

const SITE_TEXT_CAP = 6000; // keep the prompt (and cost) small

async function analyzeWeaknesses(businessName, siteText) {
  const raw = await callClaude(
    `Business: ${businessName}\n\nWebsite text content:\n${siteText}`,
    {
      system:
        'You are a website auditor for a plumbing-automation agency that pitches redesigns to independent plumbers. ' +
        'Given a business name and their current website\'s text content, identify concrete weaknesses ' +
        '(e.g. missing online booking, no reviews/testimonials shown, no clear phone/CTA, dated or generic copy, ' +
        'no service area or emergency-service messaging). Also check whether the text names an owner, founder, or ' +
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

async function generateMockup(businessName, weaknesses, photos, address) {
  // Ask Claude for placeholder tokens rather than real URLs — long CDN URLs
  // are exactly the kind of string an LLM can subtly mistype, and a wrong
  // src just shows a broken image. Swapping in the real URL afterward is
  // deterministic and can't fail that way.
  const photoTokens = (photos || []).map((p, i) => ({ token: `PHOTO_${i + 1}`, ...p }));
  const photoInstructions = photoTokens.length
    ? `Real photos are available for this mockup. Use them as <img> src values using these EXACT placeholder ` +
      `tokens as the whole src attribute (they get swapped for real photo URLs afterward — do not alter them or ` +
      `invent any other image source): ${photoTokens.map((p) => `${p.token} (${p.alt})`).join(', ')}. Place them ` +
      `naturally — e.g. a hero/banner image and a service-in-progress photo. A section without a good fit for one ` +
      `of these can stay CSS-only.\n\n`
    : '';

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

  const html = await callClaude(
    `Business: ${businessName}\nWeaknesses to address: ${weaknesses.join('; ') || 'general modernization'}\n\n` +
      locationInstruction +
      'IMPORTANT: Do not use any outside knowledge you may have about a real business with this or a similar name. ' +
      'Treat the business name as a label only — invent no specific facts (founding year, awards, service area ' +
      'beyond the address above, etc.) not given in this prompt. Any testimonials/reviews you write must be ' +
      'generic and clearly illustrative, never attributed to a real person or a real business.\n\n' +
      photoInstructions +
      'Produce a single self-contained HTML file (inline CSS, no external assets other than the photo tokens ' +
      'above) showing an improved homepage mockup for this plumbing business that fixes the weaknesses above — ' +
      'include a clear booking/call-to-action, a testimonials/reviews section, and a clean modern layout. Keep ' +
      'the CSS reasonably concise — a complete, fully-closed document matters more than exhaustive styling. ' +
      'Respond with ONLY the raw HTML, starting with <!DOCTYPE html>, no explanation before or after.',
    {
      system: 'You produce compact, realistic website mockups as single HTML files for sales outreach purposes.',
      maxTokens: 8192,
    }
  );
  let trimmed = html.trim().replace(/^```html\n?|```$/g, '');
  if (!trimmed.includes('</html>')) {
    // Response was cut off before the document closed — a previous 3000-token
    // cap did this in practice (title tag survives, but no body content ever
    // gets written). Fail loudly rather than store a page that renders blank.
    const err = new Error('Mockup generation was truncated before completing — try running the audit again');
    err.status = 502;
    throw err;
  }
  for (const p of photoTokens) {
    trimmed = trimmed.split(p.token).join(p.url);
  }
  return trimmed;
}

async function runAudit(businessName, websiteUrl, address) {
  const html = await fetchHtml(websiteUrl);
  if (!html) {
    const err = new Error('Could not fetch the website — check the URL is reachable');
    err.status = 422;
    throw err;
  }
  const siteText = stripTags(html).slice(0, SITE_TEXT_CAP);

  const { weaknesses, recommendations, decisionMaker } = await analyzeWeaknesses(businessName, siteText);
  const photos = await fetchStockPhotos('professional plumber at work');
  const mockupHtml = await generateMockup(businessName, weaknesses, photos, address);

  return { weaknesses, recommendations_text: recommendations, mockup_html: mockupHtml, decision_maker: decisionMaker };
}

module.exports = { runAudit };
