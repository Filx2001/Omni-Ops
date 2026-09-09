# Discord Setup Guide

Complete guide for deploying Omni-Ops on Discord. This guide assumes your **API service is already deployed and running** — the bot cannot register or function without it.

## Table of Contents

1. [Discord Developer Portal Setup](#1-discord-developer-portal-setup)
2. [Environment Variables](#2-environment-variables)
3. [Deploy Discord Bot](#3-deploy-discord-bot)
4. [First Run](#4-first-run)
5. [Google Integration](#5-google-integration)
6. [Troubleshooting](#6-troubleshooting)
7. [Command Reference](#7-command-reference)

---

## 1. Discord Developer Portal Setup

### 1.1 Create the Application

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) and log in.
2. Click **New Application** → name it `Omni-Ops` → **Create**.
3. On the **General Information** page, copy the **Application ID** — this becomes `DISCORD_CLIENT_ID`.

### 1.2 Create the Bot

1. Go to **Bot** (left sidebar) → **Reset Token** → **Copy**. Save it as `DISCORD_BOT_TOKEN`.
2. Scroll down to **Privileged Gateway Intents** and enable all three:
   - ✅ **Presence Intent**
   - ✅ **Server Members Intent**
   - ✅ **Message Content Intent**

   These are required for employee autocomplete, the `/setup` email lookup, and natural-language parsing.

### 1.3 Generate the Invite Link

1. Go to **OAuth2** → **URL Generator**.
2. Under **Scopes**, check:
   - ✅ `bot`
   - ✅ `applications.commands`
3. Under **Bot Permissions**, check (or just pick **Administrator** for a quick start):
   - Send Messages, Embed Links, Attach Files, Add Reactions
   - Read Message History, Use External Emojis
   - Manage Roles (for auto-role on `/setup`)
   - Manage Channels (for creating `#leads`, `#tasks` etc.)
4. Copy the generated URL at the bottom, open it in your browser, and install to your server.

### 1.4 Get the Server ID

1. In Discord: **User Settings** → **Advanced** → enable **Developer Mode**.
2. Right-click your server icon → **Copy Server ID**. This becomes `DISCORD_GUILD_ID`.

---

## 2. Environment Variables

Set these on your **Discord Bot service** (Railway, Docker, etc.):

### Required Variables

```env
# Discord credentials (from Developer Portal)
DISCORD_BOT_TOKEN="your-bot-token"
DISCORD_CLIENT_ID="your-application-id"
DISCORD_GUILD_ID="your-server-id"

# API Connection
API_URL="http://your-api.railway.internal:3000"
API_PUBLIC_URL="https://your-api.up.railway.app"
INTERNAL_API_KEY="must-match-api-service"

# Signed PDF links (must match API's PDF_LINK_SECRET)
PDF_LINK_SECRET="must-match-api-service"
```

### AI Fallback (Optional)

Used only when a workspace-specific AI key has **not** been set via `/config setup`:

```env
AI_PROVIDER="anthropic"       # anthropic | openai | gemini | deepseek | qwen | custom
AI_API_KEY="sk-..."
AI_MODEL=""                   # leave blank to use the provider's default
AI_BASE_URL=""                # only for custom OpenAI-compatible endpoints
```

### Internal Notify Server (Optional)

Port the bot listens on for WhatsApp lead pushes from the API. Default is `3001`.

```env
BOT_NOTIFY_PORT=3001
```

**Important:** The API must have `BOT_NOTIFY_URL` set to this bot's internal URL (e.g. `http://omni-ops-bot.railway.internal:3001`) for WhatsApp lead notifications to work.

---

## 3. Deploy Discord Bot

### Railway (Recommended)

1. Create new service → Deploy from GitHub repo.
2. **Root Directory**: `Omni-Ops-bot`.
3. **Environment Variables**: paste all variables from step 2.
4. Deploy.

### Docker

```bash
cd Omni-Ops-bot
docker build -t omni-ops-bot .
docker run -d --env-file .env -p 3001:3001 omni-ops-bot
```

### Direct Node

```bash
cd Omni-Ops-bot
npm install
npm start
```

**Verify deployment:**

- Logs should show: `Ready! Logged in as Omni-Ops#1234`
- In Discord, type `/` — all Omni-Ops commands should appear in the autocomplete.

Slash commands are registered automatically on first boot via `client.application.commands.set(...)`. If they don't appear immediately, wait up to 60 seconds or restart the bot once.

---

## 4. First Run

### Step 1: Verify API Connection

```text
/ping
```

Expected response: `🏓 Pong! Connected to *Your Server Name* _(platform: DISCORD)_`

### Step 2: Register the Owner as Admin

```text
/setup
```

You'll be prompted for an email. The bot:

1. Creates an employee record for the email.
2. Links your Discord account to that record.
3. Assigns you the `Admin` role (created on demand if missing).

Workspace owners (anyone with the server `Manage Server` permission) can run this and become Admin.

### Step 3: Configure the Workspace

```text
/config setup
```

This opens a panel where you can set:

- **Organization name**
- **Timezone** (e.g. `Asia/Qatar`)
- **Currency** (e.g. `QAR`)
- **Daily report** on/off
- **Channels** (assign `#leads`, `#tasks`, `#invoices` etc.)
- **🤖 AI** provider + key (per-workspace, encrypted at rest)
- **🔗 Connect Google** (OAuth flow)

### Step 4: Test Core Features

```text
/task create              → embed form, assign a task
/my tasks                 → your open tasks
/lead list                → CRM overview
/dashboard                → management statistics
/ai "list my open tasks"  → AI assistant (if configured)
```

---

## 5. Google Integration

Omni-Ops uses per-workspace Google OAuth. Each server connects its own Google account; refresh tokens are encrypted at rest and never shared.

### 5.1 Google Cloud Console Setup

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a new project (or use an existing one).
2. **APIs & Services → Library** → enable:
   - Google Calendar API
   - Google Sheets API
   - Gmail API (only if you plan to read/write via Gmail)
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized redirect URIs: `https://<your-api-url>/google/callback`
4. Copy **Client ID** and **Client Secret**.

### 5.2 Set on the API

```env
GOOGLE_OAUTH_CLIENT_ID="..."
GOOGLE_OAUTH_CLIENT_SECRET="..."
API_PUBLIC_URL="https://your-api.up.railway.app"   # must match the redirect URI above
```

Redeploy the API if these are new.

### 5.3 Connect a Workspace

```text
/config setup
```

Click **🔗 Connect Google** → a browser window opens → authorize → you are redirected back with a confirmation.

**First connect auto-provisions for that workspace:**

- One Google Calendar: `<org> — Omni-Ops`
- Four Google Sheets:
  - `<org> — Leads`
  - `<org> — Schedule` (tabs: Appointments, Events)
  - `<org> — Accounting`
  - `<org> — Personal Tasks`

### 5.4 OAuth Consent Screen Modes

| Mode                       | Who can connect                   | Notes                                                                |
| -------------------------- | --------------------------------- | -------------------------------------------------------------------- |
| **Testing**                | Listed test users (max 100)       | Refresh tokens expire every 7 days — never run production on Testing |
| **Production, unverified** | Anyone, via "Advanced → Continue" | Fine for self-hosted and small teams                                 |
| **Production, verified**   | Anyone, clean consent             | Requires your own domain, landing page, privacy policy + terms       |
| **Internal** (Workspace)   | Users in your domain only         | No verification, no expiry; single-org deployments only              |

Verification is per OAuth client: every self-hosted deployment owns its client and its verification status.

---

## 6. Troubleshooting

### Commands don't appear in `/` autocomplete

**Cause**: Slash commands not registered or still propagating.
**Fix**:

1. Wait 60 seconds after first boot — Discord's command registry can take up to a minute.
2. Restart the bot once.
3. Verify `DISCORD_CLIENT_ID` and `DISCORD_BOT_TOKEN` match the same application.
4. Confirm the bot was invited with the `applications.commands` scope — if not, re-invite using the URL from step 1.3.

### `/ping` returns an error or times out

**Cause**: Bot cannot reach the API.
**Fix**:

1. Check `API_URL` is the **internal network URL** (e.g. `http://omni-ops-api.railway.internal:3000`), not the public one.
2. Verify `INTERNAL_API_KEY` matches between API and Discord services.
3. `curl <API_URL>/health` from the bot's environment should return `200 OK`.

### `/setup` says "email not found" or fails silently

**Cause**: Bot missing the **Server Members Intent**.
**Fix**: Discord Developer Portal → Bot → enable **Server Members Intent** → restart.

### WhatsApp leads not pushing to `#leads`

**Cause**: API isn't reaching the bot's notify server.
**Fix**:

1. On the **API service**, set: `BOT_NOTIFY_URL="http://omni-ops-bot.railway.internal:3001"` (or whatever your bot's internal URL is).
2. In Discord: `/config setup` → assign a channel as **Leads** while in that channel.
3. Send a test message to your WhatsApp business number — the lead card should appear in `#leads`.

### AI assistant says "not configured"

**Cause**: No AI key set for the workspace.
**Fix**: `/config setup` → **🤖 AI** → pick a provider → enter the API key → Save.

Or, for a deployment-wide fallback, set `AI_API_KEY` on the Discord bot (not recommended for multi-server deployments).

### "PDF link is invalid" or 401 on "Save as PDF"

**Cause**: `PDF_LINK_SECRET` doesn't match between API and Discord.
**Fix**: Set the same 64-char random string on both services, redeploy both.

### Bot crashes with `ENOTFOUND` on startup

**Cause**: `API_URL` is unreachable from the bot's network.
**Fix**:

- Railway: use the `*.railway.internal` URL from the API's **Settings → Networking**.
- Docker / localhost: use `http://host.docker.internal:3000` or `http://localhost:3000`.

---

## 7. Command Reference

### Setup & Configuration

| Command                          | Description                                                       |
| -------------------------------- | ----------------------------------------------------------------- |
| `/ping`                          | Test API connectivity                                             |
| `/setup`                         | Register the caller as Admin (workspace owner only)               |
| `/config setup`                  | Workspace control panel (org, tz, currency, AI, Google, channels) |
| `/config daily-report [on\|off]` | Toggle the daily digest                                           |
| `/config links`                  | View configured channel assignments                               |

### Employees

| Command                              | Description                                         |
| ------------------------------------ | --------------------------------------------------- |
| `/employee link <email>`             | Link a Discord account to an employee record        |
| `/employee register`                 | Self-register (creates record from Discord profile) |
| `/employee info`                     | View your employee record                           |
| `/employee set-admin <@user\|email>` | Promote to Admin (Admin only)                       |
| `/employee create`                   | Create employee record (Manager+)                   |
| `/employee edit`                     | Edit name, email, phone, role (Manager+)            |
| `/employee list`                     | Full team roster (Manager+)                         |

### Tasks

| Command                      | Description                                          |
| ---------------------------- | ---------------------------------------------------- |
| `/task create`               | Create a new task                                    |
| `/task list`                 | View all tasks (filters: status, priority, assignee) |
| `/task edit <id>`            | Edit task title, priority, assignee, deadline        |
| `/task status <id> <status>` | Mark pending / in_progress / done / cancelled        |
| `/task delete <id>`          | Delete a task permanently (Manager+)                 |

### Appointments

| Command                    | Description                                |
| -------------------------- | ------------------------------------------ |
| `/appointment add`         | Schedule an appointment (single or series) |
| `/appointment list`        | View upcoming appointments                 |
| `/appointment edit <id>`   | Edit appointment details                   |
| `/appointment delete <id>` | Delete (single day or whole series)        |

### Calendar & Events

| Command                 | Description                                    |
| ----------------------- | ---------------------------------------------- |
| `/calendar create`      | Create an organization event                   |
| `/calendar list`        | View upcoming events                           |
| `/calendar edit <id>`   | Edit event (single day or whole series)        |
| `/calendar delete <id>` | Delete event                                   |
| `/calendar sync`        | Grant Google Calendar view access to employees |

### Invoices

| Command                | Description                                              |
| ---------------------- | -------------------------------------------------------- |
| `/invoice create`      | Create a client invoice (Admin, Manager, Sales, Finance) |
| `/invoice list`        | View invoices (filter by number, month, date range)      |
| `/invoice status <id>` | Update payment status                                    |
| `/invoice delete <id>` | Delete invoice permanently                               |

### Dashboard & Personal Workspace

| Command                                    | Description                           |
| ------------------------------------------ | ------------------------------------- |
| `/dashboard`                               | Management statistics overview        |
| `/my profile`                              | Your card and quick stats             |
| `/my tasks`                                | Your assigned tasks                   |
| `/my appointments`                         | Your upcoming schedule                |
| `/my calendar`                             | Organization events you're invited to |
| `/my performance`                          | Score and rating                      |
| `/my reminders <hours\|days\|off> [value]` | Global reminder settings              |

### CRM (Leads)

| Command                         | Description                        |
| ------------------------------- | ---------------------------------- |
| `/lead list`                    | View CRM leads                     |
| `/lead add`                     | Add a lead manually                |
| `/lead multi-add`               | Bulk import leads from a list      |
| `/lead info <query>`            | Detailed lead profile              |
| `/lead assign <query> <@user>`  | Assign lead to an employee         |
| `/lead status <query> <status>` | Update pipeline stage              |
| `/lead note <query> <text>`     | Add a private note                 |
| `/lead edit <query>`            | Edit name / phone (Manager+)       |
| `/lead delete <query>`          | Delete lead permanently (Manager+) |
| `/lead filter`                  | Filter leads by date range         |
| `/lead stats`                   | CRM performance analytics          |

### Campaigns (WhatsApp)

| Command                     | Description                               |
| --------------------------- | ----------------------------------------- |
| `/campaign audience`        | Contact base statistics                   |
| `/campaign new`             | Create a campaign with preview (Manager+) |
| `/campaign list`            | Campaign history                          |
| `/campaign send <id>`       | Start a drafted/paused campaign           |
| `/campaign stop <id>`       | Pause a running campaign                  |
| `/campaign status <id>`     | Live sending progress                     |
| `/campaign info <id>`       | Full campaign details                     |
| `/campaign recipients <id>` | Recipient list                            |

### AI Assistant

| Command          | Description                                |
| ---------------- | ------------------------------------------ |
| `/ai <question>` | Ask the AI to manage the system (Manager+) |

---

## Support

Open an issue on GitHub for bugs, questions, or feature requests.
