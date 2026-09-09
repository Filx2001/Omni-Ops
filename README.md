# Omni-Ops

**Multi-tenant operations platform for Discord and Slack**

Omni-Ops is a complete business operations system that runs as a bot in Discord or Slack. Each workspace (Discord server or Slack team) gets isolated data, Google Calendar/Sheets integration, WhatsApp campaigns, and an AI assistant — all from a single deployment.

## 🎯 What it does

- **Tasks & Scheduling**: Create, assign, track tasks and appointments with Google Calendar sync.
- **CRM & Campaigns**: Manage leads, send WhatsApp bulk campaigns with audience filtering.
- **Invoicing**: Create invoices, send via email, track payments.
- **Calendar & Events**: Organization events with employee assignment and Google Calendar integration.
- **AI Assistant**: Natural language interface for all operations (Claude, GPT, Gemini, DeepSeek).
- **Google Integration**: Per-workspace OAuth for Calendar + 4 Sheets (Leads, Schedule, Accounting, Personal).
- **WhatsApp Bridge**: Incoming messages create leads, push to Slack/Discord channels.

## 🏗️ Architecture

Omni-Ops is built as three independent services sharing one PostgreSQL database. You can run Discord only, Slack only, or both. Each platform is feature-complete and independent.

- **API (`Omni-Ops-api`)**: Core logic, Prisma ORM, webhooks, integrations (Node.js/Express).
- **Discord Bot (`Omni-Ops-bot`)**: Discord interface (discord.js).
- **Slack Bot (`Omni-Ops-slack`)**: Slack interface (@slack/bolt via Socket Mode).

## ✨ Features

### Core Operations

| Command             | Description                                                    |
| ------------------- | -------------------------------------------------------------- |
| `/omni-config`      | Workspace settings (timezone, currency, AI, Google, channels)  |
| `/omni-employee`    | Link users, create/edit/list employees, assign roles           |
| `/omni-task`        | Create, list, edit, delete tasks with assignments              |
| `/omni-appointment` | Schedule appointments (single or series) with Google sync      |
| `/omni-calendar`    | Organization events with employee assignment                   |
| `/omni-invoice`     | Create invoices, send via email, track payments                |
| `/omni-dashboard`   | Management statistics overview                                 |
| `/omni-my`          | Personal workspace (profile, tasks, appointments, performance) |

### CRM & Marketing

| Command          | Description                                     |
| ---------------- | ----------------------------------------------- |
| `/omni-leads`    | Add, assign, status, notes, edit, delete leads  |
| `/omni-campaign` | WhatsApp bulk campaigns with audience filtering |

### AI Assistant

- **@mention** the bot in any channel or **DM** it.
- Retrieval tools execute immediately (list tasks, get stats).
- Mutating tools require ✅/❌ confirmation (create task, update status).
- Supports Anthropic Claude, OpenAI GPT, Google Gemini, DeepSeek, Qwen.

### Integrations

- **Google Workspace**: Per-workspace OAuth → auto-provisions Calendar + 4 Sheets.
- **WhatsApp Cloud API**: Incoming messages → leads + channel notifications.
- **Resend**: Email invoices to customers.
- **Chatwoot**: Inbox bridge for agent replies.

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 15+
- Railway account (recommended) or any Docker/hosting platform
- Discord or Slack workspace

### 1. Deploy the API (The Core)

The API holds the database and logic. It must be reachable by both bots.

```bash
git clone https://github.com/yourusername/omni-ops.git
cd omni-ops/Omni-Ops-api
npm install
```

Set environment variables (see full list below):

```env
DATABASE_URL="postgresql://..."
INTERNAL_API_KEY="generate-64-hex-chars"
SECRET_ENCRYPTION_KEY="generate-another-64-hex-chars"
API_PUBLIC_URL="https://your-api.up.railway.app"
```

Run migrations and start:

```bash
npx prisma migrate deploy
npm start
```

### 2. Deploy Discord Bot (Optional)

```bash
cd ../Omni-Ops-bot
npm install
# Set DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID, API_URL, INTERNAL_API_KEY
npm start
```

The bot auto-registers slash commands to your guild on startup.

### 3. Deploy Slack Bot (Optional)

```bash
cd ../Omni-Ops-slack
npm install
# Set SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_SIGNING_SECRET, API_URL, INTERNAL_API_KEY
npm start
```

Create your Slack app using the `slack-app-manifest.json` file provided in the repo.

### 4. Connect Google (Optional)

1. **Google Cloud Console**: Create OAuth 2.0 Client (Web application) with redirect URI `https://<your-api-url>/google/callback`.
2. **API env vars**: Set `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`.
3. **Connect workspace**: Run `/omni-config` (Slack) or `/config setup` (Discord) and click **Connect Google**.

### 5. First Run

1. **Register as Admin**: `/omni-employee register` (Slack) or `/setup` (Discord). Workspace owners automatically become Admins.
2. **Test connectivity**: `/omni-ping`.
3. **Create your first task**: `/omni-task create`.

## 🔐 Security

- **Multi-tenant isolation**: All data is workspace-scoped via Prisma queries.
- **Encrypted secrets**: `aiApiKey`, `slackBotToken`, `googleRefreshToken` encrypted at rest with AES-256-CBC.
- **Signed PDF links**: Invoice PDFs use HMAC-SHA256 signatures with 1-hour expiry.
- **OAuth state verification**: Google OAuth uses HMAC-signed state to prevent CSRF.
- **Internal API key**: Bot-to-API communication authenticated via shared secret.

## 🛠️ Tech Stack

**API:** Node.js, Express, Prisma ORM, PostgreSQL, Google APIs, WhatsApp Cloud API, Resend  
**Discord Bot:** discord.js v14, Express (internal notify server)  
**Slack Bot:** @slack/bolt (Socket Mode), Express (internal notify server)

## 📄 License

MIT

````

---

### 2. `SLACK_SETUP.md`

```markdown
# Slack Setup Guide

Complete guide for deploying Omni-Ops on Slack. This guide assumes your API service is already deployed and running.

## Table of Contents
1. [Create Slack App](#1-create-slack-app)
2. [Environment Variables](#2-environment-variables)
3. [Deploy Slack Bot](#3-deploy-slack-bot)
4. [First Run](#4-first-run)
5. [Troubleshooting](#5-troubleshooting)

---

## 1. Create Slack App

### Option A: From Manifest (Recommended)
This is the fastest way. It automatically creates the app with all 11 slash commands, scopes, and settings.

1. Go to [api.slack.com/apps](https://api.slack.com/apps).
2. Click **Create New App** → **From an app manifest**.
3. Select your workspace.
4. Paste the JSON from [slack-app-manifest.json](slack-app-manifest.json) (remove the ../) in this repository.
5. Click **Next** → **Create**.
6. Go to **Basic Information** → **App-Level Tokens** → Generate a token with the `connections:write` scope. Copy this token (starts with `xapp-`).
7. Go to **Install App** → **Install to Workspace** → **Allow**. Copy the **Bot User OAuth Token** (starts with `xoxb-`).
8. Copy the **Signing Secret** from the Basic Information page.

### Option B: Manual Creation
If you prefer manual setup:
1. Create New App → From scratch.
2. **App Home**: Enable Messages Tab, disable Read-only.
3. **Bot User**: Display name `Omni-Ops`, Always online: ✅.
4. **Slash Commands**: Add all 11 commands manually (see Command Reference below).
5. **OAuth & Permissions**: Add bot scopes: `app_mentions:read`, `channels:join`, `channels:manage`, `channels:read`, `chat:write`, `chat:write.public`, `commands`, `im:history`, `im:write`, `reactions:write`, `team:read`, `users:read`, `users:read.email`.
6. **Event Subscriptions**: Enable, subscribe to bot events: `app_mention`, `message.im`, `team_join`.
7. **Basic Information**: Generate App-Level Token with `connections:write`.
8. **Install to Workspace**.

---

## 2. Environment Variables

Set these on your **Slack Bot service** (Railway, Docker, etc.):

### Required Variables
```env
# From Slack App → Basic Information → App-Level Tokens
SLACK_APP_TOKEN="xapp-1-..."

# From Slack App → Install App → Bot User OAuth Token
SLACK_BOT_TOKEN="xoxb-..."

# From Slack App → Basic Information → Signing Secret
SLACK_SIGNING_SECRET="..."

# API Connection
API_URL="http://your-api.railway.internal:3000"
API_PUBLIC_URL="https://your-api.up.railway.app"
INTERNAL_API_KEY="must-match-api-service"

# PDF Links (must match API)
PDF_LINK_SECRET="must-match-api-service"
````

### Optional Variables

```env
# Timezone fallback (if workspace tz not set)
DEFAULT_TIMEZONE="Asia/Qatar"

# Internal notify server port (for WhatsApp lead pushes)
NOTIFY_PORT=3001
```

---

## 3. Deploy Slack Bot

### Railway (Recommended)

1. Create new service → Deploy from GitHub repo.
2. Root Directory: `Omni-Ops-slack`.
3. Environment Variables: Paste all variables from step 2.
4. Deploy.

### Docker

```bash
cd Omni-Ops-slack
docker build -t omni-ops-slack .
docker run -d --env-file .env -p 3001:3001 omni-ops-slack
```

### Direct Node

```bash
cd Omni-Ops-slack
npm install
npm start
```

**Verify deployment:**

- Check logs for: `Omni-Ops Slack bot is running (Socket Mode)`
- In Slack, type `/omni-` → all 11 commands should appear in autocomplete.

---

## 4. First Run

### Step 1: Verify API Connection

```text
/omni-ping
```

Expected response: `🏓 Pong! Connected to *Your Workspace Name* _(platform: SLACK)_`

### Step 2: Register as Admin

```text
/omni-employee register
```

This creates your employee record. If you're the workspace owner, you automatically become Admin.

### Step 3: Configure Workspace

```text
/omni-config
```

Click **⚙️ Name** to set your organization name, **🌍 Timezone** (e.g., `Asia/Qatar`), and **💱 Currency** (e.g., `QAR`).

### Step 4: Connect Google (Optional)

1. Ensure `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` are set on your API service.
2. In Slack: `/omni-config` → Click **🔗 Connect Google**.
3. Authorize in the browser. First connect auto-provisions your Calendar and 4 Sheets.

### Step 5: Test Core Features

- **Create a task**: `/omni-task create`
- **View your tasks**: `/omni-my tasks`
- **Test AI assistant**: `@Omni-Ops list my open tasks`

---

## 5. Troubleshooting

### Commands don't appear in autocomplete

**Cause**: Slash commands not registered in Slack app.
**Fix**:

1. Go to api.slack.com/apps → your app → App Manifest → Update from manifest.
2. Install App → reinstall to workspace (yellow banner at top).
3. Reload Slack client (Ctrl+R / Cmd+R).

### "You are not registered" error

**Cause**: Your Slack account isn't linked to an employee record.
**Fix**: Run `/omni-employee register`.

### "API error: 404" or "Could not reach API"

**Cause**: `API_URL` is wrong or API service is down.
**Fix**: Check `API_URL` points to the internal network URL (e.g., `http://omni-ops-api.railway.internal:3000`). Verify `INTERNAL_API_KEY` matches between API and Slack services.

### WhatsApp leads not pushing to channel

**Cause**: `SLACK_BOT_NOTIFY_URL` not set on API, or leads channel not configured.
**Fix**:

1. API env var: `SLACK_BOT_NOTIFY_URL="http://omni-ops-slack.railway.internal:3001"`
2. Configure leads channel: Run `/omni-config` inside your `#leads` channel, click the **📢 Leads** button.

### AI assistant returns "not configured"

**Cause**: No AI provider configured for workspace.
**Fix**: `/omni-config` → Click **🤖 AI** → select provider → enter API key → Save.

---

## Command Reference

| Command                                                              | Description                             |
| -------------------------------------------------------------------- | --------------------------------------- |
| `/omni-ping`                                                         | Test connectivity                       |
| `/omni-config`                                                       | Workspace control panel                 |
| `/omni-employee register`                                            | Register yourself (owner becomes Admin) |
| `/omni-employee link <email>`                                        | Link Slack account to employee record   |
| `/omni-employee create/edit/list`                                    | Manage employee records (Manager+)      |
| `/omni-employee set-admin <user>`                                    | Promote to Admin (Admin only)           |
| `/omni-task create/list/edit/status/delete`                          | Task management                         |
| `/omni-appointment add/list/edit/delete`                             | Appointment scheduling                  |
| `/omni-calendar create/list/edit/delete/sync`                        | Organization events                     |
| `/omni-invoice create/list/status/delete`                            | Invoicing and payments                  |
| `/omni-dashboard`                                                    | Management statistics                   |
| `/omni-my profile/tasks/appointments/performance/reminders`          | Personal workspace                      |
| `/omni-leads list/add/multi-add/info/assign/status/note/edit/delete` | CRM management                          |
| `/omni-campaign audience/new/list/send/stop/status/info/recipients`  | WhatsApp campaigns                      |
| `@Omni-Ops <question>`                                               | AI assistant in channel                 |
| DM bot                                                               | AI assistant in private chat            |
