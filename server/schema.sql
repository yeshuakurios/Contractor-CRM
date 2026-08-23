-- Single-operator login. Add rows via `npm run create-user`.
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY,
  business_name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  place_id TEXT UNIQUE,
  website TEXT,
  email TEXT,
  decision_maker TEXT,
  outreach_status TEXT NOT NULL DEFAULT 'New'
    CHECK (outreach_status IN ('New','Mockup Generated','Sent to Prospect','Followed Up','Responded','Declined')),
  pipeline_stage INTEGER CHECK (pipeline_stage BETWEEN 1 AND 7),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lead_socials (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('facebook','instagram','x')),
  url TEXT,
  verification_status TEXT NOT NULL DEFAULT 'not_found'
    CHECK (verification_status IN ('confirmed','unconfirmed','not_found')),
  verified_via TEXT, -- 'phone' | 'address' | null
  verified_at TIMESTAMPTZ,
  UNIQUE (lead_id, platform)
);

CREATE TABLE IF NOT EXISTS audit_reports (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  weaknesses JSONB,
  mockup_html TEXT,
  recommendations_text TEXT,
  public_token TEXT UNIQUE, -- unauthenticated share link for the mockup, e.g. /mockup/:public_token
  generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity_log (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  author TEXT,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pipeline_stage_items (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  stage_number INTEGER NOT NULL CHECK (stage_number BETWEEN 1 AND 7),
  item_key TEXT NOT NULL,
  checked BOOLEAN NOT NULL DEFAULT false,
  checked_at TIMESTAMPTZ,
  checked_by TEXT,
  UNIQUE (lead_id, stage_number, item_key)
);

CREATE TABLE IF NOT EXISTS billing (
  lead_id INTEGER PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  one_time_payment_status TEXT NOT NULL DEFAULT 'none'
    CHECK (one_time_payment_status IN ('none','pending','paid','failed')),
  subscription_status TEXT NOT NULL DEFAULT 'none'
    CHECK (subscription_status IN ('none','active','past_due','cancelled')),
  next_billing_date DATE
);

CREATE TABLE IF NOT EXISTS billing_events (
  id SERIAL PRIMARY KEY,
  stripe_event_id TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Client site logins, Twilio creds, etc. Encrypted at the application layer
-- (AES-256-GCM using ENCRYPTION_KEY) before insert — never stored plaintext.
CREATE TABLE IF NOT EXISTS credentials (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
