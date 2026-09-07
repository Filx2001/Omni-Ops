const axios = require("axios");
const { getTenant } = require("./tenantContext");

const instance = axios.create({
  baseURL: process.env.API_URL,
  timeout: 15000,
});

instance.interceptors.request.use((config) => {
  config.headers["x-api-key"] = process.env.INTERNAL_API_KEY;
  const workspaceId = getTenant();
  if (workspaceId) config.headers["X-Workspace-Id"] = workspaceId;
  return config;
});

module.exports = instance;
