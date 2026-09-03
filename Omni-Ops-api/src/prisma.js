const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const REMINDER_DATE_FIELDS = {
  Task: "dueDate",
  Appointment: "startTime",
  Event: "startDate",
};

function unwrapPrismaValue(value) {
  if (value && typeof value === "object" && "set" in value) {
    return value.set;
  }

  return value;
}

function toIsoSafe(value) {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

/**
 * Automatically reset reminderSent when a reminder date changes.
 *
 * This avoids manually editing every service file.
 */
prisma.$use(async (params, next) => {
  const dateField = REMINDER_DATE_FIELDS[params.model];

  if (
    dateField &&
    params.action === "update" &&
    params.args?.where?.id &&
    params.args?.data &&
    Object.prototype.hasOwnProperty.call(params.args.data, dateField)
  ) {
    const rawNewValue = unwrapPrismaValue(params.args.data[dateField]);

    if (rawNewValue !== undefined) {
      try {
        const modelName = params.model.charAt(0).toLowerCase() + params.model.slice(1);

        const before = await prisma[modelName].findUnique({
          where: {
            id: params.args.where.id,
          },
          select: {
            [dateField]: true,
          },
        });

        const oldValue = toIsoSafe(before?.[dateField]);
        const newValue = toIsoSafe(rawNewValue);

        if (oldValue !== newValue) {
          params.args.data.reminderSent = false;
        }
      } catch (error) {
        console.error("[Prisma Reminder Reset Middleware]", error.message);
      }
    }
  }

  return next(params);
});

module.exports = prisma;
