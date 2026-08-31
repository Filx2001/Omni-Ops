// Compresses images before sending to WhatsApp — Meta's limit is 5MB per image.
let sharp = null;
try {
  sharp = require("sharp");
} catch (e) {
  console.warn("[Image] sharp is not available - compression disabled");
}

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_DIMENSION = 2000;
const COMPRESSIBLE = ["image/jpeg", "image/png", "image/webp"];

async function compressIfNeeded(file) {
  if (!file?.blob) return file;
  const mime = (file.mimeType || "").split(";")[0];

  if (!sharp || !COMPRESSIBLE.includes(mime) || file.blob.size <= MAX_BYTES) {
    return file;
  }

  const originalKB = Math.round(file.blob.size / 1024);

  try {
    const input = Buffer.from(await file.blob.arrayBuffer());

    for (const quality of [80, 65, 50]) {
      const output = await sharp(input)
        .rotate()
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
    return file;
  }
}

module.exports = { compressIfNeeded };
