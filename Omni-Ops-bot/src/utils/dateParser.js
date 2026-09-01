const { getTenant } = require("./tenantContext");
const { getCachedWorkspaceSync } = require("./workspace");
// ───────────────────────── Timezone validation ─────────────────────────
function isValidTimeZone(tz) {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Never let an invalid timezone crash a parser
function safeTz(timeZone) {
  return isValidTimeZone(timeZone) ? timeZone : resolveTimeZone();
}
// ───────────────────────── Timezone helpers (multi-tenant aware) ─────────────────────────
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
  const guildId = getTenant();
  if (guildId) {
    const ws = getCachedWorkspaceSync(guildId);
    if (isValidTimeZone(ws?.timezone)) return ws.timezone;
  }
  return isValidTimeZone(process.env.DEFAULT_TIMEZONE) ? process.env.DEFAULT_TIMEZONE : "UTC";
}

// Never let an invalid timezone crash a parser
function safeTz(timeZone) {
  return isValidTimeZone(timeZone) ? timeZone : resolveTimeZone();
}

// UTC offset (in minutes) of an IANA timezone at a given instant
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
    return 0; // invalid timezone → UTC
  }
}

// Builds a real Date from wall-clock parts interpreted in a timezone
function zonedDate(dateStr, hours, minutes, timeZone) {
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const guess = new Date(`${dateStr}T${hh}:${mm}:00Z`); // guess: wall time = UTC
  if (isNaN(guess.getTime())) return null;
  const off1 = getTzOffsetMinutes(timeZone, guess);
  const pass1 = new Date(guess.getTime() - off1 * 60000);
  const off2 = getTzOffsetMinutes(timeZone, pass1); // DST safety re-check
  return off1 === off2 ? pass1 : new Date(guess.getTime() - off2 * 60000);
}

// "Today" as YYYY-MM-DD in a timezone, optionally shifted by N days
function todayStringInTz(timeZone, addDays = 0) {
  const tz = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const d = new Date(Date.now() + addDays * 86400000);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d); // en-CA → YYYY-MM-DD
}

// ───────────────────────── Smart day/month extraction ─────────────────────────
// Figures out day & month regardless of order (DD/MM vs MM/DD)
function smartDate(p1, p2, isYearFirst = false) {
  const n1 = parseInt(p1, 10);
  const n2 = parseInt(p2, 10);
  let day, month;
  if (isYearFirst) {
    if (n1 > 12) {
      day = n1;
      month = n2;
    } else {
      month = n1;
      day = n2;
    }
  } else {
    if (n2 > 12) {
      day = n2;
      month = n1;
    } else {
      day = n1;
      month = n2;
    }
  }
  return { day, month };
}

// ───────────────────────── Date + time parser (events/appointments) ─────────────────────────
function parseDate(input, timeZone = null) {
  const tz = safeTz(timeZone);
  if (!input) return null;
  const now = new Date();
  const currentYear = now.getFullYear();
  let dateStr = "";
  let timeStr = "00:00";

  const parts = input.trim().toLowerCase().split(/\s+/);
  const firstPart = parts[0];
  const secondPart = parts[1] || "00:00";

  if (firstPart === "today") {
    dateStr = todayStringInTz(tz);
    timeStr = secondPart;
  } else if (firstPart === "tomorrow") {
    dateStr = todayStringInTz(tz, 1);
    timeStr = secondPart;
  } else if (/^\d{1,2}[-/]\d{1,2}$/.test(firstPart)) {
    const separator = firstPart.includes("/") ? "/" : "-";
    const [p1, p2] = firstPart.split(separator);
    const { day, month } = smartDate(p1, p2, false);
    dateStr = `${currentYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    timeStr = secondPart;
  } else if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(firstPart)) {
    const separator = firstPart.includes("/") ? "/" : "-";
    const [year, p1, p2] = firstPart.split(separator);
    const { day, month } = smartDate(p1, p2, true);
    dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    timeStr = secondPart;
  } else if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(firstPart)) {
    const separator = firstPart.includes("/") ? "/" : "-";
    const [p1, p2, year] = firstPart.split(separator);
    const { day, month } = smartDate(p1, p2, false);
    dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    timeStr = secondPart;
  } else {
    const fallback = new Date(input);
    return isNaN(fallback.getTime()) ? null : fallback;
  }

  if (timeStr.length === 4) timeStr = `0${timeStr}`;
  const [h, m] = timeStr.split(":").map((n) => parseInt(n, 10));
  return zonedDate(dateStr, h || 0, m || 0, tz);
}

// ───────────────────────── Date-only parser (tasks & filters) ─────────────────────────
function parseDate(input, timeZone = null) {
  const tz = safeTz(timeZone);
  if (!input) return null;
  const currentYear = new Date().getFullYear();
  let dateStr = "";
  const lowerInput = input.trim().toLowerCase();

  if (lowerInput === "today") {
    dateStr = todayStringInTz(tz);
  } else if (lowerInput === "tomorrow") {
    dateStr = todayStringInTz(tz, 1);
  } else if (/^\d{1,2}[-/]\d{1,2}$/.test(lowerInput)) {
    const separator = lowerInput.includes("/") ? "/" : "-";
    const [p1, p2] = lowerInput.split(separator);
    const { day, month } = smartDate(p1, p2, false);
    dateStr = `${currentYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  } else if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(lowerInput)) {
    const separator = lowerInput.includes("/") ? "/" : "-";
    const [year, p1, p2] = lowerInput.split(separator);
    const { day, month } = smartDate(p1, p2, true);
    dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  } else if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(lowerInput)) {
    const separator = lowerInput.includes("/") ? "/" : "-";
    const [p1, p2, year] = lowerInput.split(separator);
    const { day, month } = smartDate(p1, p2, false);
    dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  } else {
    return null;
  }

  return zonedDate(dateStr, 0, 0, tz);
}

// ───────────────────────── Wall-clock parser with AM/PM (appointments) ─────────────────────────
// Interprets "2:30 pm" on a given date in the workspace timezone.
function parseLocalDateTime(dateInput, timeInput, timeZone = null) {
  const tz = safeTz(timeZone);
  if (!dateInput) return null;
  const currentYear = new Date().getFullYear();
  let dateStr = "";
  const lowerDate = dateInput.trim().toLowerCase();

  // 1. Resolve the date part
  if (lowerDate === "today") {
    dateStr = todayStringInTz(tz);
  } else if (lowerDate === "tomorrow") {
    dateStr = todayStringInTz(tz, 1);
  } else {
    const separator = lowerDate.includes("/") ? "/" : "-";
    const parts = lowerDate.split(separator);
    if (parts[0].length === 4) {
      // YYYY-MM-DD (model format)
      const year = parts[0];
      const { day, month } = smartDate(parts[1], parts[2], false);
      dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    } else {
      // DD/MM or DD/MM/YYYY (user format)
      const p1 = parts[0];
      const p2 = parts[1];
      const year = parts.length === 3 ? parts[2] : currentYear;
      const { day, month } = smartDate(p1, p2, false);
      dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  // 2. All-day (no time provided)
  if (!timeInput) {
    const date = zonedDate(dateStr, 0, 0, tz);
    return date ? { date, isAllDay: true } : null;
  }

  // 3. AM/PM → 24h
  let timeStr = timeInput.trim().toLowerCase();
  const isPM = timeStr.includes("pm");
  const isAM = timeStr.includes("am");
  let [hours, minutes] = timeStr.replace(/[^\d:]/g, "").split(":");
  hours = parseInt(hours || 0, 10);
  minutes = parseInt(minutes || 0, 10);
  if (isPM && hours < 12) hours += 12;
  if (isAM && hours === 12) hours = 0;

  // 4. Combine date + time in the workspace timezone
  const finalDate = zonedDate(dateStr, hours, minutes, tz);
  return finalDate ? { date: finalDate, isAllDay: false } : null;
}

// Blocks dates far in the past (allows from the 1st of last month, for retroactive entries)
function isValidYear(dateInput) {
  if (!dateInput) return false;
  const inputDate = new Date(dateInput);
  if (isNaN(inputDate.getTime())) return false;
  const now = new Date();
  const earliest = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return inputDate >= earliest;
}

// Parses series day syntax: "1-15" or "1,3,7" + optional month/year: "1-15/8" or "1,3,7/8/2026"
// Returns an array of "d/m/yyyy" strings, or null on invalid syntax
function parseSeriesDates(input) {
  if (!input) return null;
  const clean = input.trim().replace(/\s+/g, "");
  const m = clean.match(/^([\d,-]+)(?:\/(\d{1,2}))?(?:\/(\d{4}))?$/);
  if (!m) return null;

  const now = new Date();
  const month = m[2] ? parseInt(m[2], 10) : now.getMonth() + 1;
  const year = m[3] ? parseInt(m[3], 10) : now.getFullYear();
  if (month < 1 || month > 12) return null;

  let days = [];
  const daysPart = m[1];
  if (/^\d{1,2}-\d{1,2}$/.test(daysPart)) {
    const [a, b] = daysPart.split("-").map(Number);
    if (a < 1 || b < a) return null;
    for (let d = a; d <= b; d++) days.push(d);
  } else if (/^\d{1,2}(,\d{1,2})+$/.test(daysPart)) {
    days = [...new Set(daysPart.split(",").map(Number))].sort((x, y) => x - y);
  } else if (/^\d{1,2}$/.test(daysPart)) {
    days = [parseInt(daysPart, 10)];
  } else {
    return null;
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  if (days.some((d) => d < 1 || d > daysInMonth)) return null;
  return days.map((d) => `${d}/${month}/${year}`);
}

module.exports = {
  parseDateTime,
  parseDate,
  parseLocalDateTime,
  isValidYear,
  parseSeriesDates,
  resolveTimeZone,
  isValidTimeZone,
};
