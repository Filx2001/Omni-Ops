const prisma = require("../../prisma");
const { encrypt, decrypt } = require("../../utils/crypto");

const DEFAULT_ROLES = [
  { name: "Admin", description: "Full system control" },
  { name: "Manager", description: "Day-to-day operations management" },
  { name: "Agent", description: "Handles customers and tasks" },
  { name: "Sales", description: "CRM and lead follow-up" },
  { name: "Support", description: "Customer support" },
  { name: "Marketing", description: "Campaigns and outreach" },
  { name: "Freelancer", description: "External collaborator" },
];

const UPDATABLE_FIELDS = [
  "organizationName",
  "timezone",
  "currency",
  "reminderChannelId",
  "logChannelId",
  "scheduleChannelId",
  "vacationChannelId",
  "welcomeChannelId",
  "introChannelId",
  "billingChannelId",
  "leadsChannelId",
  "autoRoleId",
];

function serialize(ws) {
  if (!ws) return null;
  const aiApiKey = decrypt(ws.aiApiKey);
  return { ...ws, aiApiKey, hasAiKey: Boolean(aiApiKey) };
}

async function list() {
  const rows = await prisma.workspace.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map(serialize);
}

async function getByExternal(platform, workspaceId) {
  const ws = await prisma.workspace.findUnique({
    where: { platform_workspaceId: { platform, workspaceId } },
    include: { roles: true },
  });
  return serialize(ws);
}

async function create({ platform = "DISCORD", workspaceId, organizationName }) {
  try {
    const ws = await prisma.workspace.create({
      data: {
        platform,
        workspaceId,
        organizationName: organizationName || "My Organization",
        roles: { create: DEFAULT_ROLES },
      },
      include: { roles: true },
    });
    return serialize(ws);
  } catch (err) {
    if (err.code === "P2002") {
      // Idempotent create — return the existing workspace
      return getByExternal(platform, workspaceId);
    }
    throw err;
  }
}

async function updateByExternal(platform, workspaceId, patch) {
  const data = {};
  for (const field of UPDATABLE_FIELDS) {
    if (patch[field] !== undefined) data[field] = patch[field];
  }
  if (patch.aiApiKey !== undefined) {
    data.aiApiKey = patch.aiApiKey ? encrypt(patch.aiApiKey) : null;
  }
  const ws = await prisma.workspace.upsert({
    where: { platform_workspaceId: { platform, workspaceId } },
    update: data,
    create: {
      platform,
      workspaceId,
      organizationName: patch.organizationName || "My Organization",
      ...data,
      roles: { create: DEFAULT_ROLES },
    },
    include: { roles: true },
  });
  return serialize(ws);
}

module.exports = { list, getByExternal, create, updateByExternal };
