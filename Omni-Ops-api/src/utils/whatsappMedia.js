// تنزيل الميديا — بننقلها مباشرة من غير تخزين على السيرفر.
// الحماية: بنفحص الحجم قبل التنزيل، وبننزّل ملف واحد في المرة.

const DEFAULT_MAX = Number(process.env.WHATSAPP_MEDIA_MAX_MB || 5) * 1024 * 1024;
const API_VERSION = process.env.WHATSAPP_API_VERSION || "v22.0";
const TIMEOUT_MS = 30000;

// طابور بواحد — بيمنع إن كذا ملف ينزلوا مع بعض ويفجّروا الذاكرة
let queue = Promise.resolve();
function enqueue(task) {
  const result = queue.then(task, task);
  queue = result.catch(() => {});
  return result;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/aac": "aac",
  "application/pdf": "pdf",
};

/**
 * بينزّل ميديا من ميتا بالـ media id.
 * بيرجع { blob, mimeType, fileName } أو null.
 * مبيرميش أبداً — فشل التنزيل مايوقفش الرسالة نفسها.
 */
async function downloadMedia(mediaId) {
  if (!mediaId) return null;

  return enqueue(async () => {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!token) return null;

    try {
      // 1. معلومات الملف — الحجم بييجي هنا قبل ما ننزّل أي بايت
      const metaRes = await fetchWithTimeout(
        `https://graph.facebook.com/${API_VERSION}/${mediaId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!metaRes.ok) {
        console.error(`[Media] Metadata failed for ${mediaId}: ${metaRes.status}`);
        return null;
      }

      const meta = await metaRes.json();
      const size = Number(meta.file_size || 0);

      // الحارس الأساسي — بنرفض قبل التنزيل
      if (size > DEFAULT_MAX) {
        console.warn(`[Media] Skipped ${mediaId}: ${Math.round(size / 1024)}KB exceeds limit`);
        return null;
      }
      if (!meta.url) return null;

      // 2. التنزيل الفعلي — لازم نفس التوكن
      const fileRes = await fetchWithTimeout(meta.url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!fileRes.ok) {
        console.error(`[Media] Download failed for ${mediaId}: ${fileRes.status}`);
        return null;
      }

      const blob = await fileRes.blob();
      const mimeType = meta.mime_type || blob.type || "application/octet-stream";
      const ext = EXTENSIONS[mimeType.split(";")[0]] || "bin";

      console.log(`[Media] Downloaded ${mediaId} (${Math.round(blob.size / 1024)}KB)`);
      return { blob, mimeType, fileName: `${mediaId}.${ext}` };
    } catch (error) {
      console.error(`[Media] Error for ${mediaId}:`, error.message);
      return null;
    }
  });
}

/**
 * بينزّل ملف من رابط عام (مرفقات Chatwoot).
 * بيفحص content-length قبل ما يقرا الجسم — نفس فكرة الحماية.
 */
async function downloadUrl(url, maxBytes = DEFAULT_MAX, fileName = "file") {
  if (!url) return null;

  return enqueue(async () => {
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) {
        console.error(`[Media] URL download failed: ${res.status}`);
        return null;
      }

      // الفحص قبل استهلاك الجسم
      const declared = Number(res.headers.get("content-length") || 0);
      if (declared > maxBytes) {
        console.warn(`[Media] Skipped: ${Math.round(declared / 1024 / 1024)}MB exceeds limit`);
        return null;
      }

      const blob = await res.blob();

      // حماية تانية لو الهيدر مكانش موجود
      if (blob.size > maxBytes) {
        console.warn(`[Media] Skipped after download: ${Math.round(blob.size / 1024 / 1024)}MB`);
        return null;
      }

      const mimeType = res.headers.get("content-type") || blob.type || "application/octet-stream";
      console.log(`[Media] Fetched ${Math.round(blob.size / 1024)}KB from URL`);
      return { blob, mimeType, fileName };
    } catch (error) {
      console.error("[Media] URL download error:", error.message);
      return null;
    }
  });
}

module.exports = { downloadMedia, downloadUrl };
