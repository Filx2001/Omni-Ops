const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  const roles = [
    {
      name: "Director",
      description: "Full system access",
    },
    {
      name: "Operations Manager",
      description: "Manage operations and tasks",
    },
    {
      name: "Teacher",
      description: "Teaching staff",
    },
    {
      name: "Sales",
      description: "Sales team",
    },
    {
      name: "Support",
      description: "Support team",
    },
    {
      name: "Marketing",
      description: "Marketing team",
    },
    {
      name: "Freelancer",
      description: "Freelancer",
    },
  ];

  for (const role of roles) {
    await prisma.role.upsert({
      where: {
        name: role.name,
      },
      update: {},
      create: role,
    });

    console.log(`✅ ${role.name}`);
  }
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
