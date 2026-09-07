/**
 * /omni-calendar command: create, list, delete events via modals.
 */

const axios = require("../utils/axiosInstance");
const { runWithTenant } = require("../utils/tenantContext");
const { checkIsManager } = require("../utils/slackPermissions");
const { parseSlackDateTime, isValidYear } = require("../utils/slackDates");
const { sendDm } = require("../utils/slackDm");
const { buildErrorBlock, buildSuccessBlock } = require("../utils/slackBlocks");
const { TYPE_LABELS, buildEventBlock, buildEventListBlocks } = require("../utils/calendarUtils");
const { buildEventModal, buildEventDeleteModal } = require("../utils/calendarModals");

module.exports = {
  /** Routes /omni-calendar <subcommand>. */
  async handleCalendarCommand({ command, ack, say, client }) {
    await ack();

    const workspaceId = command.team_id;
    const slackUserId = command.user_id;
    const subcommand = command.text.trim().split(/\s+/)[0]?.toLowerCase();

    try {
      if (subcommand === "create" || subcommand === "delete") {
        const { isManager } = await checkIsManager(slackUserId, workspaceId);
        if (!isManager) {
          return say({
            text: "Permission denied",
            blocks: buildErrorBlock("Only Managers and Admins can manage events."),
            response_type: "ephemeral",
          });
        }

        await client.views.open({
          trigger_id: command.trigger_id,
          view: subcommand === "create" ? buildEventModal() : buildEventDeleteModal(),
        });
      } else if (subcommand === "list") {
        const response = await runWithTenant(workspaceId, () => axios.get(`/calendar/events`));
        const upcoming = (response.data || [])
          .filter((e) => new Date(e.endDate) > new Date())
          .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

        if (!upcoming.length) {
          return say({
            text: "No upcoming events",
            blocks: buildSuccessBlock("No upcoming events found."),
            response_type: "ephemeral",
          });
        }

        await say({
          text: "Upcoming events",
          blocks: buildEventListBlocks(upcoming),
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
                  "• `/omni-calendar create` — New event via form\n" +
                  "• `/omni-calendar list` — Upcoming events\n" +
                  "• `/omni-calendar delete` — Delete via picker",
              },
            },
          ],
          response_type: "ephemeral",
        });
      }
    } catch (error) {
      console.error("Calendar command error:", error.message);
      await say({
        text: "Error",
        blocks: buildErrorBlock(
          `Operation failed: ${error.response?.data?.error || error.message}`
        ),
        response_type: "ephemeral",
      });
    }
  },

  /** Handles event_create_modal submission. */
  async handleEventCreateSubmit({ body, view, ack, client }) {
    const workspaceId = body.team?.id || view.team_id;
    const userId = body.user?.id;

    try {
      if (view.callback_id !== "event_create_modal") return ack();

      const values = view.state.values;
      const title = values.title_block?.title?.value;
      const type = values.type_block?.type?.selected_option?.value;
      const date = values.date_block?.date?.selected_date;
      const start = values.start_block?.start_time?.selected_time;
      const end = values.end_block?.end_time?.selected_time;
      const description = values.description_block?.description?.value;
      const assigneeIds = (values.assignees_block?.employee_multi?.selected_options || []).map(
        (option) => option.value
      );

      const errors = {};
      if (!title) errors.title_block = "Title is required";
      if (!date) errors.date_block = "Date is required";
      if (Object.keys(errors).length) return ack({ response_action: "errors", errors });

      const isAllDay = !start;
      const startDate = parseSlackDateTime(date, start || "00:00");
      // Timed events without an explicit end default to one hour
      const endDate = isAllDay
        ? startDate
        : end
          ? parseSlackDateTime(date, end)
          : new Date(startDate.getTime() + 60 * 60 * 1000);

      if (!startDate || !isValidYear(startDate)) {
        return ack({
          response_action: "errors",
          errors: { date_block: "Invalid date. Pick a date in the current year or later." },
        });
      }
      if (!isAllDay && endDate <= startDate) {
        return ack({
          response_action: "errors",
          errors: { end_block: "The end time must be after the start time." },
        });
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

      // Store type, details and assignee names in the description, matching Discord
      let dbDescription = `🏷️ Type: ${TYPE_LABELS[type] || type}\n`;
      if (description) dbDescription += `📄 Details: ${description}\n`;
      if (assigneeIds.length) {
        const employeesRes = await runWithTenant(workspaceId, () => axios.get(`/employees`));
        const names = (employeesRes.data || [])
          .filter((emp) => assigneeIds.includes(emp.id))
          .map((emp) => emp.name)
          .join(", ");
        if (names) dbDescription += `👥 Assigned To: ${names}`;
      }

      const response = await runWithTenant(workspaceId, () =>
        axios.post(`/calendar/events`, {
          title,
          type,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          isAllDay,
          description: dbDescription,
          createdById: creator.data.id,
          assigneeIds,
        })
      );

      await ack({ response_action: "clear" });
      await sendDm(client, userId, {
        text: `Event created: ${response.data.title}`,
        blocks: buildEventBlock(response.data, "create"),
      });
    } catch (error) {
      console.error("Event create error:", error.message);
      await ack({
        response_action: "errors",
        errors: { title_block: `API error: ${error.response?.data?.error || error.message}` },
      });
    }
  },

  /** Handles event_delete_modal submission, including series scope. */
  async handleEventDeleteSubmit({ body, view, ack, client }) {
    const workspaceId = body.team?.id || view.team_id;
    const userId = body.user?.id;

    try {
      if (view.callback_id !== "event_delete_modal") return ack();

      const values = view.state.values;
      const eventId = values.select_block?.event_select?.selected_option?.value;
      const scope = values.scope_block?.scope?.selected_option?.value || "single";

      if (!eventId) {
        return ack({ response_action: "errors", errors: { select_block: "Select an event." } });
      }

      const response = await runWithTenant(workspaceId, () =>
        axios.delete(`/calendar/events/${eventId}?scope=${scope}`)
      );
      const count = response.data?.count || 1;

      await ack({ response_action: "clear" });
      await sendDm(client, userId, {
        text: `Deleted ${count} event day(s)`,
        blocks: buildSuccessBlock(`Deleted *${count}* event day(s).`),
      });
    } catch (error) {
      console.error("Event delete error:", error.message);
      await ack({
        response_action: "errors",
        errors: { select_block: `API error: ${error.response?.data?.error || error.message}` },
      });
    }
  },
};
