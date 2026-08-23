require('dotenv').config();
const path = require('path');
const express = require('express');
const { sessionMiddleware, requireAuth, loginRateLimit, login, logout } = require('./auth');
const leadsRouter = require('./leads');
const { router: stagesRouter } = require('./stages');
const { router: billingRouter } = require('./billing');
const { stripeWebhookHandler } = require('./stripeWebhook');

const app = express();
app.set('trust proxy', 1); // needed on Render for secure cookies + req.ip to work correctly

// Stripe webhook needs the raw request body for signature verification, and
// is called unauthenticated by Stripe (no session) — must be registered
// before express.json() and before the auth gate below.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res, next) =>
  stripeWebhookHandler(req, res).catch(next)
);

app.use(express.json());
app.use(sessionMiddleware());

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.post('/api/auth/login', loginRateLimit, (req, res, next) => login(req, res).catch(next));
app.post('/api/auth/logout', logout);
app.get('/api/auth/me', requireAuth, (req, res) => res.json({ userId: req.session.userId }));

// Everything else under /api/ requires a session (audits, billing, etc.
// get added here in later build steps).
app.use('/api', requireAuth);
app.use('/api/leads', leadsRouter);
app.use('/api/leads', stagesRouter);
app.use('/api/leads', billingRouter);

app.use(express.static(path.join(__dirname, '..', 'public')));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on :${PORT}`));
