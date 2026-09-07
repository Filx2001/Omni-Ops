const { getTenant } = require("./tenantContext");
// Note: Ensure getCachedWorkspaceSync is exported from your Slack bot's workspace.js
// just like it is in the Discord bot.
const { getCachedWorkspaceSync } = require("./workspace");

function isValidTimeZone(tz) {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function resolveTimeZone() {
  const workspaceId = getTenant();
  if (workspaceId) {
    const ws = getCachedWorkspaceSync(workspaceId);
    if (isValidTimeZone(ws?.timezone)) return ws.timezone;
  }
  return isValidTimeZone(process.env.DEFAULT_TIMEZONE) ? process.env.DEFAULT_TIMEZONE : "UTC";
}

function safeTz(timeZone) {
  return isValidTimeZone(timeZone) ? timeZone : resolveTimeZone();
}

function getTzOffsetMinutes(timeZone, utcDate) {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts = {};
    for (const p of dtf.formatToParts(utcDate)) parts[p.type] = p.value;
    const asUTC = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      parts.hour === "24" ? 0 : Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    );
    return Math.round((asUTC - utcDate.getTime()) / 60000);
  } catch {
    return 0;
  }
}

function zonedDate(dateStr, hours, minutes, timeZone) {
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const guess = new Date(`${dateStr}T${hh}:${mm}:00Z`);
  if (isNaN(guess.getTime())) return null;
  const off1 = getTzOffsetMinutes(timeZone, guess);
  const pass1 = new Date(guess.getTime() - off1 * 60000);
  const off2 = getTzOffsetMinutes(timeZone, pass1); // DST safety re-check
  return off1 === off2 ? pass1 : new Date(guess.getTime() - off2 * 60000);
}

/**
 * Parses Slack datepicker ("YYYY-MM-DD") and optional timepicker ("HH:MM")
 * into a timezone-aware Date object, matching the API's expected ISO format.
 */
function parseSlackDateTime(dateValue, timeValue = "00:00", timeZone = null) {
  if (!dateValue) return null;
  const tz = safeTz(timeZone);

  const [year, month, day] = dateValue.split("-").map(Number);
  const [hours, minutes] = (timeValue || "00:00").split(":").map(Number);

  return zonedDate(
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    hours,
    minutes,
    tz
  );
}

function isValidYear(dateInput) {
  if (!dateInput) return false;
  const inputDate = new Date(dateInput);
  if (isNaN(inputDate.getTime())) return false;
  const now = new Date();
  const earliest = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return inputDate >= earliest;
}

module.exports = {
  parseSlackDateTime,
  isValidYear,
  resolveTimeZone,
  isValidTimeZone,
};
