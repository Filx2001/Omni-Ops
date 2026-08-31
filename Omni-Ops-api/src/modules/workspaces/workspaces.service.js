const prisma = require("../../prisma");
const crypto = require("crypto");

/* ---------- Crypto helper (unchanged) ---------- */
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

/* ---------- Internal helper ---------- */
async function seedDefaultRoles(workspaceId) {
  const defaultRoles = [
    { name: "Admin", description: "Full system access" },
    { name: "Manager", description: "Manage operations" },
    { name: "Sales", description: "CRM" },
    { name: "Support", description: "Inbox" },
    { name: "Marketing", description: "Campaigns" },
    { name: "Finance", description: "Billing" },
  ];
  for (const role of defaultRoles) {
    await prisma.role.create({ data: { workspaceId, ...role } }).catch(() => {});
  }
}

/* ---------- NEW contract (used by workspaces.routes.js) ---------- */

// GET /workspaces — list all (bot cron engines)
async function list() {
  return prisma.workspace.findMany();
}

// GET /workspaces/:platform/:workspaceId — null if not found (bot onboarding relies on 404)
async function getByExternal(platform, workspaceId) {
  return prisma.workspace.findUnique({
    where: { platform_workspaceId: { platform, workspaceId } },
  });
}

// POST /workspaces — idempotent create + seed default roles
async function create({ platform = "DISCORD", workspaceId, organizationName }) {
  const existing = await getByExternal(platform, workspaceId);
  if (existing) return existing;

  try {
    const ws = await prisma.workspace.create({
      data: {
        platform,
        workspaceId,
        organizationName: organizationName || "Omni-Ops Workspace",
        timezone: "UTC",
        currency: "USD",
      },
    });
    await seedDefaultRoles(ws.id);
    return ws;
  } catch (err) {
    // Race condition: another request created it first (unique constraint)
    if (err?.code === "P2002") return getByExternal(platform, workspaceId);
    throw err;
  }
}

// PATCH /workspaces/discord/:workspaceId — upsert + encrypt secrets
async function updateByExternal(platform, workspaceId, data) {
  let ws = await getByExternal(platform, workspaceId);
  if (!ws) ws = await create({ platform, workspaceId });

  const updateData = { ...data };
  if (data.aiApiKey !== undefined) {
    updateData.aiApiKey = data.aiApiKey === null ? null : encrypt(data.aiApiKey);
  }
  return prisma.workspace.update({ where: { id: ws.id }, data: updateData });
}

/* ---------- Legacy aliases (so other modules/middleware keep working) ---------- */
const getOrCreateByPlatform = (platform, workspaceId, guildName = null) =>
  create({ platform, workspaceId, organizationName: guildName });

const updateWorkspace = (platform, workspaceId, data) =>
  updateByExternal(platform, workspaceId, data);

module.exports = {
  list,
  getByExternal,
  create,
  updateByExternal,
  getOrCreateByPlatform,
  updateWorkspace,
};
