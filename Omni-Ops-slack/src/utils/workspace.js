const axios = require("./axiosInstance");
const cache = new Map();
const TTL = 60_000;

async function getWorkspace(teamId) {
  const hit = cache.get(teamId);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  try {
    const res = await axios.get(`/workspaces/slack/${teamId}`);
    cache.set(teamId, { at: Date.now(), data: res.data });
    return res.data;
  } catch (err) {
    if (err.response?.status === 404) {
      // Auto-create workspace if it doesn't exist (first time install)
      const res = await axios.post("/workspaces", {
        platform: "SLACK",
        workspaceId: teamId,
        organizationName: "New Slack Workspace",
      });
      cache.set(teamId, { at: Date.now(), data: res.data });
      return res.data;
    }
    throw err;
  }
}

module.exports = { getWorkspace };
