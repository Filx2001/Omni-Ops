const axios = require("./axiosInstance");
const { runWithTenant } = require("./tenantContext");

module.exports = {
  storeInstallation: async (installation) => {
    const teamId = installation.team.id;
    await runWithTenant(teamId, async () => {
      // Ensure workspace exists
      await axios
        .post("/workspaces", {
          platform: "SLACK",
          workspaceId: teamId,
          organizationName: installation.team.name,
        })
        .catch(() => {}); // Ignore if exists

      // Save the token (API will encrypt it)
      await axios.patch(`/workspaces/slack/${teamId}`, {
        slackBotToken: installation.bot.token,
        slackBotUserId: installation.bot.id,
      });
    });
  },

  fetchInstallation: async ({ teamId }) => {
    return await runWithTenant(teamId, async () => {
      // Get the DECRYPTED token from the special credentials route
      const res = await axios.get(`/workspaces/slack/${teamId}/credentials`);
      if (!res.data.botToken) throw new Error("No bot token found");

      return {
        team: { id: teamId },
        bot: {
          token: res.data.botToken,
          id: res.data.botUserId,
          scopes: ["chat:write", "commands", "app_mentions:read"],
        },
      };
    });
  },

  deleteInstallation: async ({ teamId }) => {
    // Optional: handle uninstall
  },
};
