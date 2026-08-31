const prisma = require("../../prisma");
const crypto = require("crypto");

function encrypt(text) {
  if (!text || !process.env.SECRET_ENCRYPTION_KEY) return text;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(process.env.SECRET_ENCRYPTION_KEY, "hex"),
    iv
  );
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return `${iv.toString("hex")}:${encrypted}`;
}

async function getOrCreateByPlatform(platform, workspaceId, guildName = null) {
  let ws = await prisma.workspace.findUnique({
    where: { platform_workspaceId: { platform, workspaceId } },
  });
  if (!ws) {
    ws = await prisma.workspace.create({
      data: {
        platform,
        workspaceId,
        organizationName: guildName || "Omni-Ops Workspace",
        timezone: "UTC",
        currency: "USD",
      },
    });
    // Auto-seed default roles for the new tenant
    const defaultRoles = [
      { name: "Admin", description: "Full system access" },
      { name: "Manager", description: "Manage operations" },
      { name: "Sales", description: "CRM" },
      { name: "Support", description: "Inbox" },
      { name: "Marketing", description: "Campaigns" },
      { name: "Finance", description: "Billing" },
    ];
    for (const role of defaultRoles) {
      await prisma.role.create({ data: { workspaceId: ws.id, ...role } }).catch(() => {});
    }
  }
  return ws;
}

async function updateWorkspace(platform, workspaceId, data) {
  const ws = await getOrCreateByPlatform(platform, workspaceId);
  const updateData = { ...data };
  if (data.aiApiKey !== undefined) {
    updateData.aiApiKey = data.aiApiKey === null ? null : encrypt(data.aiApiKey);
  }
  return prisma.workspace.update({ where: { id: ws.id }, data: updateData });
}

module.exports = { getOrCreateByPlatform, updateWorkspace };
