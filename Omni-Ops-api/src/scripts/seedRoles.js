// Dev/demo helper: creates a demo workspace with the default role set.
// In production, roles are seeded automatically when a workspace is created (POST /workspaces).
// Usage: node src/scripts/seedRoles.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const roles = [
  { name: "Admin", description: "Full system access" },
  { name: "Manager", description: "Manage operations, staff, and campaigns" },
  { name: "Sales", description: "CRM and lead management" },
  { name: "Support", description: "Customer support and inbox" },
  { name: "Marketing", description: "Campaigns and audience management" },
  { name: "Finance", description: "Invoices and billing" },
];

async function main() {
  const workspaceId = process.env.DEMO_WORKSPACE_ID || "demo-workspace";

  const workspace = await prisma.workspace.upsert({
    where: { platform_workspaceId: { platform: "DISCORD", workspaceId } },
    update: {},
    create: { platform: "DISCORD", workspaceId, organizationName: "Omni-Ops Demo" },
  });

  for (const role of DEFAULT_ROLES) {
    await prisma.role.upsert({
      where: { workspaceId_name: { workspaceId: workspace.id, name: role.name } },
      update: {},
      create: { workspaceId: workspace.id, name: role.name, description: role.description },
    });
    console.log(`✅ ${role.name}`);
  }
  console.log(`\n✅ Demo workspace ready: ${workspace.id}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
