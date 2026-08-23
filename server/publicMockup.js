const express = require('express');
const { pool } = require('./db');

const router = express.Router();

// Unauthenticated by design — this is the outreach deliverable sent to a
// prospect, who never logs into the CRM. The token is a random UUID, not a
// guessable sequential id, so knowing one mockup's link doesn't expose others.
router.get('/mockup/:token', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT status, mockup_html FROM audit_reports WHERE public_token = $1',
      [req.params.token]
    );
    const report = rows[0];
    if (!report) return res.status(404).send('Not found');
    if (report.status !== 'done' || !report.mockup_html) {
      return res.status(404).send('This mockup is not ready yet.');
    }
    res.set('Content-Type', 'text/html').send(report.mockup_html);
  } catch (err) { next(err); }
});

module.exports = { router };
