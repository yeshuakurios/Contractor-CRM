const express = require('express');
const { pool } = require('./db');

const router = express.Router();

function escapeHtml(s) {
  return (s || '').toString().replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Minimal markdown-lite renderer for Claude's recommendations text (which
// uses **bold** and paragraph breaks, sometimes loose numbered lines) — not
// a full markdown parser, just enough to not show raw asterisks to a client.
function renderMarkdownLite(text) {
  const escaped = escapeHtml(text);
  const bolded = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return bolded
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${block.replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

async function fetchReport(token) {
  const { rows } = await pool.query(
    `SELECT ar.status, ar.mockup_html, ar.weaknesses, ar.recommendations_text, l.business_name
     FROM audit_reports ar JOIN leads l ON l.id = ar.lead_id
     WHERE ar.public_token = $1`,
    [token]
  );
  return rows[0];
}

// Unauthenticated by design — this is the outreach deliverable sent to a
// prospect, who never logs into the CRM. The token is a random UUID, not a
// guessable sequential id, so knowing one mockup's link doesn't expose others.

// The combined report page: weaknesses + recommendations, with the mockup
// embedded below — the single link an operator sends to a prospect.
router.get('/mockup/:token', async (req, res, next) => {
  try {
    const report = await fetchReport(req.params.token);
    if (!report) return res.status(404).send('Not found');
    if (report.status !== 'done' || !report.mockup_html) {
      return res.status(404).send('This report is not ready yet.');
    }

    const weaknesses = Array.isArray(report.weaknesses) ? report.weaknesses : [];
    const siteUrl = `/mockup/${encodeURIComponent(req.params.token)}/site`;

    res.set('Content-Type', 'text/html').send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(report.business_name)} — Website Review</title>
<style>
  body{font-family:Georgia,serif;background:#f7f5f0;color:#1c2321;margin:0;padding:0 16px 60px;}
  .wrap{max-width:760px;margin:0 auto;}
  header{padding:32px 0 16px;}
  header h1{font-size:1.5rem;margin:0 0 6px;}
  header p{color:#6b6558;font-family:'Courier New',monospace;font-size:0.85rem;margin:0;}
  .card{background:#fff;border:1px solid #d8d2c4;border-radius:8px;padding:20px;margin-bottom:20px;}
  .card h2{font-size:1.05rem;margin:0 0 12px;font-family:'Courier New',monospace;text-transform:uppercase;letter-spacing:0.03em;color:#2f5d62;}
  ul{margin:0;padding-left:20px;}
  li{margin-bottom:8px;}
  p{line-height:1.6;margin:0 0 12px;}
  .mockup-frame{width:100%;height:80vh;border:1px solid #d8d2c4;border-radius:8px;}
  .fullscreen-link{display:inline-block;margin-top:10px;font-family:'Courier New',monospace;font-size:0.8rem;}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>${escapeHtml(report.business_name)}</h1>
    <p>Website Review &amp; Redesign Preview</p>
  </header>

  ${weaknesses.length ? `
  <div class="card">
    <h2>What We Found</h2>
    <ul>${weaknesses.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>
  </div>` : ''}

  ${report.recommendations_text ? `
  <div class="card">
    <h2>Recommendations</h2>
    ${renderMarkdownLite(report.recommendations_text)}
  </div>` : ''}

  <div class="card">
    <h2>Preview of Your New Site</h2>
    <iframe class="mockup-frame" src="${siteUrl}" title="Website mockup preview"></iframe>
    <a class="fullscreen-link" href="${siteUrl}" target="_blank" rel="noopener">Open full-size in a new tab →</a>
  </div>
</div>
</body>
</html>`);
  } catch (err) { next(err); }
});

// Raw mockup only — used inside the iframe above, and as the "open full
// size" link.
router.get('/mockup/:token/site', async (req, res, next) => {
  try {
    const report = await fetchReport(req.params.token);
    if (!report) return res.status(404).send('Not found');
    if (report.status !== 'done' || !report.mockup_html) {
      return res.status(404).send('This mockup is not ready yet.');
    }
    res.set('Content-Type', 'text/html').send(report.mockup_html);
  } catch (err) { next(err); }
});

module.exports = { router };
