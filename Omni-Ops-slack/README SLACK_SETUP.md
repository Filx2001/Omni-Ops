## Google integration (Sheets + Calendar)

Each workspace (Discord server or Slack team) connects its own Google account.
Refresh tokens are stored encrypted per workspace; tenants never share data.

1. Create a Google Cloud OAuth 2.0 client (Web application) with redirect
   URI `${API_PUBLIC_URL}/google/callback`.
2. Set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` and `API_PUBLIC_URL` on the API.
3. Connect a workspace:
   - Slack: `/omni-config` → Connect Google
   - Discord: `/config setup` → Connect Google
   - Or open `${API_PUBLIC_URL}/google/connect?ws=<server-or-team-id>` directly.
4. First connect provisions one Calendar and four Sheets for that workspace.

### OAuth consent screen modes

| Mode                      | Who can connect                   | Notes                                                                 |
| ------------------------- | --------------------------------- | --------------------------------------------------------------------- |
| Testing                   | Listed test users (max 100)       | Refresh tokens expire every 7 days — never run production on Testing  |
| Production, unverified    | Anyone, via "Advanced → Continue" | Fine for self-hosted and small teams                                  |
| Production, verified      | Anyone, clean consent             | Requires your own domain, public landing page, privacy policy + terms |
| Internal (Workspace orgs) | Users in your domain only         | No verification, no expiry; single-org deployments only               |

Verification is per OAuth client: every self-hosted deployment owns its client
and its verification status.
