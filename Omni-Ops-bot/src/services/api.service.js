const axios = require("../utils/axiosInstance");

// Fetches dashboard statistics scoped to the current workspace
async function getDashboard() {
  const response = await axios.get("/dashboard");
  return response.data;
}

module.exports = {
  getDashboard,
};
