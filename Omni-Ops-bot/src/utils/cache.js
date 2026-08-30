const NodeCache = require("node-cache");
const axios = require("../utils/axiosInstance");
const { getTenant } = require("../utils/tenantContext");

// Default 10 minutes; leads change quickly (incoming WhatsApp messages)
const appCache = new NodeCache({ stdTTL: 600, checkperiod: 130 });
const SHORT_TTL_KEYS = { leads_list: 60 };

// Multi-tenant: cache entries are namespaced per workspace automatically,
// so guild A never receives guild B's data — with zero changes at call sites.
const scopedKey = (cacheKey) => {
  const tenant = getTenant();
  return tenant ? `${tenant}:${cacheKey}` : cacheKey;
};

async function getCachedData(cacheKey, apiEndpoint) {
  const key = scopedKey(cacheKey);

  // 1. If the data is cached, return it immediately
  const cachedData = appCache.get(key);
  if (cachedData) return cachedData;

  // 2. Otherwise fetch from the API and store it
  try {
    const response = await axios.get(`${process.env.API_URL}${apiEndpoint}`);
    const ttl = SHORT_TTL_KEYS[cacheKey];
    if (ttl) appCache.set(key, response.data, ttl);
    else appCache.set(key, response.data); // stdTTL applies
    return response.data;
  } catch (error) {
    console.error(`[Cache Error] Failed to fetch ${cacheKey}:`, error.message);
    return []; // return an empty array instead of throwing
  }
}

function clearCache(cacheKey) {
  const tenant = getTenant();
  if (tenant) {
    // Inside an interaction: clear only THIS workspace's entry
    appCache.del(`${tenant}:${cacheKey}`);
    return;
  }
  // Outside tenant context: clear the key for ALL workspaces
  for (const k of appCache.keys()) {
    if (k === cacheKey || k.endsWith(`:${cacheKey}`)) appCache.del(k);
  }
}

module.exports = { getCachedData, clearCache };
