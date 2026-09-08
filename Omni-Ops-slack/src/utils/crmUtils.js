const STATUS_MAP = {
  NEW: "🆕 New",
  CONTACTED: "📞 Contacted",
  QUALIFIED: "⭐ Qualified",
  CONVERTED: "✅ Converted",
  LOST: "🚫 Not Interested",
};
const SOURCE_MAP = {
  WHATSAPP: "🟢 WhatsApp",
  WEBSITE: "🌐 Website",
  MANUAL: "✍️ Manual",
  PHONE: "📞 Phone",
  WALK_IN: "🚶 Walk-in",
  SOCIAL: "📱 Social",
  IMPORT: "📥 Imported",
};
const STATUS_ICONS = { DRAFT: "📝", RUNNING: "📤", PAUSED: "⏸️", DONE: "✅" };

function formatPhone(phone) {
  if (!phone) return "N/A";
  const match = phone.match(/^(\+\d{1,3})(\d+)$/);
  return match ? `${match[1]} ${match[2]}` : phone;
}

function buildLeadListBlocks(leads, title = "📊 CRM Leads Overview") {
  const blocks = [{ type: "header", text: { type: "plain_text", text: title } }];
  leads.slice(0, 10).forEach((lead) => {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*👤 ${lead.name || "Unknown"}*\n📱 ${formatPhone(lead.phone)}\n${STATUS_MAP[lead.status] || lead.status} · ${SOURCE_MAP[lead.source] || lead.source}`,
      },
    });
  });
  return blocks;
}

function buildLeadInfoBlocks(lead) {
  return [
    { type: "header", text: { type: "plain_text", text: `📇 Lead Profile: ${lead.name}` } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*📱 Phone*\n${formatPhone(lead.phone)}` },
        { type: "mrkdwn", text: `*🚦 Status*\n${STATUS_MAP[lead.status] || lead.status}` },
        { type: "mrkdwn", text: `*🔗 Source*\n${SOURCE_MAP[lead.source] || lead.source}` },
        { type: "mrkdwn", text: `*👤 Assigned*\n${lead.assignedTo?.name || "None"}` },
      ],
    },
    ...(lead.notes
      ? [{ type: "section", text: { type: "mrkdwn", text: `*📝 Notes*\n${lead.notes}` } }]
      : []),
  ];
}

module.exports = {
  STATUS_MAP,
  SOURCE_MAP,
  STATUS_ICONS,
  formatPhone,
  buildLeadListBlocks,
  buildLeadInfoBlocks,
};
