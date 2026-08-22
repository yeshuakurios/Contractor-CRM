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
        'no service area or emergency-service messaging). Respond with ONLY valid JSON, no other text, in this shape: ' +
        '{"weaknesses": ["...", "..."], "recommendations": "a short markdown-formatted recommendations write-up, 150-300 words"}',
      maxTokens: 1200,
    }
  );
  try {
    const parsed = JSON.parse(raw.trim().replace(/^```json\n?|```$/g, ''));
    return {
      weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses : [],
      recommendations: typeof parsed.recommendations === 'string' ? parsed.recommendations : raw,
    };
  } catch {
    return { weaknesses: [], recommendations: raw };
  }
}

async function generateMockup(businessName, weaknesses) {
  const html = await callClaude(
    `Business: ${businessName}\nWeaknesses to address: ${weaknesses.join('; ') || 'general modernization'}\n\n` +
      'Produce a single self-contained HTML file (inline CSS, no external assets) showing an improved homepage ' +
      'mockup for this plumbing business that fixes the weaknesses above — include a clear booking/call-to-action, ' +
      'a testimonials/reviews section, and a clean modern layout. Respond with ONLY the raw HTML, starting with ' +
      '<!DOCTYPE html>, no explanation before or after.',
    {
      system: 'You produce compact, realistic website mockups as single HTML files for sales outreach purposes.',
      maxTokens: 3000,
    }
  );
  return html.trim().replace(/^```html\n?|```$/g, '');
}

async function runAudit(businessName, websiteUrl) {
  const html = await fetchHtml(websiteUrl);
  if (!html) {
    const err = new Error('Could not fetch the website — check the URL is reachable');
    err.status = 422;
    throw err;
  }
  const siteText = stripTags(html).slice(0, SITE_TEXT_CAP);

  const { weaknesses, recommendations } = await analyzeWeaknesses(businessName, siteText);
  const mockupHtml = await generateMockup(businessName, weaknesses);

  return { weaknesses, recommendations_text: recommendations, mockup_html: mockupHtml };
}

module.exports = { runAudit };
