const express = require('express');
const { randomUUID } = require('crypto');
const { pool } = require('./db');
const { searchPlaces } = require('./places');
const { discoverAndVerifySocials } = require('./social');
const { runAudit } = require('./audit');
const { computeStages, fetchStageItemRows } = require('./stages');
const { getOrCreateBillingRow } = require('./billing');
const { isLikelyChain } = require('./chains');

const router = express.Router();

const OUTREACH_STATUSES = ['New', 'Mockup Generated', 'Sent to Prospect', 'Followed Up', 'Responded', 'Declined', 'No Digital Presence'];
const EDITABLE_FIELDS = ['business_name', 'phone', 'address', 'website', 'email', 'decision_maker', 'outreach_status'];
const SOCIAL_PLATFORMS = ['facebook', 'instagram', 'x'];

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

    const [activity, socials, audits, stageItems, billing] = await Promise.all([
      pool.query('SELECT id, author, text, created_at FROM activity_log WHERE lead_id = $1 ORDER BY created_at DESC', [lead.id]),
      pool.query('SELECT platform, url, verification_status, verified_via, verified_at FROM lead_socials WHERE lead_id = $1', [lead.id]),
      pool.query('SELECT * FROM audit_reports WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 1', [lead.id]),
      fetchStageItemRows(lead.id),
      getOrCreateBillingRow(lead.id),
    ]);

    res.json({
      ...lead,
      activity: activity.rows,
      socials: socials.rows,
      latest_audit: audits.rows[0] || null,
      stages: computeStages(stageItems, lead.pipeline_stage, billing),
      billing,
    });
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

router.post('/bulk-delete', async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
    if (!ids.length) return res.status(400).json({ error: 'ids must be a non-empty array of lead ids' });
    const { rowCount } = await pool.query('DELETE FROM leads WHERE id = ANY($1::int[])', [ids]);
    res.json({ deleted: rowCount });
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

// Manual edits to the per-platform social links shown in the lead form.
// Marks each as verification_status='manual' so a future audit re-run never
// silently overwrites a value the operator typed in themselves — an empty
// value removes the row instead (so re-running the audit can rediscover it).
router.post('/:id/socials', async (req, res, next) => {
  try {
    const body = req.body || {};
    const results = [];
    for (const platform of SOCIAL_PLATFORMS) {
      if (!(platform in body)) continue;
      const url = (body[platform] || '').trim();
      if (url) {
        const { rows } = await pool.query(
          `INSERT INTO lead_socials (lead_id, platform, url, verification_status, verified_via, verified_at)
           VALUES ($1, $2, $3, 'manual', null, now())
           ON CONFLICT (lead_id, platform) DO UPDATE SET
             url = EXCLUDED.url, verification_status = 'manual', verified_via = null, verified_at = now()
           RETURNING *`,
          [req.params.id, platform, url]
        );
        results.push(rows[0]);
      } else {
        await pool.query('DELETE FROM lead_socials WHERE lead_id = $1 AND platform = $2', [req.params.id, platform]);
      }
    }
    res.json(results);
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

// Google Places import: search by location + business type (paginated, up to
// 60 raw results), filter out recognized franchise/chain brands, dedupe
// against existing leads (by place_id first, falling back to name/phone
// match for leads that predate having a place_id), bulk-create the rest.
router.post('/import/places', async (req, res, next) => {
  try {
    const { location, businessType } = req.body || {};
    if (!location || !location.trim()) return res.status(400).json({ error: 'location is required' });
    const results = await searchPlaces(location.trim(), (businessType || 'plumber').trim());

    const created = [];
    const duplicates = [];
    const filteredChains = [];
    for (const p of results) {
      if (!p.business_name) continue;
      if (isLikelyChain(p.business_name)) {
        filteredChains.push(p);
        continue;
      }
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
    res.json({ created, duplicates, filtered_chains: filteredChains, query: `${businessType || 'plumber'} in ${location}` });
  } catch (err) { next(err); }
});

// The single audit-trigger button: kicks off social discovery/verification
// and audit+mockup generation together. Both are slow (site fetches, LLM
// calls), so this responds immediately with a "running" report and does the
// work in the background; the frontend polls GET /:id/audit for completion.
router.post('/:id/audit', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM leads WHERE id = $1', [req.params.id]);
    const lead = rows[0];
    if (!lead) return res.status(404).json({ error: 'Not found' });
    if (!lead.website) return res.status(400).json({ error: 'Lead has no website set' });

    const { rows: reportRows } = await pool.query(
      `INSERT INTO audit_reports (lead_id, status, public_token) VALUES ($1, 'running', $2) RETURNING *`,
      [lead.id, randomUUID()]
    );
    const report = reportRows[0];
    res.status(202).json(report);

    processAudit(lead, report.id).catch(async (err) => {
      console.error('Audit processing failed for lead', lead.id, err);
      await pool.query(`UPDATE audit_reports SET status = 'failed' WHERE id = $1`, [report.id]).catch(() => {});
    });
  } catch (err) { next(err); }
});

router.get('/:id/audit', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM audit_reports WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'No audit yet' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// Crude "same market" grouping so nearby leads don't get an identical-looking
// mockup — good enough given addresses come from Places imports/pasted data
// in a fairly consistent "..., City, ST ZIP" shape, no need for a real
// geocoded market concept just to avoid style collisions.
function deriveMarketKey(address) {
  if (!address) return null;
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  // Last segment is typically "ST 12345" — strip the zip so leads a few
  // blocks apart (different zip, same city) still land in the same market.
  const state = parts[parts.length - 1].replace(/\d[\d-]*\s*$/, '').trim();
  const city = parts[parts.length - 2];
  const key = `${city}, ${state}`.toLowerCase().trim();
  return key === ',' ? null : key;
}

// Looks at recently-completed audits to see which base template and stock
// photos have already been used by other leads in the same market, so
// runAudit can steer away from repeating them.
async function findMarketUsage(marketKey) {
  if (!marketKey) return { templateIds: [], photoUrls: [] };
  const { rows } = await pool.query(
    `SELECT ar.style_template, ar.style_photo_urls, l.address
     FROM audit_reports ar JOIN leads l ON l.id = ar.lead_id
     WHERE ar.status = 'done' AND ar.style_template IS NOT NULL
     ORDER BY ar.created_at DESC LIMIT 200`
  );
  const templateIds = [];
  const photoUrls = [];
  for (const row of rows) {
    if (deriveMarketKey(row.address) !== marketKey) continue;
    if (row.style_template) templateIds.push(row.style_template);
    if (Array.isArray(row.style_photo_urls)) photoUrls.push(...row.style_photo_urls);
  }
  return { templateIds, photoUrls };
}

async function processAudit(lead, reportId) {
  const { email: discoveredEmail, ...socials } = await discoverAndVerifySocials(lead.website, lead.phone, lead.address);
  for (const [platform, result] of Object.entries(socials)) {
    if (!result) continue;
    // Never overwrite a link the operator entered/corrected by hand.
    await pool.query(
      `INSERT INTO lead_socials (lead_id, platform, url, verification_status, verified_via, verified_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (lead_id, platform) DO UPDATE SET
         url = EXCLUDED.url, verification_status = EXCLUDED.verification_status,
         verified_via = EXCLUDED.verified_via, verified_at = now()
       WHERE lead_socials.verification_status IS DISTINCT FROM 'manual'`,
      [lead.id, platform, result.url, result.status, result.verified_via]
    );
  }

  const marketKey = deriveMarketKey(lead.address);
  const { templateIds: avoidTemplateIds, photoUrls: avoidPhotoUrls } = await findMarketUsage(marketKey);

  const { weaknesses, recommendations_text, mockup_html, decision_maker, style_template, style_photo_urls } =
    await runAudit(lead.business_name, lead.website, lead.address, { leadId: lead.id, avoidTemplateIds, avoidPhotoUrls });

  // Fill in anything the audit discovered before marking the report 'done' —
  // the frontend refreshes the lead as soon as it sees that status, so these
  // writes must land first or a fast poll can catch the lead mid-update.
  // Only fill in fields the lead doesn't already have — never overwrite a
  // real (possibly manually-entered) value.
  if (decision_maker) {
    await pool.query(
      `UPDATE leads SET decision_maker = $1, updated_at = now()
       WHERE id = $2 AND (decision_maker IS NULL OR decision_maker = '')`,
      [decision_maker, lead.id]
    );
  }
  if (discoveredEmail) {
    await pool.query(
      `UPDATE leads SET email = $1, updated_at = now()
       WHERE id = $2 AND (email IS NULL OR email = '')`,
      [discoveredEmail, lead.id]
    );
  }

  await pool.query(
    `UPDATE audit_reports SET status = 'done', weaknesses = $1, recommendations_text = $2, mockup_html = $3,
       style_template = $4, style_photo_urls = $5, generated_at = now()
     WHERE id = $6`,
    [JSON.stringify(weaknesses), recommendations_text, mockup_html, style_template, JSON.stringify(style_photo_urls), reportId]
  );
  await pool.query(
    `UPDATE leads SET outreach_status = 'Mockup Generated', updated_at = now() WHERE id = $1 AND outreach_status = 'New'`,
    [lead.id]
  );
}

module.exports = router;
