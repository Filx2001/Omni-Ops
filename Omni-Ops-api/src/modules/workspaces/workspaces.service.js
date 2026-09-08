const prisma = require("../../prisma");
const crypto = require("crypto");

// Derives a 32-byte AES key from SECRET_ENCRYPTION_KEY.
// 64-hex is used as-is; any other format is SHA-256 folded so that
// non-hex or whitespace-padded values can never crash createCipheriv.
function getKey() {
  const raw = String(process.env.SECRET_ENCRYPTION_KEY || "");
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  return crypto.createHash("sha256").update(raw).digest();
}

function encrypt(text) {
  if (!text || !process.env.SECRET_ENCRYPTION_KEY) return text;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", getKey(), iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return `${iv.toString("hex")}:${encrypted}`;
}

// Decrypts sensitive fields (like Slack Bot Tokens)
function decrypt(text) {
  if (!text || !process.env.SECRET_ENCRYPTION_KEY) return text;
  // If it doesn't look like our encrypted format (iv:hex), return as is
  if (typeof text !== "string" || !text.includes(":")) return text;
  const parts = text.split(":");
  if (parts.length !== 2) return text;
  const iv = Buffer.from(parts[0], "hex");
  const encrypted = parts[1];
  try {
    const decipher = crypto.createDecipheriv("aes-256-cbc", getKey(), iv);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err) {
    console.error("Decryption failed:", err.message);
    return text;
  }
}

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

async function list() {
  return prisma.workspace.findMany();
}

async function getByExternal(platform, workspaceId) {
  return prisma.workspace.findUnique({
    where: { platform_workspaceId: { platform, workspaceId } },
  });
}

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
    if (err?.code === "P2002") return getByExternal(platform, workspaceId);
    throw err;
  }
}

async function updateByExternal(platform, workspaceId, data) {
  let ws = await getByExternal(platform, workspaceId);
  if (!ws) ws = await create({ platform, workspaceId });
  const updateData = { ...data };
  if (data.aiApiKey !== undefined) {
    updateData.aiApiKey = data.aiApiKey === null ? null : encrypt(data.aiApiKey);
  }
  if (data.slackBotToken !== undefined) {
    updateData.slackBotToken = data.slackBotToken === null ? null : encrypt(data.slackBotToken);
  }
  return prisma.workspace.update({ where: { id: ws.id }, data: updateData });
}

// Returns the DECRYPTED Slack credentials for the bot to use
async function getSlackCredentials(workspaceId) {
  const ws = await getByExternal("SLACK", workspaceId);
  if (!ws) return null;
  return {
    botToken: decrypt(ws.slackBotToken),
    botUserId: ws.slackBotUserId,
  };
}

const getOrCreateByPlatform = (platform, workspaceId, guildName = null) =>
  create({ platform, workspaceId, organizationName: guildName });

const updateWorkspace = (platform, workspaceId, data) =>
  updateByExternal(platform, workspaceId, data);

module.exports = {
  list,
  getByExternal,
  create,
  updateByExternal,
  getSlackCredentials,
  getOrCreateByPlatform,
  updateWorkspace,
};
