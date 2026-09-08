const axios = require("../utils/axiosInstance");
const { runWithTenant } = require("../utils/tenantContext");
const { buildErrorBlock, buildSuccessBlock } = require("../utils/slackBlocks");
const { sendDm } = require("../utils/slackDm");
const { formatInvoiceBlocks, formatInvoiceListBlocks } = require("../utils/invoiceUtils");
const {
  buildCreateInvoiceModal,
  buildStatusInvoiceModal,
  buildDeleteInvoiceModal,
  buildEmailInvoiceModal,
} = require("../utils/invoiceModals");

const BILLING_ROLES = ["Admin", "Manager", "Sales", "Finance"];

async function checkBillingRole(slackUserId, workspaceId) {
  try {
    const res = await runWithTenant(workspaceId, () =>
      axios.get(`/employees/external/${slackUserId}`)
    );
    return BILLING_ROLES.includes(res.data?.role?.name);
  } catch {
    return false;
  }
}

module.exports = {
  async handleInvoiceCommand({ command, ack, say, client }) {
    await ack();
    const workspaceId = command.team_id;
    const slackUserId = command.user_id;
    const sub = command.text.trim().split(/\s+/)[0]?.toLowerCase();

    try {
      if (sub === "create" || sub === "status" || sub === "delete") {
        if (!(await checkBillingRole(slackUserId, workspaceId))) {
          return say({
            text: "Permission denied",
            blocks: buildErrorBlock(
              "Only Admin, Manager, Sales, or Finance roles can manage invoices."
            ),
            response_type: "ephemeral",
          });
        }
        const modal =
          sub === "create"
            ? buildCreateInvoiceModal()
            : sub === "status"
              ? buildStatusInvoiceModal()
              : buildDeleteInvoiceModal();
        await client.views.open({ trigger_id: command.trigger_id, view: modal });
      } else if (sub === "list") {
        const res = await runWithTenant(workspaceId, () => axios.get(`/invoices`));
        const invoices = res.data.invoices || res.data;
        const total = res.data.totalAmount || invoices.reduce((s, b) => s + b.netAmount, 0);
        if (!invoices.length)
          return say({
            text: "No invoices",
            blocks: buildSuccessBlock("No invoices found."),
            response_type: "ephemeral",
          });
        await say({
          text: "Invoices",
          blocks: formatInvoiceListBlocks(invoices, total),
          response_type: "ephemeral",
        });
      } else {
        await say({
          text: "Usage",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "*Subcommands:*\n• `create` • `list` • `status` • `delete`",
              },
            },
          ],
          response_type: "ephemeral",
        });
      }
    } catch (err) {
      console.error("Invoice command error:", err.message);
      await say({
        text: "Error",
        blocks: buildErrorBlock(err.message),
        response_type: "ephemeral",
      });
    }
  },

  async handleCreateSubmit({ body, view, ack, client }) {
    const workspaceId = body.team?.id;
    const userId = body.user?.id;
    try {
      const v = view.state.values;
      const amount = parseFloat(v.amount_block.amount.value);
      const qty = parseInt(v.qty_block?.qty?.value) || 1;
      const discount = parseInt(v.discount_block?.discount?.selected_option?.value) || 0;
      if (isNaN(amount))
        return ack({ response_action: "errors", errors: { amount_block: "Must be a number." } });

      const creator = await runWithTenant(workspaceId, () =>
        axios.get(`/employees/external/${userId}`)
      );
      const res = await runWithTenant(workspaceId, () =>
        axios.post(`/invoices`, {
          customerName: v.name_block.name.value,
          category: v.category_block.category.selected_option.value,
          amount,
          quantity: qty,
          discount,
          description: v.desc_block?.desc?.value || "",
          createdById: creator.data.id,
          issuedByName: creator.data.name,
        })
      );

      await ack({ response_action: "clear" });
      await sendDm(client, userId, {
        text: "Invoice created",
        blocks: formatInvoiceBlocks(res.data, "create"),
      });
    } catch (err) {
      console.error("Invoice create error:", err.message);
      await ack({
        response_action: "errors",
        errors: { name_block: err.response?.data?.error || err.message },
      });
    }
  },

  async handleStatusSubmit({ body, view, ack, client }) {
    const workspaceId = body.team?.id;
    const userId = body.user?.id;
    try {
      const id = view.state.values.select_block.invoice.selected_option.value;
      const status = view.state.values.status_block.status.selected_option.value;
      const res = await runWithTenant(workspaceId, () =>
        axios.patch(`/invoices/${id}/status`, { status })
      );
      await ack({ response_action: "clear" });
      await sendDm(client, userId, {
        text: "Invoice updated",
        blocks: formatInvoiceBlocks(res.data, "update"),
      });
    } catch (err) {
      console.error("Invoice status error:", err.message);
      await ack({ response_action: "errors", errors: { select_block: err.message } });
    }
  },

  async handleDeleteSubmit({ body, view, ack, client }) {
    const workspaceId = body.team?.id;
    const userId = body.user?.id;
    try {
      const id = view.state.values.select_block.invoice.selected_option.value;
      await runWithTenant(workspaceId, () => axios.delete(`/invoices/${id}`));
      await ack({ response_action: "clear" });
      await sendDm(client, userId, {
        text: "Invoice deleted",
        blocks: buildSuccessBlock("Invoice deleted permanently."),
      });
    } catch (err) {
      console.error("Invoice delete error:", err.message);
      await ack({ response_action: "errors", errors: { select_block: err.message } });
    }
  },

  async handleEmailAction({ body, ack, client }) {
    await ack();
    const invoiceId = body.actions[0].action_id.split(":")[1];
    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildEmailInvoiceModal(invoiceId),
    });
  },

  async handleEmailSubmit({ body, view, ack, client }) {
    const workspaceId = body.team?.id;
    const userId = body.user?.id;
    const invoiceId = view.callback_id.split(":")[1];
    try {
      const email = view.state.values.email_block.email.value;
      await runWithTenant(workspaceId, () => axios.post(`/invoices/${invoiceId}/send`, { email }));
      await ack({ response_action: "clear" });
      await sendDm(client, userId, {
        text: "Email sent",
        blocks: buildSuccessBlock(`Invoice sent to *${email}*.`),
      });
    } catch (err) {
      console.error("Invoice email error:", err.message);
      await ack({
        response_action: "errors",
        errors: { email_block: err.response?.data?.error || err.message },
      });
    }
  },
};
