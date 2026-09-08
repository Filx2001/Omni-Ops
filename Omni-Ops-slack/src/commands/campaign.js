const axios = require("../utils/axiosInstance");
const { runWithTenant } = require("../utils/tenantContext");
const { sendDm } = require("../utils/slackDm");
const { buildErrorBlock, buildSuccessBlock } = require("../utils/slackBlocks");
const { buildCampaignNewModal } = require("../utils/crmModals");
const { STATUS_ICONS } = require("../utils/crmUtils");

module.exports = {
  async handleCampaignCommand({ command, ack, say, client }) {
    await ack();
    const workspaceId = command.team_id;
    const sub = command.text.trim().split(/\s+/)[0]?.toLowerCase();

    try {
      const me = await runWithTenant(workspaceId, () =>
        axios.get(`/employees/external/${command.user_id}`)
      );
      if (!["Admin", "Manager"].includes(me.data?.role?.name)) {
        return say({
          text: "Error",
          blocks: buildErrorBlock("Management only. Campaigns are restricted."),
          response_type: "ephemeral",
        });
      }

      if (sub === "audience") {
        const res = await runWithTenant(workspaceId, () => axios.get(`/campaigns/audience`));
        const d = res.data;
        await say({
          text: "Audience",
          blocks: [
            { type: "header", text: { type: "plain_text", text: "👥 Contact Base" } },
            {
              type: "section",
              fields: [
                { type: "mrkdwn", text: `*Reachable*\n${d.reachable} / ${d.total}` },
                { type: "mrkdwn", text: `*Opted Out*\n${d.optedOut}` },
                { type: "mrkdwn", text: `*Added 7d*\n${d.added.d7}` },
                { type: "mrkdwn", text: `*Active 30d*\n${d.activity.d30}` },
              ],
            },
          ],
          response_type: "ephemeral",
        });
      } else if (sub === "list") {
        const res = await runWithTenant(workspaceId, () => axios.get(`/campaigns?limit=10`));
        if (!res.data.length)
          return say({
            text: "No campaigns",
            blocks: buildSuccessBlock("No campaigns yet."),
            response_type: "ephemeral",
          });
        const blocks = [
          { type: "header", text: { type: "plain_text", text: "📋 Campaign History" } },
        ];
        res.data.forEach((c) => {
          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `${STATUS_ICONS[c.status]} *${c.name}*\nSent ${c.sent}/${c.total} · Replies ${c.replies}`,
            },
          });
        });
        await say({ text: "Campaigns", blocks, response_type: "ephemeral" });
      } else if (sub === "new") {
        await client.views.open({ trigger_id: command.trigger_id, view: buildCampaignNewModal() });
      } else if (["send", "stop", "status", "info", "recipients"].includes(sub)) {
        await client.views.open({
          trigger_id: command.trigger_id,
          view: {
            type: "modal",
            callback_id: `campaign_${sub}_modal`,
            title: { type: "plain_text", text: sub.charAt(0).toUpperCase() + sub.slice(1) },
            submit: { type: "plain_text", text: "Submit" },
            close: { type: "plain_text", text: "Cancel" },
            blocks: [
              {
                type: "input",
                block_id: "camp_block",
                element: { type: "external_select", action_id: "camp", min_query_length: 1 },
                label: { type: "plain_text", text: "Select Campaign" },
              },
            ],
          },
        });
      } else {
        await say({
          text: "Usage",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "*Subcommands:*\n• `audience` • `new` • `list`\n• `send` • `stop` • `status`\n• `info` • `recipients`",
              },
            },
          ],
          response_type: "ephemeral",
        });
      }
    } catch (err) {
      console.error("Campaign command error:", err.message);
      await say({
        text: "Error",
        blocks: buildErrorBlock(err.message),
        response_type: "ephemeral",
      });
    }
  },

  async handleCampaignViewSubmit({ body, view, ack, client }) {
    const workspaceId = body.team?.id;
    const userId = body.user?.id;
    const cb = view.callback_id;
    try {
      const v = view.state.values;
      if (cb === "campaign_new_modal") {
        const [templateName, templateLanguage] =
          v.template_block.template.selected_option.value.split("|");
        const payload = {
          name: v.name_block.name.value,
          templateName,
          templateLanguage,
          variables: v.vars_block?.vars?.value
            ? v.vars_block.vars.value.split(",").map((s) => s.trim())
            : [],
          audienceSource: v.source_block?.source?.selected_option?.value || null,
          audienceStatus: v.status_block?.status?.selected_option?.value || null,
          cooldownDays: parseInt(v.cooldown_block?.cooldown?.value) || 14,
        };
        const res = await runWithTenant(workspaceId, () => axios.post(`/campaigns`, payload));
        await ack({ response_action: "clear" });
        await sendDm(client, userId, {
          text: "Campaign created",
          blocks: buildSuccessBlock(
            `Draft *${res.data.campaign.name}* created with ${res.data.eligible} recipients.\nUse \`/omni-campaign send\` to start.`
          ),
        });
      } else if (cb.startsWith("campaign_")) {
        const action = cb.replace("campaign_", "").replace("_modal", "");
        const campId = v.camp_block.camp.selected_option.value;

        if (action === "send" || action === "stop") {
          await runWithTenant(workspaceId, () =>
            axios.post(`/campaigns/${campId}/${action === "send" ? "start" : "stop"}`)
          );
          await ack({ response_action: "clear" });
          await sendDm(client, userId, {
            text: "Campaign updated",
            blocks: buildSuccessBlock(`Campaign ${action} executed.`),
          });
        } else {
          const res = await runWithTenant(workspaceId, () =>
            axios.get(
              `/campaigns/${campId}${action === "recipients" ? "/recipients" : action === "status" ? "/progress" : ""}`
            )
          );
          await ack({ response_action: "clear" });
          await sendDm(client, userId, {
            text: "Campaign info",
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `\`\`\`${JSON.stringify(res.data, null, 2).slice(0, 2800)}\`\`\``,
                },
              },
            ],
          });
        }
      }
    } catch (err) {
      console.error("Campaign modal error:", err.message);
      await ack({
        response_action: "errors",
        errors: { name_block: err.response?.data?.error || err.message },
      });
    }
  },
};
