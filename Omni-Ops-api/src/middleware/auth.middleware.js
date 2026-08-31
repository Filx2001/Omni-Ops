const prisma = require("../prisma");

// Routes that don't need the internal API key (public / webhooks / self-verifying)
const KEY_EXEMPT = [
  { method: "GET", pattern: /^\/invoices\/[^/]+\/pdf$/ }, // PDF links verify their own signature
];

function requireApiKey(req, res, next) {
  if (req.path === "/health") return next();
  if (KEY_EXEMPT.some((r) => r.method === req.method && r.pattern.test(req.path))) return next();
  const apiKey = req.headers["x-api-key"];
  if (!apiKey || apiKey !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// Routes allowed without an X-Workspace-Id header
const WORKSPACE_EXEMPT = [
  { method: "GET", pattern: /^\/employees\/external\/[^/]+$/ }, // identity lookup (pre-tenant)
  { method: "GET", pattern: /^\/invoices\/[^/]+\/pdf$/ },
];

// Attaches req.workspace from the X-Workspace-Id header (accepts internal id or guild/team id)
async function requireWorkspace(req, res, next) {
  if (WORKSPACE_EXEMPT.some((r) => r.method === req.method && r.pattern.test(req.path))) {
    return next();
  }
  const header = req.headers["x-workspace-id"];
  if (!header) {
    return res.status(400).json({ error: "X-Workspace-Id header is required" });
  }
  try {
    const workspace = await prisma.workspace.findFirst({
      where: { OR: [{ id: header }, { workspaceId: header }] },
    });
    if (!workspace) return res.status(404).json({ error: "Workspace not found" });
    req.workspace = workspace;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireApiKey, requireWorkspace };
