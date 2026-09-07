/**
 * Employee management commands for the Slack surface.
 *
 * Slack slash commands accept a single raw text argument, so subcommand
 * routing lives in `src/index.js`. This module exposes one handler per
 * subcommand:
 *
 *   - `link`      Attach a Slack account to an employee record via verified email.
 *   - `register`  Self-service registration. The Slack workspace owner is
 *                 automatically granted the Admin role so every new
 *                 installation has a bootstrap administrator.
 *   - `info`      Show the caller's own employee record.
 *   - `set-admin` Promote a registered employee to Admin (Admin-only).
 *
 * All API calls run inside `runWithTenant` so the shared axios instance
 * attaches the workspace-scoped headers automatically.
 *
 * @module commands/employee
 */

const axios = require("../utils/axiosInstance");
const { runWithTenant } = require("../utils/tenantContext");
const { buildSuccessBlock, buildErrorBlock } = require("../utils/slackBlocks");

const MANAGEMENT_ROLES = ["Admin", "Manager"];

/**
 * Resolves an employee record from a Slack user ID.
 *
 * @param {string} slackUserId - Slack user ID (e.g. "U0123ABC").
 * @param {string} workspaceId - Slack team ID used as the tenant key.
 * @returns {Promise<Object|null>} The employee record, or null if not registered.
 */
async function getEmployeeBySlackId(slackUserId, workspaceId) {
  try {
    const response = await runWithTenant(workspaceId, () =>
      axios.get(`/employees/external/${slackUserId}`)
    );
    return response.data || null;
  } catch {
    return null;
  }
}

/**
 * Returns the workspace's Admin role, creating it if the workspace
 * was seeded before the role existed.
 *
 * @param {string} workspaceId - Tenant key.
 * @returns {Promise<Object>} The Admin role record.
 */
async function ensureAdminRole(workspaceId) {
  const rolesResponse = await runWithTenant(workspaceId, () => axios.get(`/roles`));
  const existing = (rolesResponse.data || []).find((role) => role.name === "Admin");
  if (existing) return existing;

  const created = await runWithTenant(workspaceId, () =>
    axios.post(`/roles`, { name: "Admin", description: "Full system access" })
  );
  return created.data;
}

/**
 * Bootstrap rule: the Slack workspace owner always ends up with the Admin
 * role. Without this, a fresh installation has no manager and every
 * management command is unreachable.
 *
 * @param {Object} employee - Current employee record.
 * @param {boolean} isWorkspaceOwner - True when the Slack user owns the workspace.
 * @param {string} workspaceId - Tenant key.
 * @returns {Promise<Object>} The (possibly promoted) employee record.
 */
async function promoteToAdminIfOwner(employee, isWorkspaceOwner, workspaceId) {
  if (!isWorkspaceOwner || employee?.role?.name === "Admin") return employee;

  const adminRole = await ensureAdminRole(workspaceId);
  const response = await runWithTenant(workspaceId, () =>
    axios.patch(`/employees/${employee.id}/role`, { roleId: adminRole.id })
  );
  return response.data;
}

/**
 * Finds an employee by email address (case-insensitive).
 *
 * @param {string} email - Email to search for.
 * @param {string} workspaceId - Tenant key.
 * @returns {Promise<Object|null>} Matching employee or null.
 */
async function findEmployeeByEmail(email, workspaceId) {
  const response = await runWithTenant(workspaceId, () => axios.get(`/employees`));
  const normalized = String(email).toLowerCase();
  return (response.data || []).find((e) => e.email?.toLowerCase() === normalized) || null;
}

module.exports = {
  /**
   * `/omni-employee link <email>`
   * Attaches a Slack account to an employee record. Management-only.
   * Resolution order: platform ID → verified Slack email → create new record.
   */
  async handleEmployeeLink({ command, ack, say, client }) {
    await ack();

    try {
      const workspaceId = command.team_id;
      const email = command.text.trim();

      if (!email || !email.includes("@")) {
        return say({
          text: "Missing email argument",
          blocks: buildErrorBlock("Usage: `/omni-employee link user@company.com`"),
          response_type: "ephemeral",
        });
      }

      const requester = await getEmployeeBySlackId(command.user_id, workspaceId);
      if (!MANAGEMENT_ROLES.includes(requester?.role?.name)) {
        return say({
          text: "Permission denied",
          blocks: buildErrorBlock("Only Admins and Managers can link employees."),
          response_type: "ephemeral",
        });
      }

      // Resolve the Slack account behind the email (verified by Slack itself)
      const slackUser = await client.users.lookupByEmail({ email });
      if (!slackUser.ok || !slackUser.user) {
        return say({
          text: "Slack user not found",
          blocks: buildErrorBlock(`No Slack user found with email *${email}*.`),
          response_type: "ephemeral",
        });
      }
      const targetSlackId = slackUser.user.id;

      // Resolve or create the employee record
      let employee = await getEmployeeBySlackId(targetSlackId, workspaceId);
      if (!employee) {
        employee = await findEmployeeByEmail(email, workspaceId);
      }
      if (!employee) {
        const created = await runWithTenant(workspaceId, () =>
          axios.post(`/employees`, {
            name: slackUser.user.profile.real_name || email,
            email,
            phone: slackUser.user.profile.phone || null,
            externalId: targetSlackId,
          })
        );
        employee = created.data;
      } else if (employee.externalId !== targetSlackId) {
        const linked = await runWithTenant(workspaceId, () =>
          axios.patch(`/employees/${employee.id}/link`, { externalId: targetSlackId })
        );
        employee = linked.data;
      }

      return say({
        text: "Employee linked",
        blocks: buildSuccessBlock(
          `Employee linked successfully.\n` +
            `*Name:* ${employee.name}\n` +
            `*Email:* ${employee.email}\n` +
            `*Slack user:* <@${targetSlackId}>`
        ),
        response_type: "ephemeral",
      });
    } catch (error) {
      console.error("Employee link error:", error.message);
      return say({
        text: "Link failed",
        blocks: buildErrorBlock(
          `Failed to link employee: ${error.response?.data?.error || error.message}`
        ),
        response_type: "ephemeral",
      });
    }
  },

  /**
   * `/omni-employee register`
   * Self-service registration. Creates the employee record from the caller's
   * verified Slack profile, falls back to the Email Bridge when a record with
   * the same email already exists, and grants Admin to the workspace owner.
   */
  async handleEmployeeRegister({ command, ack, say, client }) {
    await ack();

    try {
      const workspaceId = command.team_id;
      const slackUserId = command.user_id;

      const userInfo = await client.users.info({ user: slackUserId });
      const isWorkspaceOwner = Boolean(userInfo.user?.is_owner || userInfo.user?.is_primary_owner);
      const email = userInfo.user?.profile?.email;

      if (!email) {
        return say({
          text: "No email on Slack profile",
          blocks: buildErrorBlock(
            "Your Slack profile has no email address. Add one in your Slack profile and try again."
          ),
          response_type: "ephemeral",
        });
      }

      let employee = await getEmployeeBySlackId(slackUserId, workspaceId);

      if (!employee) {
        try {
          const created = await runWithTenant(workspaceId, () =>
            axios.post(`/employees`, {
              name: userInfo.user.profile.real_name || userInfo.user.real_name || email,
              email,
              phone: userInfo.user.profile.phone || null,
              externalId: slackUserId,
            })
          );
          employee = created.data;
        } catch (error) {
          // Email already exists in this workspace: link the existing record
          // instead of failing (Email Bridge).
          if (error.response?.status === 409) {
            const existing = await findEmployeeByEmail(email, workspaceId);
            if (!existing) throw error;
            const linked = await runWithTenant(workspaceId, () =>
              axios.patch(`/employees/${existing.id}/link`, { externalId: slackUserId })
            );
            employee = linked.data;
          } else {
            throw error;
          }
        }
      }

      // Bootstrap: workspace owner becomes Admin on first registration
      const promoted = await promoteToAdminIfOwner(employee, isWorkspaceOwner, workspaceId);

      return say({
        text: "Registration successful",
        blocks: buildSuccessBlock(
          `Registration successful.\n` +
            `*Name:* ${promoted.name}\n` +
            `*Email:* ${promoted.email}\n` +
            `*Role:* ${promoted.role?.name || "Pending assignment"}` +
            (promoted.role?.name === "Admin" && employee.role?.name !== "Admin"
              ? "\n_(Workspace owner bootstrap: Admin granted automatically.)_"
              : "")
        ),
        response_type: "ephemeral",
      });
    } catch (error) {
      console.error("Employee register error:", error.message);
      return say({
        text: "Registration failed",
        blocks: buildErrorBlock(
          `Registration failed: ${error.response?.data?.error || error.message}`
        ),
        response_type: "ephemeral",
      });
    }
  },

  /**
   * `/omni-employee info`
   * Shows the caller's own employee record.
   */
  async handleEmployeeInfo({ command, ack, say }) {
    await ack();

    try {
      const workspaceId = command.team_id;
      const employee = await getEmployeeBySlackId(command.user_id, workspaceId);

      if (!employee) {
        return say({
          text: "Not registered",
          blocks: buildErrorBlock(
            "You are not registered yet. Use `/omni-employee register` to get started."
          ),
          response_type: "ephemeral",
        });
      }

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
              text: `*Platform linked*\n${employee.externalId ? "✅ Linked" : "❌ Not linked"}`,
            },
          ],
        },
      ];

      return say({ text: "Employee information", blocks, response_type: "ephemeral" });
    } catch (error) {
      console.error("Employee info error:", error.message);
      return say({
        text: "Error",
        blocks: buildErrorBlock(`Failed to load your employee record: ${error.message}`),
        response_type: "ephemeral",
      });
    }
  },

  /**
   * `/omni-employee set-admin <email|@mention>`
   * Promotes a registered employee to Admin. Restricted to existing Admins,
   * matching the Discord bot's governance model.
   */
  async handleEmployeeSetAdmin({ command, ack, say }) {
    await ack();

    try {
      const workspaceId = command.team_id;
      const caller = await getEmployeeBySlackId(command.user_id, workspaceId);

      if (caller?.role?.name !== "Admin") {
        return say({
          text: "Permission denied",
          blocks: buildErrorBlock("Only an existing Admin can assign the Admin role."),
          response_type: "ephemeral",
        });
      }

      const argument = command.text.trim();
      const mention = /^<@([A-Z0-9]+)>$/i.exec(argument);

      let target = null;
      if (mention) {
        target = await getEmployeeBySlackId(mention[1], workspaceId);
      } else if (argument.includes("@")) {
        target = await findEmployeeByEmail(argument, workspaceId);
      }

      if (!target) {
        return say({
          text: "Employee not found",
          blocks: buildErrorBlock(
            "No registered employee matches that email or mention. They must run `/omni-employee register` first."
          ),
          response_type: "ephemeral",
        });
      }

      const adminRole = await ensureAdminRole(workspaceId);
      const updated = await runWithTenant(workspaceId, () =>
        axios.patch(`/employees/${target.id}/role`, { roleId: adminRole.id })
      );

      return say({
        text: "Admin assigned",
        blocks: buildSuccessBlock(`*${updated.data?.name || target.name}* is now an Admin.`),
        response_type: "ephemeral",
      });
    } catch (error) {
      console.error("Employee set-admin error:", error.message);
      return say({
        text: "Error",
        blocks: buildErrorBlock(
          `Failed to promote: ${error.response?.data?.error || error.message}`
        ),
        response_type: "ephemeral",
      });
    }
  },
};
