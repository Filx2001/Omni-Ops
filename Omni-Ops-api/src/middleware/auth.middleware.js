// middleware/auth.middleware.js
// بيتحقق إن كل request جاي من البوت بس (مش من برا)
function requireApiKey(req, res, next) {
  // 🌟 استثناء الـ /health والرابط الذي ينتهي بـ /pdf
  // مسار PDF بتاع الفواتير بس — بيتحقق من توقيعه بنفسه
  const BILL_PDF = /^\/bills\/[^/]+\/pdf$/;
  if (req.path === "/health" || BILL_PDF.test(req.path)) {
    return next();
  }
  const apiKey = req.headers["x-api-key"];
  if (!apiKey || apiKey !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}
module.exports = { requireApiKey };
