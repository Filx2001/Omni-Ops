const axios = require("../utils/axiosInstance");
const { runWithTenant } = require("../utils/tenantContext");
const { buildSuccessBlock, buildErrorBlock } = require("../utils/slackBlocks");

module.exports = {
  // /omni-employee link - Link Slack user to employee via email
  async handleEmployeeLink({ command, ack, say, client }) {
    await ack();

    try {
      const workspaceId = command.team_id;
      const slackUserId = command.user_id;
      const email = command.text.trim(); // Email passed as argument

      if (!email || !email.includes("@")) {
        const blocks = buildErrorBlock(
          "❌ Please provide an email address: `/omni-employee link user@company.com`"
        );
        return say({ blocks, response_type: "ephemeral" });
      }

      // Check if requester is a manager
      const requesterResponse = await runWithTenant(workspaceId, async () => {
        return axios.get(`/employees/external/${slackUserId}`);
      });

      const requester = requesterResponse.data;
      const isManager = ["Admin", "Manager"].includes(requester?.role?.name);

      if (!isManager) {
        const blocks = buildErrorBlock("❌ Only Admins and Managers can link employees.");
        return say({ blocks, response_type: "ephemeral" });
      }

      // Look up Slack user by email
      const slackUser = await client.users.lookupByEmail({ email });

      if (!slackUser.ok || !slackUser.user) {
        const blocks = buildErrorBlock(`❌ No Slack user found with email *${email}*`);
        return say({ blocks, response_type: "ephemeral" });
      }

      const targetSlackId = slackUser.user.id;

      // Find or create employee record
      let employee;
      try {
        const empResponse = await runWithTenant(workspaceId, async () => {
          return axios.get(`/employees/external/${targetSlackId}`);
        });
        employee = empResponse.data;
      } catch {
        // Employee doesn't exist yet - create it
        const createPayload = {
          name: slackUser.user.profile.real_name,
          email: email,
          phone: slackUser.user.profile.phone || null,
          externalId: targetSlackId,
          roleId: null, // Will need to be set separately
        };

        const createResponse = await runWithTenant(workspaceId, async () => {
          return axios.post(`/employees`, createPayload);
        });
        employee = createResponse.data;
      }

      // Link if not already linked
      if (!employee.externalId) {
        await runWithTenant(workspaceId, async () => {
          await axios.patch(`/employees/${employee.id}/link`, {
            externalId: targetSlackId,
          });
        });
      }

      const blocks = buildSuccessBlock(
        `✅ Employee linked successfully!\n` +
          `*Name:* ${employee.name}\n` +
          `*Email:* ${employee.email}\n` +
          `*Slack User:* <@${targetSlackId}>`
      );

      await say({
        text: "Omni-Ops Response", // ⚠️ Fallback added
        blocks,
        response_type: "ephemeral",
      });
    } catch (error) {
      console.error("Employee link error:", error.message);
      const blocks = buildErrorBlock(`❌ Failed to link employee: ${error.message}`);
      await say({
        text: "Omni-Ops Response", // ⚠️ Fallback added
        blocks,
        response_type: "ephemeral",
      });
    }
  },

  // /omni-employee register - Manual registration (self-service)
  async handleEmployeeRegister({ command, ack, say, client }) {
    await ack();

    try {
      const workspaceId = command.team_id;
      const slackUserId = command.user_id;

      // Check if already registered
      let existingEmployee;
      try {
        const response = await runWithTenant(workspaceId, async () => {
          return axios.get(`/employees/external/${slackUserId}`);
        });
        existingEmployee = response.data;
      } catch {
        // Not found - good, we can register
      }

      if (existingEmployee) {
        const blocks = buildSuccessBlock(
          `✅ You're already registered as *${existingEmployee.name}* (${existingEmployee.role?.name || "No role"})`
        );
        return say({ blocks, response_type: "ephemeral" });
      }

      // Get user info from Slack
      const userInfo = await client.users.info({ user: slackUserId });
      const email = userInfo.user.profile.email;

      if (!email) {
        const blocks = buildErrorBlock(
          "❌ Your Slack profile doesn't have an email address. Please add it to your profile first."
        );
        return say({ blocks, response_type: "ephemeral" });
      }

      // Create employee record
      const createPayload = {
        name: userInfo.user.profile.real_name,
        email: email,
        phone: userInfo.user.profile.phone || null,
        externalId: slackUserId,
        roleId: null, // Default role (Agent) - managers can promote later
      };

      const response = await runWithTenant(workspaceId, async () => {
        return axios.post(`/employees`, createPayload);
      });

      const employee = response.data;

      const blocks = buildSuccessBlock(
        `✅ Registration successful!\n` +
          `*Name:* ${employee.name}\n` +
          `*Email:* ${employee.email}\n` +
          `*Role:* ${employee.role?.name || "Pending assignment"}`
      );

      await say({
        text: "Omni-Ops Response", // ⚠️ Fallback added
        blocks,
        response_type: "ephemeral",
      });
    } catch (error) {
      console.error("Employee register error:", error.message);
      const blocks = buildErrorBlock(`❌ Registration failed: ${error.message}`);
      await say({
        text: "Omni-Ops Response", // ⚠️ Fallback added
        blocks,
        response_type: "ephemeral",
      });
    }
  },

  // /omni-employee info - View your employee record
  async handleEmployeeInfo({ command, ack, say }) {
    await ack();

    try {
      const workspaceId = command.team_id;
      const slackUserId = command.user_id;

      const response = await runWithTenant(workspaceId, async () => {
        return axios.get(`/employees/external/${slackUserId}`);
      });

      const employee = response.data;

      const blocks = [
        {
          type: "header",
          text: { type: "plain_text", text: " Employee Information", emoji: true },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Name*\n${employee.name}` },
            { type: "mrkdwn", text: `*Email*\n${employee.email || "N/A"}` },
            { type: "mrkdwn", text: `*Phone*\n${employee.phone || "N/A"}` },
            { type: "mrkdwn", text: `*Role*\n${employee.role?.name || "No role"}` },
            {
              type: "mrkdwn",
              text: `*Status*\n${employee.isActive ? "🟢 Active" : "🔴 Inactive"}`,
            },
            {
              type: "mrkdwn",
              text: `*Platform Linked*\n${employee.externalId ? "✅ Linked" : "❌ Not Linked"}`,
            },
          ],
        },
      ];

      await say({
        text: "Omni-Ops Response", // ⚠️ Fallback added
        blocks,
        response_type: "ephemeral",
      });
    } catch (error) {
      console.error("Employee info error:", error.message);
      const blocks = buildErrorBlock(
        "❌ You're not registered yet. Use `/omni-employee register` to get started."
      );
      await say({
        text: "Omni-Ops Response", // ⚠️ Fallback added
        blocks,
        response_type: "ephemeral",
      });
    }
  },
};
