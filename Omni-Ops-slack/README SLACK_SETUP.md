# Slack Setup Guide

Deploying Omni-Ops on Slack, start to finish. This guide assumes the API service is already deployed and running — see the [README](README.md) if it isn't.

## Contents

1. [Create the Slack app](#1-create-the-slack-app)
2. [Environment variables](#2-environment-variables)
3. [Deploy the bot](#3-deploy-the-bot)
4. [First run](#4-first-run)
5. [Troubleshooting](#5-troubleshooting)

---

## 1. Create the Slack app

### Option A — from the manifest (recommended)

The manifest creates the app with all slash commands, scopes and event subscriptions already configured.

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From an app manifest**.
2. Select your workspace.
3. Paste the contents of [`slack-app-manifest.json`](Omni-Ops-slack/slack-app-manifest.json) and click **Next** → **Create**.
4. **Basic Information → App-Level Tokens** → generate a token with the `connections:write` scope. Copy it — it starts with `xapp-`.
5. **Install App → Install to Workspace → Allow**. Copy the **Bot User OAuth Token**, starting with `xoxb-`.
6. Copy the **Signing Secret** from Basic Information.

You now have the three Slack values you need for the next step.

### Option B — manual setup

1. **Create New App → From scratch.**
2. **App Home** — enable the Messages tab, disable read-only.
3. **Bot User** — display name `Omni-Ops`, always online on.
4. **Slash Commands** — add each command from the [reference table](#command-reference).
5. **OAuth & Permissions** — add these bot scopes:

   ```
   app_mentions:read   channels:join       channels:manage
   channels:read       chat:write          chat:write.public
   commands            im:history          im:write
   reactions:write     team:read           users:read
   users:read.email
   ```

6. **Event Subscriptions** — enable, then subscribe to `app_mention`, `message.im` and `team_join`.
7. **Basic Information** — generate an App-Level Token with `connections:write`.
8. **Install to Workspace.**

---

## 2. Environment variables

Set these on the Slack bot service.

```env
# Slack credentials
SLACK_APP_TOKEN="xapp-1-..."        # Basic Information → App-Level Tokens
SLACK_BOT_TOKEN="xoxb-..."          # Install App → Bot User OAuth Token
SLACK_SIGNING_SECRET="..."          # Basic Information → Signing Secret

# API connection — both must match the API service exactly
API_URL="http://omni-ops-api.railway.internal:3000"
API_PUBLIC_URL="https://your-api.up.railway.app"
INTERNAL_API_KEY="must-match-api-service"
PDF_LINK_SECRET="must-match-api-service"
```

Optional:

```env
DEFAULT_TIMEZONE="Asia/Qatar"   # fallback when a workspace has no timezone set
NOTIFY_PORT=3001                # internal notify server, for WhatsApp lead pushes
```

`API_URL` should be the **internal** address where your host provides one — it keeps bot-to-API traffic off the public internet. `API_PUBLIC_URL` is the external address, used only for links the bot posts into Slack.

---

## 3. Deploy the bot

### Railway (recommended)

1. New service → deploy from this GitHub repo.
2. Set **Root Directory** to `Omni-Ops-slack`.
3. Paste the environment variables from step 2.
4. Deploy.

### Docker

```bash
cd Omni-Ops-slack
docker build -t omni-ops-slack .
docker run -d --env-file .env -p 3001:3001 omni-ops-slack
```

### Directly with Node

```bash
cd Omni-Ops-slack
npm install
npm start
```

**Verify it worked:**

- Logs show `Omni-Ops Slack bot is running (Socket Mode)`.
- Typing `/omni-` in Slack lists every command in autocomplete.

Socket Mode means there's no public webhook to expose — the bot dials out to Slack, so it works behind a private network.

---

## 4. First run

**Check connectivity**

```
/omni-ping
```

Expect: `🏓 Pong! Connected to *Your Workspace Name* _(platform: SLACK)_`

**Register yourself**

```
/omni-employee register
```

Creates your employee record. Workspace owners automatically become Admin.

**Configure the workspace**

```
/omni-config
```

Set **⚙️ Name**, **🌍 Timezone** (for example `Asia/Qatar`) and **💱 Currency** (for example `QAR`). Timezone matters more than it looks — every reminder, recurring appointment and scheduled report is computed against it.

**Connect Google (optional)**

1. Confirm `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` are set on the **API** service, not the bot.
2. `/omni-config` → **🔗 Connect Google** → authorize in the browser.

The first connection provisions a Calendar and four Sheets automatically.

**Smoke test**

```
/omni-task create
/omni-my tasks
@Omni-Ops list my open tasks
```

---

## 5. Troubleshooting

### Commands don't appear in autocomplete

The slash commands aren't registered on the Slack app.

1. api.slack.com/apps → your app → **App Manifest** → update from manifest.
2. **Install App** → reinstall to the workspace (look for the yellow banner).
3. Reload the Slack client with `Ctrl+R` / `Cmd+R`.

### "You are not registered"

Your Slack account isn't linked to an employee record. Run `/omni-employee register`, or `/omni-employee link <email>` if a record already exists under your work email.

### "API error: 404" or "Could not reach API"

`API_URL` is wrong, or the API is down. Confirm the internal hostname resolves from the bot's network, and that `INTERNAL_API_KEY` is byte-identical on both services — a trailing space in a dashboard field is the usual culprit.

### WhatsApp leads aren't reaching the channel

1. On the **API** service, set `SLACK_BOT_NOTIFY_URL="http://omni-ops-slack.railway.internal:3001"`.
2. In Slack, run `/omni-config` from inside your `#leads` channel and click **📢 Leads** to bind it.

### AI assistant says "not configured"

No AI provider is set for this workspace. `/omni-config` → **🤖 AI** → choose a provider → paste the key → save. Keys are stored encrypted and are per-workspace, so each team can use its own.

### The bot connects but ignores @mentions

Check that `app_mention` and `message.im` are subscribed under Event Subscriptions, and that the bot has been invited to the channel.

---

## Command reference

| Command                                                                              | Description                             |
| ------------------------------------------------------------------------------------ | --------------------------------------- |
| `/omni-ping`                                                                         | Test connectivity                       |
| `/omni-config`                                                                       | Workspace control panel                 |
| `/omni-employee register`                                                            | Register yourself (owner becomes Admin) |
| `/omni-employee link <email>`                                                        | Link your Slack account to an employee  |
| `/omni-employee create · edit · list`                                                | Manage employee records (Manager+)      |
| `/omni-employee set-admin <user>`                                                    | Promote to Admin (Admin only)           |
| `/omni-task create · list · edit · status · delete`                                  | Task management                         |
| `/omni-appointment add · list · edit · delete`                                       | Appointment scheduling                  |
| `/omni-calendar create · list · edit · delete · sync`                                | Organization events                     |
| `/omni-invoice create · list · status · delete`                                      | Invoicing and payments                  |
| `/omni-dashboard`                                                                    | Management statistics                   |
| `/omni-my profile · tasks · appointments · performance · reminders`                  | Personal workspace                      |
| `/omni-leads list · add · multi-add · info · assign · status · note · edit · delete` | CRM management                          |
| `/omni-campaign audience · new · list · send · stop · status · info · recipients`    | WhatsApp campaigns                      |
| `@Omni-Ops <question>`                                                               | AI assistant in a channel               |
| DM the bot                                                                           | AI assistant in private                 |
