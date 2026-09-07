const { AsyncLocalStorage } = require("node:async_hooks");
const storage = new AsyncLocalStorage();

function runWithTenant(workspaceId, fn) {
  return storage.run({ workspaceId }, fn);
}

function getTenant() {
  return storage.getStore()?.workspaceId || null;
}

module.exports = { runWithTenant, getTenant };
