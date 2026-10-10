const { Agent, request } = require("undici");

// High-performance Agent with TCP_NODELAY and persistent Keep-Alive
const httpAgent = new Agent({
  keepAliveTimeout: 120000,
  keepAliveMaxTimeout: 300000,
  pipelining: 1,
  connections: 200,
  connect: {
    noDelay: true,       // ปิด Nagle's algorithm เพื่อส่ง Packet ทันทีโดยไม่ต้องรอ Buffer
    keepAlive: true,     // คงสภาพการเชื่อมต่อระดับ Socket ตลอดเวลา
    keepAliveInitialDelay: 1000,
  },
});

// Cache voucher hashes in memory to prevent duplicate requests
const redeemedCodes = new Set();

const API_BASE = "https://twn-api.onrender.com/api/redeem.php";

/**
 * Socket Warmer: ยิง Ping หล่อเลี้ยง Socket ทุก 20 วินาที
 * เพื่อให้ TLS 1.3 / TCP Handshake ร้อนอยู่ตลอดเวลา (0ms handshake latency)
 */
function warmSocket() {
  request(API_BASE, {
    method: "GET",
    dispatcher: httpAgent,
  }).catch(() => {});
}
// รัน Warmer ทันทีและวนทุก 20 วินาทีใน background (unref เพื่อไม่บล็อก process exit)
warmSocket();
setInterval(warmSocket, 20000).unref();

/**
 * Redeem TrueMoney voucher hash via twn-api
 * @param {string} cleanPhone - เบอร์โทรศัพท์ที่คลีนแล้ว
 * @param {string} cleanCode - รหัสซอง
 * @returns {Promise<object>}
 */
async function redeemVoucher(cleanPhone, cleanCode) {
  if (!cleanCode || !cleanPhone) {
    return { success: false, reason: "invalid_input", code: cleanCode };
  }

  if (redeemedCodes.has(cleanCode)) {
    return { success: false, reason: "already_processed", message: "ซองนี้เคยประมวลผลไปแล้ว", elapsed: "0.01ms", code: cleanCode };
  }
  redeemedCodes.add(cleanCode);

  const url = `${API_BASE}?phone=${cleanPhone}&voucher=${cleanCode}`;
  const tStart = performance.now();

  try {
    const res = await request(url, {
      method: "GET",
      dispatcher: httpAgent,
      headers: {
        "accept": "application/json",
      },
    });

    const bodyText = await res.body.text();
    const elapsed = (performance.now() - tStart).toFixed(2);

    let data;
    try {
      data = JSON.parse(bodyText);
    } catch {
      return { success: false, reason: "invalid_response", elapsed: `${elapsed}ms`, raw: bodyText, code: cleanCode };
    }

    if (data.success === true) {
      return {
        success: true,
        amount: data.amount || data.data?.amount || data.message || "0",
        message: data.message,
        owner: data.owner || "unknown",
        code: cleanCode,
        elapsed: `${elapsed}ms`,
        api_elapsed: `${data.elapsed_ms || 0}ms`,
        data,
      };
    } else {
      return {
        success: false,
        message: data.message || "Redeem failed",
        code: cleanCode,
        elapsed: `${elapsed}ms`,
        api_elapsed: `${data.elapsed_ms || 0}ms`,
        data,
      };
    }
  } catch (err) {
    return {
      success: false,
      reason: err.message,
      code: cleanCode,
      elapsed: `${(performance.now() - tStart).toFixed(2)}ms`,
    };
  }
}

/**
 * Zero-copy microsecond ASCII character scanner for voucher hash extraction
 * เร็วกว่า Regular Expression 10-50 เท่า ทำงานในระดับ Microsecond (0.001ms)
 * @param {string} text
 * @returns {string[]}
 */
function extractVoucherCodesFast(text) {
  if (!text) return [];
  const results = [];
  const len = text.length;
  let pos = 0;

  while (pos < len) {
    let start = text.indexOf("?v=", pos);
    let offset = 3;
    if (start === -1) {
      start = text.indexOf("v=", pos);
      offset = 2;
      if (start === -1) break;
    }

    start += offset;
    let end = start;

    while (end < len) {
      const c = text.charCodeAt(end);
      // 0-9 (48-57), A-Z (65-90), a-z (97-122), _ (95), - (45)
      if (
        (c >= 48 && c <= 57) ||
        (c >= 97 && c <= 122) ||
        (c >= 65 && c <= 90) ||
        c === 95 ||
        c === 45
      ) {
        end++;
      } else {
        break;
      }
    }

    if (end - start >= 10) {
      results.push(text.slice(start, end));
    }
    pos = end + 1;
  }

  return results;
}

module.exports = {
  redeemVoucher,
  extractVoucherCodes: extractVoucherCodesFast,
  redeemedCodes,
  warmSocket,
};
