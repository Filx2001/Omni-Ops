const axios = require("../utils/axiosInstance");
const { runWithTenant } = require("../utils/tenantContext");
const { sendDm } = require("../utils/slackDm");
const { buildErrorBlock, buildSuccessBlock } = require("../utils/slackBlocks");
const {
  buildLeadAddModal,
  buildLeadMultiModal,
  buildLeadFilterModal,
  buildLeadSelectModal,
} = require("../utils/crmModals");
const { buildLeadListBlocks, buildLeadInfoBlocks } = require("../utils/crmUtils");

const ALLOWED_ROLES = ["Admin", "Manager", "Sales", "Support", "Marketing"];
const MGMT_ONLY = ["delete", "edit"];

async function checkRole(slackUserId, workspaceId, subcommand) {
  try {
    const res = await runWithTenant(workspaceId, () =>
      axios.get(`/employees/external/${slackUserId}`)
    );
    const role = res.data?.role?.name;
    if (!ALLOWED_ROLES.includes(role))
      return {
        allowed: false,
        msg: "Unauthorized. Access restricted to Sales, Support, Marketing, and Management.",
      };
    if (MGMT_ONLY.includes(subcommand) && !["Admin", "Manager"].includes(role))
      return { allowed: false, msg: "Only Management can delete or edit lead records." };
    return { allowed: true, employee: res.data };
  } catch {
    return { allowed: false, msg: "Your account is not linked to an employee profile." };
  }
}

module.exports = {
  async handleLeadCommand({ command, ack, say, client }) {
    await ack();
    const workspaceId = command.team_id;
    const sub = command.text.trim().split(/\s+/)[0]?.toLowerCase();

    const auth = await checkRole(command.user_id, workspaceId, sub);
    if (!auth.allowed)
      return say({ text: "Error", blocks: buildErrorBlock(auth.msg), response_type: "ephemeral" });

    try {
      if (sub === "list") {
        const search = command.text.trim().split(/\s+/).slice(1).join(" ");
        const res = await runWithTenant(workspaceId, () => axios.get(`/crm/leads`));
        let leads = res.data || [];
        if (search)
          leads = leads.filter(
            (l) =>
              (l.name && l.name.toLowerCase().includes(search.toLowerCase())) ||
              (l.phone && l.phone.includes(search))
          );
        if (!leads.length)
          return say({
            text: "No leads",
            blocks: buildSuccessBlock("No leads found."),
            response_type: "ephemeral",
          });
        await say({
          text: "Leads",
          blocks: buildLeadListBlocks(leads),
          response_type: "ephemeral",
        });
      } else if (sub === "stats") {
        const res = await runWithTenant(workspaceId, () => axios.get(`/crm/leads/stats`));
        const s = res.data.byStatus;
        await say({
          text: "Stats",
          blocks: [
            { type: "header", text: { type: "plain_text", text: "📊 CRM Performance" } },
            {
              type: "section",
              fields: [
                { type: "mrkdwn", text: `*🆕 New*\n${s.NEW}` },
                { type: "mrkdwn", text: `*📞 Contacted*\n${s.CONTACTED}` },
                { type: "mrkdwn", text: `*⭐ Qualified*\n${s.QUALIFIED}` },
                { type: "mrkdwn", text: `*✅ Converted*\n${s.CONVERTED}` },
                { type: "mrkdwn", text: `*🚫 Lost*\n${s.LOST}` },
                { type: "mrkdwn", text: `*Total*\n${res.data.total}` },
              ],
            },
          ],
          response_type: "ephemeral",
        });
      } else if (sub === "add") {
        await client.views.open({ trigger_id: command.trigger_id, view: buildLeadAddModal() });
      } else if (sub === "multi-add") {
        await client.views.open({ trigger_id: command.trigger_id, view: buildLeadMultiModal() });
      } else if (sub === "filter") {
        await client.views.open({ trigger_id: command.trigger_id, view: buildLeadFilterModal() });
      } else if (sub === "info") {
        await client.views.open({
          trigger_id: command.trigger_id,
          view: buildLeadSelectModal("lead_info_modal", "Lead Info"),
        });
      } else if (sub === "assign") {
        await client.views.open({
          trigger_id: command.trigger_id,
          view: buildLeadSelectModal("lead_assign_modal", "Assign Lead", [
            {
              type: "input",
              block_id: "emp_block",
              element: { type: "external_select", action_id: "emp", min_query_length: 1 },
              label: { type: "plain_text", text: "Assign To" },
            },
          ]),
        });
      } else if (sub === "status") {
        await client.views.open({
          trigger_id: command.trigger_id,
          view: buildLeadSelectModal("lead_status_modal", "Update Status", [
            {
              type: "input",
              block_id: "status_block",
              element: {
                type: "static_select",
                action_id: "status",
                options: require("../utils/crmModals").STATUS_OPTIONS,
              },
              label: { type: "plain_text", text: "New Status" },
            },
          ]),
        });
      } else if (sub === "note") {
        await client.views.open({
          trigger_id: command.trigger_id,
          view: buildLeadSelectModal("lead_note_modal", "Add Note", [
            {
              type: "input",
              block_id: "note_block",
              element: { type: "plain_text_input", action_id: "note", multiline: true },
              label: { type: "plain_text", text: "Note Content" },
            },
          ]),
        });
      } else if (sub === "edit") {
        await client.views.open({
          trigger_id: command.trigger_id,
          view: buildLeadSelectModal("lead_edit_modal", "Edit Lead", [
            {
              type: "input",
              block_id: "name_block",
              optional: true,
              element: { type: "plain_text_input", action_id: "name" },
              label: { type: "plain_text", text: "New Name" },
            },
            {
              type: "input",
              block_id: "phone_block",
              optional: true,
              element: { type: "plain_text_input", action_id: "phone" },
              label: { type: "plain_text", text: "New Phone" },
            },
          ]),
        });
      } else if (sub === "delete") {
        await client.views.open({
          trigger_id: command.trigger_id,
          view: buildLeadSelectModal("lead_delete_modal", "Delete Lead"),
        });
      } else {
        await say({
          text: "Usage",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "*Subcommands:*\n• `list` • `stats` • `add` • `multi-add`\n• `info` • `assign` • `status` • `note`\n• `edit` • `delete` • `filter`",
              },
            },
          ],
          response_type: "ephemeral",
        });
      }
    } catch (err) {
      console.error("Lead command error:", err.message);
      await say({
        text: "Error",
        blocks: buildErrorBlock(err.message),
        response_type: "ephemeral",
      });
    }
  },

  async handleLeadViewSubmit({ body, view, ack, client }) {
    const workspaceId = body.team?.id;
    const userId = body.user?.id;
    const cb = view.callback_id;
    try {
      const v = view.state.values;
      if (cb === "lead_add_modal") {
        const res = await runWithTenant(workspaceId, () =>
          axios.post(`/crm/leads`, {
            phone: v.phone_block.phone.value,
            name: v.name_block?.name?.value,
            source: v.source_block?.source?.selected_option?.value || "MANUAL",
            notes: v.notes_block?.notes?.value,
          })
        );
        await ack({ response_action: "clear" });
        await sendDm(client, userId, { text: "Lead added", blocks: buildLeadInfoBlocks(res.data) });
      } else if (cb === "lead_multi_modal") {
        const res = await runWithTenant(workspaceId, () =>
          axios.post(`/crm/leads/bulk`, {
            input: v.phones_block.phones.value,
            source: v.source_block.source.selected_option.value,
            notes: v.notes_block?.notes?.value,
          })
        );
        await ack({ response_action: "clear" });
        await sendDm(client, userId, {
          text: "Bulk add complete",
          blocks: buildSuccessBlock(
            `Added *${res.data.addedCount}* leads. Duplicates: ${res.data.duplicateCount}, Invalid: ${res.data.invalidCount}`
          ),
        });
      } else if (cb === "lead_filter_modal") {
        const res = await runWithTenant(workspaceId, () =>
          axios.get(`/crm/leads/filter`, {
            params: { startDate: v.start_block.start.value, endDate: v.end_block.end.value },
          })
        );
        await ack({ response_action: "clear" });
        await sendDm(client, userId, {
          text: "Filtered leads",
          blocks: buildLeadListBlocks(res.data, "📅 Filtered Leads"),
        });
      } else if (cb === "lead_info_modal") {
        const leadId = v.lead_block.lead_select.selected_option.value;
        const res = await runWithTenant(workspaceId, () => axios.get(`/crm/leads`));
        const lead = res.data.find((l) => l.id === leadId);
        await ack({ response_action: "clear" });
        await sendDm(client, userId, { text: "Lead info", blocks: buildLeadInfoBlocks(lead) });
      } else if (cb === "lead_assign_modal") {
        const leadId = v.lead_block.lead_select.selected_option.value;
        const empId = v.emp_block.emp.selected_option.value;
        const res = await runWithTenant(workspaceId, () =>
          axios.patch(`/crm/leads/${leadId}/assign`, { employeeId: empId })
        );
        await ack({ response_action: "clear" });
        await sendDm(client, userId, {
          text: "Assigned",
          blocks: buildSuccessBlock(`Assigned to *${res.data.assignedTo?.name}*`),
        });
      } else if (cb === "lead_status_modal") {
        const leadId = v.lead_block.lead_select.selected_option.value;
        const status = v.status_block.status.selected_option.value;
        await runWithTenant(workspaceId, () =>
          axios.patch(`/crm/leads/${leadId}/status`, { status })
        );
        await ack({ response_action: "clear" });
        await sendDm(client, userId, {
          text: "Status updated",
          blocks: buildSuccessBlock(`Status updated to *${status}*`),
        });
      } else if (cb === "lead_note_modal") {
        const leadId = v.lead_block.lead_select.selected_option.value;
        const note = v.note_block.note.value;
        await runWithTenant(workspaceId, () => axios.patch(`/crm/leads/${leadId}/note`, { note }));
        await ack({ response_action: "clear" });
        await sendDm(client, userId, {
          text: "Note added",
          blocks: buildSuccessBlock("Note added successfully."),
        });
      } else if (cb === "lead_edit_modal") {
        const leadId = v.lead_block.lead_select.selected_option.value;
        const payload = {};
        if (v.name_block?.name?.value) payload.name = v.name_block.name.value;
        if (v.phone_block?.phone?.value) payload.phone = v.phone_block.phone.value;
        if (!Object.keys(payload).length)
          return ack({
            response_action: "errors",
            errors: { name_block: "Provide at least one field." },
          });
        await runWithTenant(workspaceId, () => axios.patch(`/crm/leads/${leadId}/edit`, payload));
        await ack({ response_action: "clear" });
        await sendDm(client, userId, {
          text: "Lead edited",
          blocks: buildSuccessBlock("Lead updated."),
        });
      } else if (cb === "lead_delete_modal") {
        const leadId = v.lead_block.lead_select.selected_option.value;
        await runWithTenant(workspaceId, () => axios.delete(`/crm/leads/${leadId}`));
        await ack({ response_action: "clear" });
        await sendDm(client, userId, {
          text: "Lead deleted",
          blocks: buildSuccessBlock("Lead deleted permanently."),
        });
      }
    } catch (err) {
      console.error("Lead modal error:", err.message);
      await ack({
        response_action: "errors",
        errors: { lead_block: err.response?.data?.error || err.message },
      });
    }
  },
};
