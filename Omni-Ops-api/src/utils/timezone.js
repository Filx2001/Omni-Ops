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

// Builds a real Date from "YYYY-MM-DD" + hour/minute interpreted in a timezone
function zonedDate(dateStr, hours, minutes, timeZone) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hours, minutes, 0));
  const off1 = getTzOffsetMinutes(timeZone, guess);
  const pass1 = new Date(guess.getTime() - off1 * 60000);
  const off2 = getTzOffsetMinutes(timeZone, pass1); // DST safety re-check
  return off1 === off2 ? pass1 : new Date(guess.getTime() - off2 * 60000);
}

// "YYYY-MM-DD" of an instant in a timezone (en-CA formats as YYYY-MM-DD)
function dateStrInTz(date, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// Weekday name ("Monday"...) of an instant in a timezone
function weekdayInTz(date, timeZone) {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(date);
}

module.exports = { getTzOffsetMinutes, zonedDate, dateStrInTz, weekdayInTz };
