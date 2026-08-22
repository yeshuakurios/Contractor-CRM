const express = require('express');
const { pool } = require('./db');

const router = express.Router();

// Static per the spec — stages/items aren't user-editable, only their
// checked state per lead is. Stage 1's "fee_agreed" item is a manual
// checkbox for now; once Stripe billing lands it becomes read-only and
// gets set automatically from the webhook instead.
const STAGES = [
  { number: 1, label: 'Website Agreement', items: [
    { key: 'fee_agreed', label: '$297 build fee agreed' },
    { key: 'domain_access', label: 'Domain/DNS access received' },
    { key: 'mockup_approved', label: 'Mockup approved by client' },
  ]},
  { number: 2, label: 'Presence Foundation', items: [
    { key: 'site_live', label: 'New site live on their domain' },
    { key: 'gbp_claimed', label: 'Google Business Profile claimed, verified, fully filled out' },
    { key: 'review_widget', label: 'Review pull-in widget active on site' },
    { key: 'social_cleanup', label: 'Social accounts claimed/cleaned up, consistent branding' },
  ]},
  { number: 3, label: 'Lead Capture Wired', items: [
    { key: 'form_routes_crm', label: 'Site contact form routes into this CRM' },
    { key: 'calls_logged', label: 'Phone/text inquiries logged into CRM' },
    { key: 'no_leads_outside', label: 'Confirmed no leads live outside the CRM' },
  ]},
  { number: 4, label: 'Lead Response Automated', items: [
    { key: 'missed_call_textback', label: 'Missed-call text-back active (Twilio)' },
    { key: 'auto_response_window', label: 'Auto-response fires within a defined time window' },
    { key: 'qualifying_question', label: 'Qualifying question included in the auto-text' },
  ]},
  { number: 5, label: 'Scheduling Automated', items: [
    { key: 'booking_link_live', label: 'Self-serve booking link live' },
    { key: 'booking_syncs_calendar', label: "Booking syncs to plumber's real calendar" },
    { key: 'reminder_texts', label: 'Confirmation/reminder texts firing automatically' },
  ]},
  { number: 6, label: 'Retention & Reputation Loop', items: [
    { key: 'review_request_automated', label: 'Post-job review request automated (timed trigger)' },
    { key: 'winback_sequence', label: 'Win-back sequence active for past customers' },
    { key: 'referral_prompt', label: 'Referral prompt included in the loop' },
    { key: 'social_posting', label: 'Light social content posting active (batched monthly)' },
  ]},
  { number: 7, label: 'Fully Optimized', items: [
    { key: 'all_prior_verified', label: 'All Stage 1-6 items verified live, not just built' },
    { key: 'reaudit_scheduled', label: 'Recurring re-audit cadence scheduled' },
    { key: 'client_satisfied_retainer', label: 'Client confirmed satisfied and on active retainer' },
    { key: 'social_qa', label: 'Ongoing social QA (light monthly check)' },
  ]},
];

function findStage(num) {
  return STAGES.find((s) => s.number === Number(num));
}

// Pure: builds the per-lead stage view from already-fetched item rows.
// Only the current stage's items are editable — earlier stages are locked
// history (their gate was already enforced on advance), later stages are
// locked future (no skipping ahead).
function computeStages(itemRows, pipelineStage) {
  const checkedMap = new Map(itemRows.map((r) => [`${r.stage_number}:${r.item_key}`, r.checked]));
  return STAGES.map((s) => {
    const items = s.items.map((i) => ({
      key: i.key,
      label: i.label,
      checked: checkedMap.get(`${s.number}:${i.key}`) || false,
    }));
    return {
      number: s.number,
      label: s.label,
      items,
      complete: items.every((i) => i.checked),
      current: pipelineStage != null && s.number === pipelineStage,
    };
  });
}

async function fetchStageItemRows(leadId) {
  const { rows } = await pool.query(
    'SELECT stage_number, item_key, checked FROM pipeline_stage_items WHERE lead_id = $1',
    [leadId]
  );
  return rows;
}

router.get('/:id/stages', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT id, pipeline_stage FROM leads WHERE id = $1', [req.params.id]);
    const lead = rows[0];
    if (!lead) return res.status(404).json({ error: 'Not found' });
    const itemRows = await fetchStageItemRows(lead.id);
    res.json({ pipeline_stage: lead.pipeline_stage, stages: computeStages(itemRows, lead.pipeline_stage) });
  } catch (err) { next(err); }
});

router.post('/:id/stages/start', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT id, pipeline_stage FROM leads WHERE id = $1', [req.params.id]);
    const lead = rows[0];
    if (!lead) return res.status(404).json({ error: 'Not found' });
    if (lead.pipeline_stage != null) return res.status(400).json({ error: 'Pipeline already started' });
    await pool.query('UPDATE leads SET pipeline_stage = 1, updated_at = now() WHERE id = $1', [lead.id]);
    res.json({ pipeline_stage: 1 });
  } catch (err) { next(err); }
});

router.patch('/:id/stages/:stageNumber/items/:itemKey', async (req, res, next) => {
  try {
    const stageNumber = Number(req.params.stageNumber);
    const stage = findStage(stageNumber);
    if (!stage) return res.status(400).json({ error: 'Invalid stage number' });
    const item = stage.items.find((i) => i.key === req.params.itemKey);
    if (!item) return res.status(400).json({ error: 'Invalid item key' });

    const { rows } = await pool.query('SELECT id, pipeline_stage FROM leads WHERE id = $1', [req.params.id]);
    const lead = rows[0];
    if (!lead) return res.status(404).json({ error: 'Not found' });
    if (lead.pipeline_stage == null || stageNumber !== lead.pipeline_stage) {
      return res.status(400).json({ error: 'Only the current stage\'s items can be checked' });
    }

    const checked = !!(req.body && req.body.checked);
    await pool.query(
      `INSERT INTO pipeline_stage_items (lead_id, stage_number, item_key, checked, checked_at, checked_by)
       VALUES ($1, $2, $3, $4, now(), $5)
       ON CONFLICT (lead_id, stage_number, item_key) DO UPDATE SET
         checked = EXCLUDED.checked, checked_at = now(), checked_by = EXCLUDED.checked_by`,
      [lead.id, stageNumber, item.key, checked, String(req.session.userId || '')]
    );
    res.json({ stage_number: stageNumber, item_key: item.key, checked });
  } catch (err) { next(err); }
});

router.post('/:id/stages/advance', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT id, pipeline_stage FROM leads WHERE id = $1', [req.params.id]);
    const lead = rows[0];
    if (!lead) return res.status(404).json({ error: 'Not found' });
    if (lead.pipeline_stage == null) return res.status(400).json({ error: 'Pipeline not started' });
    if (lead.pipeline_stage >= 7) return res.status(400).json({ error: 'Already at the final stage' });

    const itemRows = await fetchStageItemRows(lead.id);
    const currentStage = findStage(lead.pipeline_stage);
    const allChecked = currentStage.items.every((i) => {
      const row = itemRows.find((r) => r.stage_number === lead.pipeline_stage && r.item_key === i.key);
      return row && row.checked;
    });
    if (!allChecked) return res.status(400).json({ error: 'Complete all checklist items in the current stage first' });

    const nextStage = lead.pipeline_stage + 1;
    await pool.query('UPDATE leads SET pipeline_stage = $1, updated_at = now() WHERE id = $2', [nextStage, lead.id]);
    res.json({ pipeline_stage: nextStage });
  } catch (err) { next(err); }
});

module.exports = { router, STAGES, computeStages, fetchStageItemRows };
