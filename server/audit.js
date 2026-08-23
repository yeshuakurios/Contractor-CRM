const { fetchHtml, stripTags } = require('./fetchSite');
const { callClaude } = require('./claude');

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
        'never guess or infer one from the business name. Respond with ONLY valid JSON, no other text, in this shape: ' +
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

async function generateMockup(businessName, weaknesses) {
  const html = await callClaude(
    `Business: ${businessName}\nWeaknesses to address: ${weaknesses.join('; ') || 'general modernization'}\n\n` +
      'Produce a single self-contained HTML file (inline CSS, no external assets) showing an improved homepage ' +
      'mockup for this plumbing business that fixes the weaknesses above — include a clear booking/call-to-action, ' +
      'a testimonials/reviews section, and a clean modern layout. Keep the CSS reasonably concise — a complete, ' +
      'fully-closed document matters more than exhaustive styling. Respond with ONLY the raw HTML, starting with ' +
      '<!DOCTYPE html>, no explanation before or after.',
    {
      system: 'You produce compact, realistic website mockups as single HTML files for sales outreach purposes.',
      maxTokens: 8192,
    }
  );
  const trimmed = html.trim().replace(/^```html\n?|```$/g, '');
  if (!trimmed.includes('</html>')) {
    // Response was cut off before the document closed — a previous 3000-token
    // cap did this in practice (title tag survives, but no body content ever
    // gets written). Fail loudly rather than store a page that renders blank.
    const err = new Error('Mockup generation was truncated before completing — try running the audit again');
    err.status = 502;
    throw err;
  }
  return trimmed;
}

async function runAudit(businessName, websiteUrl) {
  const html = await fetchHtml(websiteUrl);
  if (!html) {
    const err = new Error('Could not fetch the website — check the URL is reachable');
    err.status = 422;
    throw err;
  }
  const siteText = stripTags(html).slice(0, SITE_TEXT_CAP);

  const { weaknesses, recommendations, decisionMaker } = await analyzeWeaknesses(businessName, siteText);
  const mockupHtml = await generateMockup(businessName, weaknesses);

  return { weaknesses, recommendations_text: recommendations, mockup_html: mockupHtml, decision_maker: decisionMaker };
}

module.exports = { runAudit };
