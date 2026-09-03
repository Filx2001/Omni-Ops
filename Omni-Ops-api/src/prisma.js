const { PrismaClient } = require("@prisma/client");

const basePrisma = new PrismaClient();

const REMINDER_MODELS = {
  task: { dateField: "dueDate", resetFlags: ["reminderSent", "customReminderSent"] },
  appointment: { dateField: "startTime", resetFlags: ["reminderSent", "customReminderSent"] },
  event: { dateField: "startDate", resetFlags: ["reminderSent"] },
};

function unwrapPrismaValue(value) {
  if (value && typeof value === "object" && "set" in value) return value.set;
  return value;
}

function toIsoSafe(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function applyReminderReset(delegate, config, args) {
  if (!args?.data || !args?.where?.id) return args;
  if (!Object.prototype.hasOwnProperty.call(args.data, config.dateField)) return args;

  const rawNewValue = unwrapPrismaValue(args.data[config.dateField]);
  if (rawNewValue === undefined) return args;

  try {
    const before = await delegate.findUnique({
      where: { id: args.where.id },
      select: { [config.dateField]: true },
    });

    if (toIsoSafe(before?.[config.dateField]) !== toIsoSafe(rawNewValue)) {
      for (const flag of config.resetFlags) {
        args.data[flag] = false;
      }
    }
  } catch (error) {
    console.error("[Reminder Reset Extension]", error.message);
  }

  return args;
}

const prisma = basePrisma.$extends({
  name: "reminderReset",
  query: {
    task: {
      async update({ args, query }) {
        args = await applyReminderReset(basePrisma.task, REMINDER_MODELS.task, args);
        return query(args);
      },
    },
    appointment: {
      async update({ args, query }) {
        args = await applyReminderReset(basePrisma.appointment, REMINDER_MODELS.appointment, args);
        return query(args);
      },
    },
    event: {
      async update({ args, query }) {
        args = await applyReminderReset(basePrisma.event, REMINDER_MODELS.event, args);
        return query(args);
      },
    },
  },
});

module.exports = prisma;
