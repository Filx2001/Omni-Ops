const axios = require("../utils/axiosInstance");
const { runWithTenant } = require("../utils/tenantContext");

module.exports = {
  async handleTeamJoin({ event, client }) {
    const workspaceId = event.team_id;
    const userId = event.user.id;

    try {
      // Get workspace config
      const wsResponse = await runWithTenant(workspaceId, async () => {
        return axios.get(`/workspaces/slack/${workspaceId}`);
      });

      const workspace = wsResponse.data;

      // Get user's email from Slack
      const userInfo = await client.users.info({ user: userId });
      const email = userInfo.user.profile.email;

      if (!email) {
        console.log(`[Team Join] User ${userId} has no email - skipping auto-link`);
        return;
      }

      // Try to find existing employee by email
      let employee;
      try {
        const employeesResponse = await runWithTenant(workspaceId, async () => {
          return axios.get(`/employees`);
        });

        employee = employeesResponse.data.find((e) => e.email === email);
      } catch (error) {
        console.error("[Team Join] Failed to fetch employees:", error.message);
        return;
      }

      if (!employee) {
        console.log(`[Team Join] No employee found for ${email} - user will need to self-register`);

        // Send welcome DM with registration instructions
        await client.chat.postMessage({
          channel: userId,
          blocks: [
            {
              type: "header",
              text: { type: "plain_text", text: " Welcome to Omni-Ops!", emoji: true },
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text:
                  `Hi ${userInfo.user.profile.real_name}! I noticed you joined the workspace.\n\n` +
                  `To get started, please register your account:`,
              },
            },
            {
              type: "actions",
              elements: [
                {
                  type: "button",
                  text: { type: "plain_text", text: "📝 Register Now", emoji: true },
                  action_id: "register_button",
                  value: "register",
                },
              ],
            },
          ],
        });

        return;
      }

      // Link the Slack account to the employee record
      if (!employee.externalId) {
        await runWithTenant(workspaceId, async () => {
          await axios.patch(`/employees/${employee.id}/link`, {
            externalId: userId,
          });
        });

        console.log(`[Team Join] Auto-linked ${email} to employee ${employee.id}`);
      }

      // Auto-invite to configured channels (if any)
      const channelsToInvite = [];

      // Add welcome channel if configured
      if (workspace.welcomeChannelId) {
        channelsToInvite.push(workspace.welcomeChannelId);
      }

      // Add intro channel if configured
      if (workspace.introChannelId) {
        channelsToInvite.push(workspace.introChannelId);
      }

      for (const channelId of channelsToInvite) {
        try {
          await client.conversations.invite({
            channel: channelId,
            users: userId,
          });
          console.log(`[Team Join] Invited ${userId} to channel ${channelId}`);
        } catch (error) {
          console.error(`[Team Join] Failed to invite to ${channelId}:`, error.message);
        }
      }

      // Send welcome DM
      await client.chat.postMessage({
        channel: userId,
        blocks: [
          {
            type: "header",
            text: { type: "plain_text", text: "👋 Welcome, " + employee.name + "!", emoji: true },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                `You've been automatically linked to your employee record.\n\n` +
                `*Role:* ${employee.role?.name || "Pending assignment"}\n` +
                `*Email:* ${employee.email}\n\n` +
                `Use \`/omni-help\` to see available commands.`,
            },
          },
        ],
      });

      console.log(`[Team Join] Successfully processed ${userId} (${email})`);
    } catch (error) {
      console.error("[Team Join] Error:", error.message);
    }
  },
};
