const { pool } = require('./db');
const { getStripe } = require('./stripe');

async function updateByCustomer(stripeCustomerId, fields) {
  const keys = Object.keys(fields);
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = keys.map((k) => fields[k]);
  values.push(stripeCustomerId);
  await pool.query(`UPDATE billing SET ${setClause} WHERE stripe_customer_id = $${values.length}`, values);
}

async function handleEvent(event) {
  const obj = event.data.object;
  switch (event.type) {
    case 'checkout.session.completed': {
      const leadId = obj.metadata && obj.metadata.lead_id;
      if (!leadId) return;
      if (obj.mode === 'payment') {
        await pool.query(
          `UPDATE billing SET one_time_payment_status = 'paid', stripe_customer_id = COALESCE(stripe_customer_id, $1) WHERE lead_id = $2`,
          [obj.customer, leadId]
        );
      } else if (obj.mode === 'subscription') {
        await pool.query(
          `UPDATE billing SET subscription_status = 'active', stripe_subscription_id = $1, stripe_customer_id = COALESCE(stripe_customer_id, $2) WHERE lead_id = $3`,
          [obj.subscription, obj.customer, leadId]
        );
      }
      break;
    }
    case 'invoice.payment_failed':
      await updateByCustomer(obj.customer, { subscription_status: 'past_due' });
      break;
    case 'invoice.payment_succeeded':
      if (obj.subscription) await updateByCustomer(obj.customer, { subscription_status: 'active' });
      break;
    case 'customer.subscription.deleted':
      await updateByCustomer(obj.customer, { subscription_status: 'cancelled' });
      break;
    default:
      break;
  }
}

// Registered with express.raw() so req.body is the untouched raw buffer —
// Stripe's signature check requires the exact bytes it signed, which a JSON
// body-parser would have already re-serialized and broken.
async function stripeWebhookHandler(req, res) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET not configured');
    return res.status(500).send('Webhook not configured');
  }

  const stripe = getStripe();
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const existing = await pool.query('SELECT id FROM billing_events WHERE stripe_event_id = $1', [event.id]);
  if (existing.rows.length) return res.json({ received: true }); // already processed — idempotent

  await pool.query(
    'INSERT INTO billing_events (stripe_event_id, type, payload) VALUES ($1, $2, $3)',
    [event.id, event.type, JSON.stringify(event)]
  );

  try {
    await handleEvent(event);
  } catch (err) {
    console.error('Error handling Stripe event', event.id, err);
  }

  res.json({ received: true });
}

module.exports = { stripeWebhookHandler };
