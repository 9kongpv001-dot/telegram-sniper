const jsQR = require("jsqr");
const jpeg = require("jpeg-js");
const { PNG } = require("pngjs");

/**
 * Decode image buffer to RGBA pixels and scan for QR code
 * @param {Buffer} buffer - Raw image file buffer
 * @returns {string|null} - Decoded QR code text data or null
 */
function decodeQRCode(buffer) {
  if (!buffer || buffer.length < 16) return null;

  try {
    let width = 0;
    let height = 0;
    let data = null;

    // ตรวจสอบ Magic Bytes ของรูปภาพ
    if (buffer[0] === 0xff && buffer[1] === 0xd8) {
      // JPEG / JPG
      const raw = jpeg.decode(buffer, { useTArray: true, maxMemoryUsageInMB: 128 });
      width = raw.width;
      height = raw.height;
      data = raw.data;
    } else if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      // PNG
      const png = PNG.sync.read(buffer);
      width = png.width;
      height = png.height;
      data = png.data;
    } else {
      // ลองถอดรหัสแบบ JPEG fallback
      try {
        const raw = jpeg.decode(buffer, { useTArray: true });
        width = raw.width;
        height = raw.height;
        data = raw.data;
      } catch {
        return null;
      }
    }

    if (!data || !width || !height) return null;

    // สแกน QR code ผ่าน jsQR
    const qrResult = jsQR(new Uint8ClampedArray(data), width, height);
    if (qrResult && qrResult.data) {
      return qrResult.data;
    }
  } catch (err) {
    // เงียบไว้เพื่อไม่ให้กระทบ event loop
  }

  return null;
}

module.exports = { decodeQRCode };
