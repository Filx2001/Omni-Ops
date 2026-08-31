const prisma = require("../prisma");

// Resolves the workspace that owns inbound WhatsApp traffic:
// 1. DEFAULT_WORKSPACE_ID env (explicit)
// 2. First workspace with a leads channel configured
// 3. The only workspace (typical self-hosted case)
// 4. First workspace by creation date
// 5. Auto-create a default workspace so messages are never dropped
async function resolveLeadWorkspace() {
  if (process.env.DEFAULT_WORKSPACE_ID) {
    const ws = await prisma.workspace.findUnique({
      where: { id: process.env.DEFAULT_WORKSPACE_ID },
    });
    if (ws) return ws;
  }

  const withLeadsChannel = await prisma.workspace.findFirst({
    where: { NOT: { leadsChannelId: null } },
    orderBy: { createdAt: "asc" },
  });
  if (withLeadsChannel) return withLeadsChannel;

  const count = await prisma.workspace.count();
  const first = await prisma.workspace.findFirst({ orderBy: { createdAt: "asc" } });
  if (count === 1 && first) return first;
  if (first) return first;

  // No workspace yet (bot not linked anywhere) — create a data sink
  const { create } = require("./workspaces.service");
  return create({
    platform: "DISCORD",
    workspaceId: "default",
    organizationName: "Default Workspace",
  });
}

module.exports = { resolveLeadWorkspace };
