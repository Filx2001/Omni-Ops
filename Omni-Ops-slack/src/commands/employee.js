/**
 * /omni-employee command: link, register, info, set-admin, create, edit, list.
 */

const axios = require("../utils/axiosInstance");
const { runWithTenant } = require("../utils/tenantContext");
const { buildSuccessBlock, buildErrorBlock } = require("../utils/slackBlocks");
const { sendDm } = require("../utils/slackDm");

const MANAGEMENT_ROLES = ["Admin", "Manager"];

/** Employee record for a Slack user, or null when unregistered. */
async function getEmployeeBySlackId(slackUserId, workspaceId) {
  try {
    const res = await runWithTenant(workspaceId, () =>
      axios.get(`/employees/external/${slackUserId}`)
    );
    return res.data || null;
  } catch {
    return null;
  }
}

/** Returns the caller when they are a Manager/Admin, else null. */
async function requireManager(slackUserId, workspaceId) {
  const caller = await getEmployeeBySlackId(slackUserId, workspaceId);
  return MANAGEMENT_ROLES.includes(caller?.role?.name) ? caller : null;
}

/** The workspace Admin role, created on demand if missing. */
async function ensureAdminRole(workspaceId) {
  const rolesRes = await runWithTenant(workspaceId, () => axios.get(`/roles`));
  const existing = (rolesRes.data || []).find((role) => role.name === "Admin");
  if (existing) return existing;
  const created = await runWithTenant(workspaceId, () =>
    axios.post(`/roles`, { name: "Admin", description: "Full system access" })
  );
  return created.data;
}

/** Bootstrap rule: the Slack workspace owner always ends up as Admin. */
async function promoteToAdminIfOwner(employee, isWorkspaceOwner, workspaceId) {
  if (!isWorkspaceOwner || employee?.role?.name === "Admin") return employee;
  const adminRole = await ensureAdminRole(workspaceId);
  const res = await runWithTenant(workspaceId, () =>
    axios.patch(`/employees/${employee.id}/role`, { roleId: adminRole.id })
  );
  return res.data;
}

/** Finds an employee by email (case-insensitive). */
async function findEmployeeByEmail(email, workspaceId) {
  const res = await runWithTenant(workspaceId, () => axios.get(`/employees`));
  const normalized = String(email).toLowerCase();
  return (res.data || []).find((e) => e.email?.toLowerCase() === normalized) || null;
}

/** Role options for static selects, built live from the workspace roles. */
async function roleOptions(workspaceId) {
  const res = await runWithTenant(workspaceId, () => axios.get(`/roles`));
  return (res.data || []).map((role) => ({
    text: { type: "plain_text", text: role.name },
    value: role.id,
  }));
}

function buildEmployeeCreateModal(options) {
  return {
    type: "modal",
    callback_id: "employee_create_modal",
    title: { type: "plain_text", text: "Create Employee", emoji: true },
    submit: { type: "plain_text", text: "Create", emoji: true },
    close: { type: "plain_text", text: "Cancel", emoji: true },
    blocks: [
      {
        type: "input",
        block_id: "name_block",
        element: { type: "plain_text_input", action_id: "name" },
        label: { type: "plain_text", text: "Full name", emoji: true },
      },
      {
        type: "input",
        block_id: "email_block",
        element: { type: "plain_text_input", action_id: "email" },
        label: { type: "plain_text", text: "Email", emoji: true },
      },
      {
        type: "input",
        block_id: "phone_block",
        optional: true,
        element: { type: "plain_text_input", action_id: "phone" },
        label: { type: "plain_text", text: "Phone", emoji: true },
      },
      {
        type: "input",
        block_id: "role_block",
        optional: true,
        element: {
          type: "static_select",
          action_id: "role",
          placeholder: { type: "plain_text", text: "No role yet" },
          options,
        },
        label: { type: "plain_text", text: "Role", emoji: true },
      },
    ],
  };
}

function buildEmployeeEditModal(options) {
  return {
    type: "modal",
    callback_id: "employee_edit_modal",
    title: { type: "plain_text", text: "Edit Employee", emoji: true },
    submit: { type: "plain_text", text: "Save", emoji: true },
    close: { type: "plain_text", text: "Cancel", emoji: true },
    blocks: [
      {
        type: "input",
        block_id: "select_block",
        element: {
          type: "external_select",
          action_id: "employee",
          placeholder: { type: "plain_text", text: "Search employee..." },
          min_query_length: 2,
        },
        label: { type: "plain_text", text: "Employee", emoji: true },
      },
      {
        type: "input",
        block_id: "name_block",
        optional: true,
        element: { type: "plain_text_input", action_id: "name" },
        label: { type: "plain_text", text: "New name", emoji: true },
      },
      {
        type: "input",
        block_id: "email_block",
        optional: true,
        element: { type: "plain_text_input", action_id: "email" },
        label: { type: "plain_text", text: "New email", emoji: true },
      },
      {
        type: "input",
        block_id: "phone_block",
        optional: true,
        element: { type: "plain_text_input", action_id: "phone" },
        label: { type: "plain_text", text: "New phone", emoji: true },
      },
      {
        type: "input",
        block_id: "role_block",
        optional: true,
        element: {
          type: "static_select",
          action_id: "role",
          placeholder: { type: "plain_text", text: "Keep current" },
          options,
        },
        label: { type: "plain_text", text: "New role", emoji: true },
      },
    ],
  };
}

module.exports = {
  /** /omni-employee link <email> */
  async handleEmployeeLink({ command, ack, say, client }) {
    await ack();
    try {
      const workspaceId = command.team_id;
      const email = command.text.trim();
      if (!email || !email.includes("@")) {
        return say({
          text: "Missing email",
          blocks: buildErrorBlock("Usage: `/omni-employee link user@company.com`"),
          response_type: "ephemeral",
        });
      }
      const requester = await requireManager(command.user_id, workspaceId);
      if (!requester) {
        return say({
          text: "Permission denied",
          blocks: buildErrorBlock("Only Admins and Managers can link employees."),
          response_type: "ephemeral",
        });
      }
      const slackUser = await client.users.lookupByEmail({ email });
      if (!slackUser.ok || !slackUser.user) {
        return say({
          text: "User not found",
          blocks: buildErrorBlock(`No Slack user found with email *${email}*.`),
          response_type: "ephemeral",
        });
      }
      const targetSlackId = slackUser.user.id;
      let employee = await getEmployeeBySlackId(targetSlackId, workspaceId);
      if (!employee) employee = await findEmployeeByEmail(email, workspaceId);
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
      await say({
        text: "Employee linked",
        blocks: buildSuccessBlock(
          `Employee linked successfully.\n*Name:* ${employee.name}\n*Email:* ${employee.email}\n*Slack user:* <@${targetSlackId}>`
        ),
        response_type: "ephemeral",
      });
    } catch (error) {
      console.error("Employee link error:", error.message);
      await say({
        text: "Link failed",
        blocks: buildErrorBlock(
          `Failed to link employee: ${error.response?.data?.error || error.message}`
        ),
        response_type: "ephemeral",
      });
    }
  },

  /** /omni-employee register — self-service, owner becomes Admin. */
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
          text: "No email",
          blocks: buildErrorBlock(
            "Your Slack profile has no email address. Add one and try again."
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
      const promoted = await promoteToAdminIfOwner(employee, isWorkspaceOwner, workspaceId);
      await say({
        text: "Registration successful",
        blocks: buildSuccessBlock(
          `Registration successful.\n*Name:* ${promoted.name}\n*Email:* ${promoted.email}\n*Role:* ${promoted.role?.name || "Pending assignment"}`
        ),
        response_type: "ephemeral",
      });
    } catch (error) {
      console.error("Employee register error:", error.message);
      await say({
        text: "Registration failed",
        blocks: buildErrorBlock(
          `Registration failed: ${error.response?.data?.error || error.message}`
        ),
        response_type: "ephemeral",
      });
    }
  },

  /** /omni-employee info */
  async handleEmployeeInfo({ command, ack, say }) {
    await ack();
    try {
      const employee = await getEmployeeBySlackId(command.user_id, command.team_id);
      if (!employee) {
        return say({
          text: "Not registered",
          blocks: buildErrorBlock("You are not registered yet. Use `/omni-employee register`."),
          response_type: "ephemeral",
        });
      }
      await say({
        text: "Employee information",
        blocks: [
          {
            type: "header",
            text: { type: "plain_text", text: `👤 ${employee.name}`, emoji: true },
          },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*🎭 Role*\n${employee.role?.name || "No role"}` },
              { type: "mrkdwn", text: `*📧 Email*\n${employee.email || "N/A"}` },
              { type: "mrkdwn", text: `*📱 Phone*\n${employee.phone || "N/A"}` },
              {
                type: "mrkdwn",
                text: `*🔗 Linked*\n${employee.externalId ? "✅ Yes" : "❌ No"}`,
              },
            ],
          },
        ],
        response_type: "ephemeral",
      });
    } catch (error) {
      console.error("Employee info error:", error.message);
      await say({
        text: "Error",
        blocks: buildErrorBlock(`Failed to load your employee record: ${error.message}`),
        response_type: "ephemeral",
      });
    }
  },

  /** /omni-employee set-admin <email|@mention> */
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
      if (mention) target = await getEmployeeBySlackId(mention[1], workspaceId);
      else if (argument.includes("@")) target = await findEmployeeByEmail(argument, workspaceId);
      if (!target) {
        return say({
          text: "Not found",
          blocks: buildErrorBlock("No registered employee matches that email or mention."),
          response_type: "ephemeral",
        });
      }
      const adminRole = await ensureAdminRole(workspaceId);
      const updated = await runWithTenant(workspaceId, () =>
        axios.patch(`/employees/${target.id}/role`, { roleId: adminRole.id })
      );
      await say({
        text: "Admin assigned",
        blocks: buildSuccessBlock(`*${updated.data?.name || target.name}* is now an Admin.`),
        response_type: "ephemeral",
      });
    } catch (error) {
      console.error("Employee set-admin error:", error.message);
      await say({
        text: "Error",
        blocks: buildErrorBlock(
          `Failed to promote: ${error.response?.data?.error || error.message}`
        ),
        response_type: "ephemeral",
      });
    }
  },

  /** /omni-employee create — opens the create modal. */
  async handleEmployeeCreate({ command, ack, say, client }) {
    await ack();
    const workspaceId = command.team_id;
    try {
      const manager = await requireManager(command.user_id, workspaceId);
      if (!manager) {
        return say({
          text: "Permission denied",
          blocks: buildErrorBlock("Only Admins and Managers can create employees."),
          response_type: "ephemeral",
        });
      }
      const options = await roleOptions(workspaceId);
      await client.views.open({
        trigger_id: command.trigger_id,
        view: buildEmployeeCreateModal(options),
      });
    } catch (error) {
      console.error("Employee create open error:", error.message);
      await say({
        text: "Error",
        blocks: buildErrorBlock(error.message),
        response_type: "ephemeral",
      });
    }
  },

  /** employee_create_modal submission. */
  async handleEmployeeCreateSubmit({ body, view, ack, client }) {
    const workspaceId = body.team?.id || view.team_id;
    const userId = body.user?.id;
    try {
      if (view.callback_id !== "employee_create_modal") return ack();
      const manager = await requireManager(userId, workspaceId);
      if (!manager) {
        return ack({
          response_action: "errors",
          errors: { name_block: "Only Admins and Managers can create employees." },
        });
      }
      const values = view.state.values;
      const name = values.name_block?.name?.value?.trim();
      const email = values.email_block?.email?.value?.trim();
      const phone = values.phone_block?.phone?.value?.trim() || null;
      const roleId = values.role_block?.role?.selected_option?.value || null;
      const errors = {};
      if (!name) errors.name_block = "Name is required";
      if (!email || !email.includes("@")) errors.email_block = "A valid email is required";
      if (Object.keys(errors).length) return ack({ response_action: "errors", errors });

      const created = await runWithTenant(workspaceId, () =>
        axios.post(`/employees`, { name, email, phone, roleId })
      );
      await ack({ response_action: "clear" });
      await sendDm(client, userId, {
        text: `Employee created: ${created.data.name}`,
        blocks: buildSuccessBlock(
          `*${created.data.name}* created with role *${created.data.role?.name || "none"}*.\nLink their Slack account later with \`/omni-employee link ${email}\`.`
        ),
      });
    } catch (error) {
      console.error("Employee create error:", error.message);
      const message = error.response?.data?.error || error.message;
      await ack({
        response_action: "errors",
        errors: {
          email_block:
            error.response?.status === 409 ? "Email already exists in this workspace." : message,
        },
      });
    }
  },

  /** /omni-employee edit — opens the edit modal. */
  async handleEmployeeEdit({ command, ack, say, client }) {
    await ack();
    const workspaceId = command.team_id;
    try {
      const manager = await requireManager(command.user_id, workspaceId);
      if (!manager) {
        return say({
          text: "Permission denied",
          blocks: buildErrorBlock("Only Admins and Managers can edit employees."),
          response_type: "ephemeral",
        });
      }
      const options = await roleOptions(workspaceId);
      await client.views.open({
        trigger_id: command.trigger_id,
        view: buildEmployeeEditModal(options),
      });
    } catch (error) {
      console.error("Employee edit open error:", error.message);
      await say({
        text: "Error",
        blocks: buildErrorBlock(error.message),
        response_type: "ephemeral",
      });
    }
  },

  /** employee_edit_modal submission; empty fields keep current values. */
  async handleEmployeeEditSubmit({ body, view, ack, client }) {
    const workspaceId = body.team?.id || view.team_id;
    const userId = body.user?.id;
    try {
      if (view.callback_id !== "employee_edit_modal") return ack();
      const manager = await requireManager(userId, workspaceId);
      if (!manager) {
        return ack({
          response_action: "errors",
          errors: { select_block: "Only Admins and Managers can edit employees." },
        });
      }
      const values = view.state.values;
      const employeeId = values.select_block?.employee?.selected_option?.value;
      if (!employeeId) {
        return ack({ response_action: "errors", errors: { select_block: "Select an employee." } });
      }
      const updateData = {};
      if (values.name_block?.name?.value?.trim())
        updateData.name = values.name_block.name.value.trim();
      if (values.email_block?.email?.value?.trim())
        updateData.email = values.email_block.email.value.trim();
      if (values.phone_block?.phone?.value !== undefined)
        updateData.phone = values.phone_block.phone.value.trim() || null;
      const roleId = values.role_block?.role?.selected_option?.value;

      if (Object.keys(updateData).length === 0 && !roleId) {
        return ack({
          response_action: "errors",
          errors: { select_block: "Nothing to update. Fill at least one field." },
        });
      }
      let updated = null;
      if (Object.keys(updateData).length) {
        updated = (
          await runWithTenant(workspaceId, () =>
            axios.patch(`/employees/${employeeId}`, updateData)
          )
        ).data;
      }
      if (roleId) {
        updated = (
          await runWithTenant(workspaceId, () =>
            axios.patch(`/employees/${employeeId}/role`, { roleId })
          )
        ).data;
      }
      await ack({ response_action: "clear" });
      await sendDm(client, userId, {
        text: `Employee updated: ${updated?.name || employeeId}`,
        blocks: buildSuccessBlock(`*${updated?.name || "Employee"}* updated.`),
      });
    } catch (error) {
      console.error("Employee edit error:", error.message);
      await ack({
        response_action: "errors",
        errors: { select_block: error.response?.data?.error || error.message },
      });
    }
  },

  /** /omni-employee list — manager-only roster. */
  async handleEmployeeList({ command, ack, say }) {
    await ack();
    const workspaceId = command.team_id;
    try {
      const manager = await requireManager(command.user_id, workspaceId);
      if (!manager) {
        return say({
          text: "Permission denied",
          blocks: buildErrorBlock("Only Admins and Managers can view the full roster."),
          response_type: "ephemeral",
        });
      }
      const res = await runWithTenant(workspaceId, () => axios.get(`/employees`));
      const employees = res.data || [];
      if (!employees.length) {
        return say({
          text: "No employees",
          blocks: buildSuccessBlock("No employee records yet."),
          response_type: "ephemeral",
        });
      }
      const blocks = [
        {
          type: "header",
          text: { type: "plain_text", text: `👥 Team Roster (${employees.length})`, emoji: true },
        },
        ...employees.slice(0, 15).map((e) => ({
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              `*${e.name}* — ${e.role?.name || "No role"}\n` +
              `${e.email || "No email"} · ${e.externalId ? "🔗 Linked" : "❌ Not linked"}`,
          },
        })),
      ];
      if (employees.length > 15) {
        blocks.push({
          type: "context",
          elements: [{ type: "mrkdwn", text: `Showing 15 of ${employees.length} employees.` }],
        });
      }
      await say({ text: "Team roster", blocks, response_type: "ephemeral" });
    } catch (error) {
      console.error("Employee list error:", error.message);
      await say({
        text: "Error",
        blocks: buildErrorBlock(error.message),
        response_type: "ephemeral",
      });
    }
  },
};
