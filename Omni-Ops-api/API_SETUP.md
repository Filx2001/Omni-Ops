# API Setup Guide

The API is the core of Omni-Ops: database access, all business logic, webhooks
(WhatsApp, Chatwoot), Google provisioning, and the internal endpoints both bots
talk to. **Deploy this service first** — the Discord and Slack bots cannot
register or function without it.

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Database](#2-database)
3. [Generate Secrets](#3-generate-secrets)
4. [Environment Variables](#4-environment-variables)
5. [Webhooks](#5-webhooks)
6. [Google Integration](#6-google-integration)
7. [Deploy](#7-deploy)
8. [Verify](#8-verify)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Prerequisites

- Node.js 20+
- PostgreSQL 15+
- Railway account (recommended) or any Docker/hosting platform

---

## 2. Database

**Railway:** add a PostgreSQL service to your project and copy its
`DATABASE_URL` (private connection string).

**Local:**

```bash
createdb omni_ops
```

```env
DATABASE_URL="postgresql://user:password@localhost:5432/omni_ops?schema=public"
```

Run migrations before first start:

```bash
npx prisma migrate deploy   # production / CI
# or, for a brand-new dev database:
npx prisma db push
```

---

## 3. Generate Secrets

Three secrets must be generated. `SECRET_ENCRYPTION_KEY` **must be exactly 64
hex characters** (32 bytes) — anything else crashes encryption at runtime with
`RangeError: Invalid key length`.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Run it three times: once for `INTERNAL_API_KEY`, once for
`SECRET_ENCRYPTION_KEY`, once for `PDF_LINK_SECRET`.

> ⚠️ Never change `SECRET_ENCRYPTION_KEY` after go-live. AI keys, Slack OAuth
> tokens and Google refresh tokens are encrypted with it; rotating it orphans
> every stored secret and forces re-connects.

---

## 4. Environment Variables

### Core (required)

```env
NODE_ENV=production
PORT=3000
DATABASE_URL="postgresql://..."
INTERNAL_API_KEY="<64-hex>"            # shared with both bots
SECRET_ENCRYPTION_KEY="<64-hex>"       # tenant secret encryption
API_PUBLIC_URL="https://your-api.up.railway.app"
```

### Bot notification bridges (required for WhatsApp lead alerts)

```env
# Internal URLs of the bots' notify servers (Railway private network)
BOT_NOTIFY_URL="http://omni-ops-bot.railway.internal:3001"
SLACK_BOT_NOTIFY_URL="http://omni-ops-slack.railway.internal:3001"
```

### WhatsApp Cloud API (optional — CRM & campaigns)

```env
WHATSAPP_ACCESS_TOKEN=""
WHATSAPP_PHONE_NUMBER_ID=""
WHATSAPP_WABA_ID=""
WHATSAPP_APP_SECRET=""          # used to verify webhook signatures
WHATSAPP_VERIFY_TOKEN="<random-string>"   # you choose; reused in Meta dashboard
WHATSAPP_API_VERSION="v22.0"
WHATSAPP_MEDIA_MAX_MB=5
WHATSAPP_WELCOME_TEXT="Welcome! 👋\nThank you for contacting us."
WHATSAPP_EVENT_RETENTION_DAYS=60
```

### Local phone number defaults (optional)

```env
# Lets users type "55512345" without a country code
# DEFAULT_COUNTRY_CODE=974
# LOCAL_NUMBER_LENGTH=8
```

### Email & PDF (optional — invoicing)

```env
RESEND_API_KEY=""
EMAIL_FROM="invoices@yourdomain.com"
PDF_LINK_SECRET="<64-hex>"      # shared with both bots
```

### Google (optional — calendar & sheets)

```env
# Mode A: per-workspace OAuth (recommended, multi-tenant)
GOOGLE_OAUTH_CLIENT_ID=""
GOOGLE_OAUTH_CLIENT_SECRET=""

# Mode B: host-level service account fallback (single-workspace deployments)
# GOOGLE_CREDENTIALS_JSON="<escaped service account JSON>"
# GOOGLE_CALENDAR_ID=""
# PERSONAL_TASKS_CALENDAR_ID=""
# GOOGLE_CALENDAR_TZ="UTC"
# GOOGLE_TZ_OFFSET_HOURS=0
# GOOGLE_SHEETS_ID=""
# ACCOUNTING_SHEET_ID=""
# PERSONAL_TASKS_SHEET_ID=""
```

### Chatwoot inbox bridge (optional)

```env
CHATWOOT_BASE_URL="https://app.chatwoot.com"
CHATWOOT_INBOX_IDENTIFIER=""
CHATWOOT_WEBHOOK_SECRET="<random-string>"
```

### Campaign tuning (optional)

```env
# Max recipients per campaign batch (default 400)
# CAMPAIGN_MAX_BATCH=400
```

---

## 5. Webhooks

### WhatsApp (Meta)

1. Meta Developer Portal → your WhatsApp app → **Webhooks**.
2. Callback URL: `https://<API_PUBLIC_URL>/crm/whatsapp/webhook`
3. Verify token: same value as `WHATSAPP_VERIFY_TOKEN`.
4. Subscribe to the `messages` field.

Incoming messages create/update leads, push first-message alerts to the bots'
leads channels, and bridge media into Chatwoot when configured.

### Chatwoot (agent replies → WhatsApp)

1. Chatwoot → Settings → Webhooks → new webhook.
2. URL: `https://<API_PUBLIC_URL>/crm/inbox/callback`
3. Set `CHATWOOT_WEBHOOK_SECRET` to the same secret on both sides.
   Callbacks are HMAC-verified with a 5-minute replay window.

---

## 6. Google Integration

Two modes; per-workspace OAuth wins when a workspace has connected:

- **Mode A (per-workspace OAuth):** create an OAuth 2.0 client (Web
  application) with redirect URI `https://<API_PUBLIC_URL>/google/callback`,
  set the client ID/secret, then connect from `/config setup` (Discord) or
  `/omni-config` (Slack). First connect provisions one Calendar and four
  Sheets for that workspace.
- **Mode B (host service account):** set `GOOGLE_CREDENTIALS_JSON` plus the
  calendar/sheet IDs. All workspaces share the host's Google resources.

See the **Google integration** section in `README.md` for OAuth consent-screen
modes (Testing vs Production vs Internal) and what each allows.

---

## 7. Deploy

### Railway (recommended)

1. New service → deploy from your GitHub repo.
2. **Root Directory:** `Omni-Ops-api`
3. **Start command:** `npx prisma db push && node src/app.js`
4. Add all env vars from section 4.
5. **Settings → Networking:** note the private domain (e.g.
   `omni-ops-api.railway.internal`) — the bots use it as `API_URL`.
6. **Settings → Networking:** generate a public domain for `API_PUBLIC_URL`
   (needed for Google OAuth redirects, PDF links and webhooks).

### Docker / local

```bash
cd Omni-Ops-api
npm install
npx prisma migrate deploy
npm start
```

---

## 8. Verify

- `curl https://<API_PUBLIC_URL>/health` → `200 OK`
- Logs show: `Server running on port 3000` and `[Maintenance] Scheduler started`
- From a bot service: `curl -H "x-api-key: $INTERNAL_API_KEY" http://<api-internal>:3000/workspaces` → JSON array

Then continue with `DISCORD_SETUP.md` or `SLACK_SETUP.md`.

---

## 9. Troubleshooting

### `RangeError: Invalid key length` at startup or on save

`SECRET_ENCRYPTION_KEY` is not 64 hex characters. Regenerate with the command
in section 3 and redeploy. (If secrets were already stored with a broken key,
they were never readable — re-connect Google/Slack/AI after fixing.)

### Bots log `ECONNREFUSED` or `Could not reach the API`

`API_URL` on the bot points somewhere unreachable. On Railway use the API's
**private** domain (`*.railway.internal:3000`); locally use
`http://localhost:3000` or `http://host.docker.internal:3000`.

### Bot requests return 401

`INTERNAL_API_KEY` differs between API and bot. It must be identical on all
three services.

### WhatsApp webhook verification fails (403)

`WHATSAPP_VERIFY_TOKEN` in the Meta dashboard doesn't match the env var, or
the callback URL is wrong. Both must match exactly.

### Google OAuth `redirect_uri_mismatch`

The redirect URI in Google Cloud Console must be exactly
`https://<API_PUBLIC_URL>/google/callback` — same host, no trailing slash.

### PDF links return 401 "Invalid link"

`PDF_LINK_SECRET` differs between API and the bot that generated the link.

```

---

**Final docs set for the repo root:**
1. `README.md` — overview + quick start + Google consent modes
2. `API_SETUP.md` — the file above
3. `DISCORD_SETUP.md`
4. `SLACK_SETUP.md`
5. `slack-app-manifest.json`
6. `.env.example` in each service folder (`Omni-Ops-api`, `Omni-Ops-bot`, `Omni-Ops-slack`)

Commit those and the documentation phase is genuinely complete — a self-hoster can go from empty repo to running system following only the repo's own files.
```
