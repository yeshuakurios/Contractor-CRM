const express = require('express');
const { pool } = require('./db');
const { getStripe } = require('./stripe');

const router = express.Router();

const PRICES = {
  onetime: { amount: 29700, name: 'Website Build Fee' },
  subscription: { amount: 9900, name: 'Monthly Automation Subscription' },
};

async function getOrCreateBillingRow(leadId) {
  const { rows } = await pool.query('SELECT * FROM billing WHERE lead_id = $1', [leadId]);
  if (rows[0]) return rows[0];
  const inserted = await pool.query('INSERT INTO billing (lead_id) VALUES ($1) RETURNING *', [leadId]);
  return inserted.rows[0];
}

router.get('/:id/billing', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT id FROM leads WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(await getOrCreateBillingRow(rows[0].id));
  } catch (err) { next(err); }
});

// Generates a Stripe Checkout (hosted page) link for the operator to send to
// the client — card details never touch this server.
router.post('/:id/billing/checkout', async (req, res, next) => {
  try {
    const type = req.body && req.body.type;
    if (!PRICES[type]) return res.status(400).json({ error: "type must be 'onetime' or 'subscription'" });

    const { rows } = await pool.query('SELECT * FROM leads WHERE id = $1', [req.params.id]);
    const lead = rows[0];
    if (!lead) return res.status(404).json({ error: 'Not found' });

    const stripe = getStripe();
    const billing = await getOrCreateBillingRow(lead.id);

    let stripeCustomerId = billing.stripe_customer_id;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        name: lead.business_name,
        email: lead.email || undefined,
        metadata: { lead_id: String(lead.id) },
      });
      stripeCustomerId = customer.id;
      await pool.query('UPDATE billing SET stripe_customer_id = $1 WHERE lead_id = $2', [stripeCustomerId, lead.id]);
    }

    const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const price = PRICES[type];
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: type === 'onetime' ? 'payment' : 'subscription',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: price.name },
          unit_amount: price.amount,
          ...(type === 'subscription' ? { recurring: { interval: 'month' } } : {}),
        },
        quantity: 1,
      }],
      success_url: `${baseUrl}/index.html?billing=success`,
      cancel_url: `${baseUrl}/index.html?billing=cancelled`,
      client_reference_id: String(lead.id),
      metadata: { lead_id: String(lead.id) },
    });

    res.json({ url: session.url });
  } catch (err) { next(err); }
});

module.exports = { router, getOrCreateBillingRow };
