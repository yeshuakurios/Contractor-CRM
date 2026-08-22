# Contractor-CRM

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL` (from your Neon
   project's connection string) and `SESSION_SECRET` (any long random string,
   e.g. `openssl rand -hex 32`).
3. `npm run migrate` — creates all tables.
4. `npm run create-user -- you@example.com yourpassword` — creates your login.
5. `npm start` — runs the server locally on `:3000`. Visit `/login.html`.

## Deploying (Render)

Create a Render web service pointed at this repo: build command `npm install`,
start command `npm start`. Set `DATABASE_URL`, `SESSION_SECRET`, and
`NODE_ENV=production` in Render's environment settings — never commit `.env`.

## Status

Backend foundation: Express server, Postgres schema (leads, socials, audit
reports, activity log, pipeline stage checklists, billing, billing events,
credentials), and session-based login are in place. Lead import (Google
Places), the audit/mockup pipeline, pipeline-stage gating, and Stripe billing
are not built yet — see project plan for build order.
