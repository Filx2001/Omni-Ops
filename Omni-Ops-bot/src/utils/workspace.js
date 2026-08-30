const axios = require("./axiosInstance");

const cache = new Map();
const TTL = 60_000;

const setCache = (guildId, data) => cache.set(guildId, { at: Date.now(), data });

async function getWorkspace(guildId, { create = false, guildName } = {}) {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < TTL) return hit.data;

  try {
    const res = await axios.get(`/workspaces/discord/${guildId}`);
    setCache(guildId, res.data);
    return res.data;
  } catch (err) {
    if (err.response?.status === 404 && create) {
      const res = await axios.post("/workspaces", {
        platform: "DISCORD",
        workspaceId: guildId,
        organizationName: guildName || "My Organization",
      });
      setCache(guildId, res.data);
      return res.data;
    }
    throw err;
  }
}
async function updateWorkspace(guildId, patch) {
  const res = await axios.patch(`/workspaces/discord/${guildId}`, patch);
  setCache(guildId, res.data);
  return res.data;
}
// Synchronous read of the cached workspace (used by date parsers)
function getCachedWorkspaceSync(guildId) {
  const hit = cache.get(guildId);
  return hit && Date.now() - hit.at < TTL ? hit.data : null;
}

module.exports = { getWorkspace, updateWorkspace, getCachedWorkspaceSync };
