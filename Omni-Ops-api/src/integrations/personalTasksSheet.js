const isConfigured = () =>
  Boolean(process.env.PERSONAL_TASKS_SHEET_ID && process.env.GOOGLE_CREDENTIALS_JSON);

function isPersonalTask(task) {
  return Boolean(task?.assignedToId) && task.assignedToId === task.createdById;
}

async function syncPersonalTask(task) {
  if (!isConfigured() || !isPersonalTask(task)) return;
}
async function removePersonalTask(taskId) {
  if (!isConfigured()) return;
}

module.exports = { isPersonalTask, syncPersonalTask, removePersonalTask };
