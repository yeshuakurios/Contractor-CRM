const Stripe = require('stripe');

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    const err = new Error('STRIPE_SECRET_KEY is not configured');
    err.status = 500;
    throw err;
  }
  return new Stripe(key);
}

module.exports = { getStripe };
