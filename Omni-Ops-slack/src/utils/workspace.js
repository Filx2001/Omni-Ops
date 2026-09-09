const axios = require("./axiosInstance");

const cache = new Map();
const TTL = 60_000;

/** Fetches (and caches for 60s) the workspace row; auto-creates on first install. */
async function getWorkspace(teamId) {
  const hit = cache.get(teamId);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  try {
    const res = await axios.get(`/workspaces/slack/${teamId}`);
    cache.set(teamId, { at: Date.now(), data: res.data });
    return res.data;
  } catch (err) {
    if (err.response?.status === 404) {
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

/** Sync read of the cached row; null when cold. Used by resolveTimeZone. */
function getCachedWorkspaceSync(teamId) {
  const hit = cache.get(teamId);
  return hit && Date.now() - hit.at < TTL ? hit.data : null;
}

module.exports = { getWorkspace, getCachedWorkspaceSync };
