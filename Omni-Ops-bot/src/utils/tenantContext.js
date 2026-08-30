const { AsyncLocalStorage } = require("async_hooks");
const storage = new AsyncLocalStorage();

// Runs a function with the current guild's workspace attached
const runWithTenant = (workspaceId, fn) => storage.run({ workspaceId }, fn);

// Reads the current workspace anywhere in the call chain
const getTenant = () => (storage.getStore() || {}).workspaceId || null;

module.exports = { runWithTenant, getTenant };
