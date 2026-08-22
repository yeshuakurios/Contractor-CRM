const express = require('express');
const { pool } = require('./db');
const { searchPlaces } = require('./places');

const router = express.Router();

const OUTREACH_STATUSES = ['New', 'Mockup Generated', 'Sent to Prospect', 'Followed Up', 'Responded', 'Declined'];
const EDITABLE_FIELDS = ['business_name', 'phone', 'address', 'website', 'email', 'decision_maker', 'outreach_status'];

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, business_name, phone, address, website, email, decision_maker,
              outreach_status, pipeline_stage, created_at, updated_at
       FROM leads ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM leads WHERE id = $1', [req.params.id]);
    const lead = rows[0];
    if (!lead) return res.status(404).json({ error: 'Not found' });

    const [activity, socials] = await Promise.all([
      pool.query('SELECT id, author, text, created_at FROM activity_log WHERE lead_id = $1 ORDER BY created_at DESC', [lead.id]),
      pool.query('SELECT platform, url, verification_status, verified_via, verified_at FROM lead_socials WHERE lead_id = $1', [lead.id]),
    ]);

    res.json({ ...lead, activity: activity.rows, socials: socials.rows });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const lead = await createLead(req.body || {});
    res.status(201).json(lead);
  } catch (err) { next(err); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const updates = req.body || {};
    const fields = Object.keys(updates).filter((k) => EDITABLE_FIELDS.includes(k));
    if (!fields.length) return res.status(400).json({ error: 'No editable fields provided' });
    if (updates.outreach_status && !OUTREACH_STATUSES.includes(updates.outreach_status)) {
      return res.status(400).json({ error: 'Invalid outreach_status' });
    }

    const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
    const values = fields.map((f) => updates[f]);
    values.push(req.params.id);

    const { rows } = await pool.query(
      `UPDATE leads SET ${setClause}, updated_at = now() WHERE id = $${fields.length + 1} RETURNING *`,
      values
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM leads WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (err) { next(err); }
});

router.post('/:id/notes', async (req, res, next) => {
  try {
    const text = (req.body && req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text is required' });
    const { rows } = await pool.query(
      `INSERT INTO activity_log (lead_id, author, text) VALUES ($1, $2, $3) RETURNING *`,
      [req.params.id, req.body.author || null, text]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// Paste-based import: "Name, Phone, Address" per line (tab or comma separated).
// Dedupes against existing leads by exact business_name match or matching non-empty phone.
router.post('/import', async (req, res, next) => {
  try {
    const text = (req.body && req.body.text) || '';
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const parsed = lines
      .map((line) => {
        const parts = line.split(/\t|,/).map((p) => p.trim());
        return { name: parts[0] || '', phone: parts[1] || '', address: parts.slice(2).join(', ') || '' };
      })
      .filter((p) => p.name);

    const created = [];
    const duplicates = [];
    for (const p of parsed) {
      const { rows } = await pool.query(
        `SELECT id, business_name FROM leads
         WHERE lower(business_name) = lower($1) OR ($2 <> '' AND phone = $2)`,
        [p.name, p.phone]
      );
      if (rows[0]) {
        duplicates.push({ incoming: p, existing: rows[0] });
      } else {
        const lead = await createLead({ business_name: p.name, phone: p.phone, address: p.address });
        created.push(lead);
      }
    }
    res.json({ created, duplicates });
  } catch (err) { next(err); }
});

async function createLead({ business_name, phone, address, website, email, decision_maker, place_id }) {
  if (!business_name || !business_name.trim()) {
    const err = new Error('business_name is required');
    err.status = 400;
    throw err;
  }
  const { rows } = await pool.query(
    `INSERT INTO leads (business_name, phone, address, website, email, decision_maker, place_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [business_name.trim(), phone || null, address || null, website || null, email || null, decision_maker || null, place_id || null]
  );
  return rows[0];
}

// Google Places import: search by location + business type, dedupe against
// existing leads (by place_id first, falling back to name/phone match for
// leads that predate having a place_id), bulk-create the rest.
router.post('/import/places', async (req, res, next) => {
  try {
    const { location, businessType } = req.body || {};
    if (!location || !location.trim()) return res.status(400).json({ error: 'location is required' });
    const results = await searchPlaces(location.trim(), (businessType || 'plumber').trim());

    const created = [];
    const duplicates = [];
    for (const p of results) {
      if (!p.business_name) continue;
      const { rows } = await pool.query(
        `SELECT id, business_name FROM leads
         WHERE place_id = $1 OR lower(business_name) = lower($2) OR ($3 <> '' AND phone = $3)`,
        [p.place_id, p.business_name, p.phone]
      );
      if (rows[0]) {
        duplicates.push({ incoming: p, existing: rows[0] });
      } else {
        created.push(await createLead(p));
      }
    }
    res.json({ created, duplicates, query: `${businessType || 'plumber'} in ${location}` });
  } catch (err) { next(err); }
});

module.exports = router;
