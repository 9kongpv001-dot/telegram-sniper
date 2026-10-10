const { request } = require("undici");

const webhookUrl = process.env.DISCORD_WEBHOOK || "";

/**
 * Mask and blur phone number (e.g. ||093-xxx-7139||)
 * @param {string} phone
 * @returns {string}
 */
function maskPhone(phone) {
  if (!phone) return "-";
  const clean = phone.replace(/[^0-9]/g, "");
  if (clean.length === 10) {
    return `||${clean.slice(0, 3)}-xxx-${clean.slice(-4)}||`;
  }
  return `||${clean.slice(0, 2)}***${clean.slice(-2)}||`;
}

/**
 * Mask and blur voucher code (e.g. ||01a1••••cc4S||)
 * @param {string} code
 * @returns {string}
 */
function maskCode(code) {
  if (!code) return "-";
  if (code.length > 8) {
    return `||${code.slice(0, 4)}••••${code.slice(-4)}||`;
  }
  return `||${code}||`;
}

/**
 * Send embed log to Discord asynchronously (non-blocking)
 * @param {object} info
 */
function sendDiscordLog(info) {
  if (!webhookUrl) return;

  const isSuccess = info.success === true;
  const color = isSuccess ? 0x00e676 : 0xff3d00; // Bright Green : Bright Red

  const blurredPhone = maskPhone(info.phone);
  const blurredCode = maskCode(info.code);

  const embed = {
    title: isSuccess ? "🎉 รับซอง TrueMoney สำเร็จ!" : "⚠️ รับซอง TrueMoney ไม่สำเร็จ",
    color: color,
    fields: [
      {
        name: "💰 ยอดเงิน / สถานะ",
        value: isSuccess ? `**${info.amount} บาท**` : `\`${info.message || "ล้มเหลว"}\``,
        inline: true,
      },
      {
        name: "⏱️ ความเร็ว (Latency)",
        value: `\`${info.elapsed || "-"}\`` + (info.api_elapsed ? ` (API: \`${info.api_elapsed}\`)` : ""),
        inline: true,
      },
      {
        name: "📱 เบอร์รับเงิน",
        value: blurredPhone,
        inline: true,
      },
      {
        name: "🔗 รหัสซอง",
        value: blurredCode,
        inline: false,
      },
    ],
  };

  if (info.chatTitle) {
    embed.fields.push({
      name: "💬 แหล่งที่มา (Chat)",
      value: `\`${info.chatTitle}\``,
      inline: true,
    });
  }

  // Fire-and-forget async request so it never delays execution
  request(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      embeds: [embed],
    }),
  }).catch((err) => {
    console.error("❌ ส่ง Discord Webhook ล้มเหลว:", err.message);
  });
}

module.exports = { sendDiscordLog, maskPhone, maskCode };
