// ضغط الصور قبل إرسالها لواتساب — حد ميتا 5 ميجا للصورة.
// sharp مكتبة C++ فبتضغط بسرعة وبرام محدودة.
// لو التنصيب فشل، الدالة بترجع الصورة زي ما هي بدل ما توقف السيستم.

let sharp = null;
try {
  sharp = require("sharp");
} catch (e) {
  console.warn("[Image] sharp is not available - compression disabled");
}

const MAX_BYTES = 5 * 1024 * 1024; // حد ميتا للصور
const MAX_DIMENSION = 2000; // أبعاد كافية لأي شاشة

const COMPRESSIBLE = ["image/jpeg", "image/png", "image/webp"];

/**
 * بيضغط الصورة لو أكبر من حد ميتا.
 * بيرجع { blob, mimeType, fileName } — الأصل لو مش محتاجة ضغط أو الضغط فشل.
 */
async function compressIfNeeded(file) {
  if (!file?.blob) return file;

  const mime = (file.mimeType || "").split(";")[0];

  // مش صورة، أو تحت الحد أصلاً، أو sharp مش متاحة
  if (!sharp || !COMPRESSIBLE.includes(mime) || file.blob.size <= MAX_BYTES) {
    return file;
  }

  const originalKB = Math.round(file.blob.size / 1024);

  try {
    const input = Buffer.from(await file.blob.arrayBuffer());

    // بنجرب جودات أقل تدريجياً لحد ما نوصل تحت الحد
    for (const quality of [80, 65, 50]) {
      const output = await sharp(input)
        .rotate() // بيحترم اتجاه الصورة من بيانات EXIF
        .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();

      if (output.length <= MAX_BYTES) {
        const newKB = Math.round(output.length / 1024);
        console.log(`[Image] Compressed ${originalKB}KB to ${newKB}KB (quality ${quality})`);

        return {
          blob: new Blob([output], { type: "image/jpeg" }),
          mimeType: "image/jpeg",
          fileName: file.fileName.replace(/\.[^.]+$/, "") + ".jpg",
        };
      }
    }

    console.warn(`[Image] Could not compress ${originalKB}KB below limit`);
    return file;
  } catch (error) {
    console.error("[Image] Compression failed:", error.message);
    return file; // بنرجع الأصل — أحسن من فشل كامل
  }
}

module.exports = { compressIfNeeded };
