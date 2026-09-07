/**
 * /omni-appointment command: add, list, edit, delete via modals.
 */

const axios = require("../utils/axiosInstance");
const { runWithTenant } = require("../utils/tenantContext");
const { checkIsManager } = require("../utils/slackPermissions");
const { parseSlackDateTime, isValidYear, resolveTimeZone } = require("../utils/slackDates");
const { sendDm } = require("../utils/slackDm");
const { buildErrorBlock, buildSuccessBlock } = require("../utils/slackBlocks");
const {
  appointmentLabel,
  checkSmartOverlap,
  buildAppointmentBlock,
  buildAppointmentListBlocks,
} = require("../utils/calendarUtils");
const {
  buildAppointmentModal,
  buildAppointmentEditModal,
  buildAppointmentDeleteModal,
} = require("../utils/calendarModals");

/** Wall-clock HH:MM of an instant in the given timezone. */
function wallTimeInTz(dateValue, tz) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(dateValue));
}

/** Validates timed appointments and returns an error string or null. */
function validateTimed(start, end, existing, excludeId) {
  if (end <= start) return "The end time must be after the start time.";
  const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
  if (hours > 24) return "A single timed appointment cannot exceed 24 hours.";
  const conflict = existing.some(
    (a) =>
      a.id !== excludeId && !a.isAllDay && checkSmartOverlap(start, end, a.startTime, a.endTime)
  );
  if (conflict) return "The assignee already has an overlapping appointment at that time.";
  return null;
}

module.exports = {
  /** Routes /omni-appointment <subcommand>. */
  async handleAppointmentCommand({ command, ack, say, client }) {
    await ack();

    const workspaceId = command.team_id;
    const slackUserId = command.user_id;
    const subcommand = command.text.trim().split(/\s+/)[0]?.toLowerCase();

    try {
      if (subcommand === "add" || subcommand === "edit" || subcommand === "delete") {
        const { isManager } = await checkIsManager(slackUserId, workspaceId);
        if (!isManager) {
          return say({
            text: "Permission denied",
            blocks: buildErrorBlock("Only Managers and Admins can manage appointments."),
            response_type: "ephemeral",
          });
        }

        const view =
          subcommand === "add"
            ? buildAppointmentModal()
            : subcommand === "edit"
              ? buildAppointmentEditModal()
              : buildAppointmentDeleteModal();

        await client.views.open({ trigger_id: command.trigger_id, view });
      } else if (subcommand === "list") {
        const response = await runWithTenant(workspaceId, () =>
          axios.get(`/calendar/appointments`)
        );
        const upcoming = (response.data || [])
          .filter((a) => new Date(a.endTime) > new Date())
          .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

        if (!upcoming.length) {
          return say({
            text: "No upcoming appointments",
            blocks: buildSuccessBlock("No upcoming appointments scheduled."),
            response_type: "ephemeral",
          });
        }

        await say({
          text: "Upcoming appointments",
          blocks: buildAppointmentListBlocks(upcoming),
          response_type: "ephemeral",
        });
      } else {
        await say({
          text: "Unknown subcommand",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text:
                  "*Available subcommands:*\n" +
                  "• `/omni-appointment add` — Schedule via form\n" +
                  "• `/omni-appointment list` — Upcoming schedule\n" +
                  "• `/omni-appointment edit` — Edit via form\n" +
                  "• `/omni-appointment delete` — Delete via picker",
              },
            },
          ],
          response_type: "ephemeral",
        });
      }
    } catch (error) {
      console.error("Appointment command error:", error.message);
      await say({
        text: "Error",
        blocks: buildErrorBlock(
          `Operation failed: ${error.response?.data?.error || error.message}`
        ),
        response_type: "ephemeral",
      });
    }
  },

  /** Handles appointment_create_modal submission. */
  async handleAppointmentCreateSubmit({ body, view, ack, client }) {
    const workspaceId = body.team?.id || view.team_id;
    const userId = body.user?.id;

    try {
      if (view.callback_id !== "appointment_create_modal") return ack();

      const values = view.state.values;
      const title = values.title_block?.title?.value || null;
      const assigneeId = values.assignee_block?.employee?.selected_option?.value;
      const date = values.date_block?.date?.selected_date;
      const start = values.start_block?.start_time?.selected_time;
      const end = values.end_block?.end_time?.selected_time;
      const location = values.location_block?.location?.value || null;

      const errors = {};
      if (!assigneeId) errors.assignee_block = "Assignee is required";
      if (!date) errors.date_block = "Date is required";
      if (start && !end) errors.end_block = "End time is required when a start time is set";
      if (Object.keys(errors).length) return ack({ response_action: "errors", errors });

      const isAllDay = !start;
      const startTime = parseSlackDateTime(date, start || "00:00");
      const endTime = isAllDay ? startTime : parseSlackDateTime(date, end);

      if (!startTime || !isValidYear(startTime)) {
        return ack({
          response_action: "errors",
          errors: { date_block: "Invalid date. Pick a date in the current year or later." },
        });
      }

      let existing = [];
      if (!isAllDay) {
        const problem = await (async () => {
          const listRes = await runWithTenant(workspaceId, () =>
            axios.get(`/calendar/appointments`)
          );
          existing = (listRes.data || []).filter((a) => a.assigneeId === assigneeId);
          return validateTimed(startTime, endTime, existing, null);
        })();
        if (problem) {
          return ack({ response_action: "errors", errors: { date_block: problem } });
        }
      }

      const creator = await runWithTenant(workspaceId, () =>
        axios.get(`/employees/external/${userId}`)
      ).catch(() => null);
      if (!creator) {
        return ack({
          response_action: "errors",
          errors: { title_block: "You are not registered. Run /omni-employee register first." },
        });
      }

      const response = await runWithTenant(workspaceId, () =>
        axios.post(`/calendar/appointments`, {
          title,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          isAllDay,
          assigneeId,
          location,
          createdById: creator.data.id,
        })
      );

      await ack({ response_action: "clear" });
      await sendDm(client, userId, {
        text: `Appointment scheduled: ${appointmentLabel(response.data)}`,
        blocks: buildAppointmentBlock(response.data, "create"),
      });
    } catch (error) {
      console.error("Appointment create error:", error.message);
      await ack({
        response_action: "errors",
        errors: { title_block: `API error: ${error.response?.data?.error || error.message}` },
      });
    }
  },

  /** Handles appointment_edit_modal submission. Empty fields keep current values. */
  async handleAppointmentEditSubmit({ body, view, ack, client }) {
    const workspaceId = body.team?.id || view.team_id;
    const userId = body.user?.id;

    try {
      if (view.callback_id !== "appointment_edit_modal") return ack();

      const values = view.state.values;
      const appointmentId = values.select_block?.appointment_select?.selected_option?.value;
      const title = values.title_block?.title?.value;
      const date = values.date_block?.date?.selected_date;
      const start = values.start_block?.start_time?.selected_time;
      const end = values.end_block?.end_time?.selected_time;
      const assigneeId = values.assignee_block?.employee?.selected_option?.value;
      const location = values.location_block?.location?.value;

      if (!appointmentId) {
        return ack({
          response_action: "errors",
          errors: { select_block: "Select an appointment to edit." },
        });
      }

      const listRes = await runWithTenant(workspaceId, () => axios.get(`/calendar/appointments`));
      const existing = (listRes.data || []).find((a) => a.id === appointmentId);
      if (!existing) {
        return ack({
          response_action: "errors",
          errors: { select_block: "Appointment not found." },
        });
      }

      const updateData = {};
      if (title) updateData.title = title;
      if (location) updateData.location = location;
      if (assigneeId) updateData.assigneeId = assigneeId;

      const errors = {};
      if (start || end) {
        if (!date) {
          errors.date_block = "Pick a date when changing times.";
        } else if (start && !end) {
          errors.end_block = "End time is required when a start time is set.";
        }
      }
      if (Object.keys(errors).length) return ack({ response_action: "errors", errors });

      if (date) {
        const tz = resolveTimeZone();
        let startStr = start;
        let endStr = end;
        // Date-only change keeps the existing wall-clock times
        if (!startStr && !endStr && !existing.isAllDay) {
          startStr = wallTimeInTz(existing.startTime, tz);
          endStr = wallTimeInTz(existing.endTime, tz);
        }
        const isAllDay = !startStr;
        const startTime = parseSlackDateTime(date, startStr || "00:00");
        const endTime = isAllDay ? startTime : parseSlackDateTime(date, endStr || startStr);

        if (!startTime || !isValidYear(startTime)) {
          return ack({
            response_action: "errors",
            errors: { date_block: "Invalid date. Pick a date in the current year or later." },
          });
        }

        if (!isAllDay) {
          const problem = validateTimed(
            startTime,
            endTime,
            (listRes.data || []).filter(
              (a) => a.assigneeId === (assigneeId || existing.assigneeId)
            ),
            appointmentId
          );
          if (problem) {
            return ack({ response_action: "errors", errors: { date_block: problem } });
          }
        }

        updateData.startTime = startTime.toISOString();
        updateData.endTime = endTime.toISOString();
        if (existing.isAllDay && !isAllDay) updateData.isAllDay = false;
      }

      if (Object.keys(updateData).length === 0) {
        return ack({
          response_action: "errors",
          errors: { select_block: "Nothing to update. Fill at least one field." },
        });
      }

      const response = await runWithTenant(workspaceId, () =>
        axios.patch(`/calendar/appointments/${appointmentId}`, updateData)
      );

      await ack({ response_action: "clear" });
      await sendDm(client, userId, {
        text: `Appointment updated: ${appointmentLabel(response.data)}`,
        blocks: buildAppointmentBlock(response.data, "update"),
      });
    } catch (error) {
      console.error("Appointment edit error:", error.message);
      await ack({
        response_action: "errors",
        errors: { select_block: `API error: ${error.response?.data?.error || error.message}` },
      });
    }
  },

  /** Handles appointment_delete_modal submission, including series scope. */
  async handleAppointmentDeleteSubmit({ body, view, ack, client }) {
    const workspaceId = body.team?.id || view.team_id;
    const userId = body.user?.id;

    try {
      if (view.callback_id !== "appointment_delete_modal") return ack();

      const values = view.state.values;
      const appointmentId = values.select_block?.appointment_select?.selected_option?.value;
      const scope = values.scope_block?.scope?.selected_option?.value || "single";

      if (!appointmentId) {
        return ack({
          response_action: "errors",
          errors: { select_block: "Select an appointment." },
        });
      }

      const listRes = await runWithTenant(workspaceId, () => axios.get(`/calendar/appointments`));
      const target = (listRes.data || []).find((a) => a.id === appointmentId);
      if (!target) {
        return ack({
          response_action: "errors",
          errors: { select_block: "Appointment not found." },
        });
      }

      let targets = [target];
      if (scope === "series" && target.groupId) {
        targets = (listRes.data || []).filter((a) => a.groupId === target.groupId);
      } else if (scope === "series") {
        return ack({
          response_action: "errors",
          errors: { scope_block: "This appointment is not part of a series." },
        });
      }

      for (const appt of targets) {
        await runWithTenant(workspaceId, () => axios.delete(`/calendar/appointments/${appt.id}`));
      }

      await ack({ response_action: "clear" });
      await sendDm(client, userId, {
        text: `Deleted ${targets.length} appointment(s)`,
        blocks: buildSuccessBlock(
          `Deleted *${targets.length}* appointment(s): ${appointmentLabel(target)}.`
        ),
      });
    } catch (error) {
      console.error("Appointment delete error:", error.message);
      await ack({
        response_action: "errors",
        errors: { select_block: `API error: ${error.response?.data?.error || error.message}` },
      });
    }
  },
};
