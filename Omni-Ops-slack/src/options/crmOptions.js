const axios = require("../utils/axiosInstance");
const { runWithTenant } = require("../utils/tenantContext");

async function handleLeadOptions({ options, ack, body }) {
  const workspaceId = body.team?.id;
  const search = (options.value || "").toLowerCase();
  try {
    const res = await runWithTenant(workspaceId, () => axios.get(`/crm/leads`));
    const filtered = (res.data || [])
      .filter(
        (l) =>
          (l.name && l.name.toLowerCase().includes(search)) || (l.phone && l.phone.includes(search))
      )
      .slice(0, 25);
    await ack({
      options: filtered.map((l) => ({
        text: { type: "plain_text", text: `${l.name} | ${l.phone}`.substring(0, 75) },
        value: l.id,
      })),
    });
  } catch {
    await ack({ options: [] });
  }
}

async function handleTemplateOptions({ options, ack, body }) {
  const workspaceId = body.team?.id;
  const search = (options.value || "").toLowerCase();
  try {
    const res = await runWithTenant(workspaceId, () => axios.get(`/campaigns/templates`));
    const filtered = (res.data || [])
      .filter((t) => t.name.toLowerCase().includes(search))
      .slice(0, 25);
    await ack({
      options: filtered.map((t) => ({
        text: { type: "plain_text", text: `${t.name} (${t.language})`.substring(0, 75) },
        value: `${t.name}|${t.language}`,
      })),
    });
  } catch {
    await ack({ options: [] });
  }
}

async function handleCampaignOptions({ options, ack, body }) {
  const workspaceId = body.team?.id;
  const search = (options.value || "").toLowerCase();
  try {
    const res = await runWithTenant(workspaceId, () => axios.get(`/campaigns/search`));
    const filtered = (res.data || [])
      .filter((c) => c.name.toLowerCase().includes(search))
      .slice(0, 25);
    await ack({
      options: filtered.map((c) => ({
        text: { type: "plain_text", text: c.name.substring(0, 75) },
        value: c.id,
      })),
    });
  } catch {
    await ack({ options: [] });
  }
}

module.exports = { handleLeadOptions, handleTemplateOptions, handleCampaignOptions };
