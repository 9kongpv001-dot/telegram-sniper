require("dotenv").config();
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const input = require("input");
const fs = require("fs");
const path = require("path");
const { redeemVoucher, extractVoucherCodes } = require("./truemoney");
const { sendDiscordLog } = require("./discord");
const { decodeQRCode } = require("./qrcode");
const { startBackgroundCrawler } = require("./crawler");
const { startDashboardServer } = require("./dashboard");

// เริ่มต้น Web Dashboard Server ทันที (Port 3000 หรือจาก Render PORT)
startDashboardServer();

const apiId = parseInt(process.env.TG_API_ID || "0", 10);
const apiHash = process.env.TG_API_HASH || "";
const targetPhone = (process.env.TARGET_PHONE || "").replace(/[^0-9]/g, "");

// Session handling
let sessionString = process.env.TG_SESSION || "";
const sessionFile = path.join(__dirname, ".session");
if (!sessionString && fs.existsSync(sessionFile)) {
  sessionString = fs.readFileSync(sessionFile, "utf-8").trim();
}

if (!apiId || !apiHash || !targetPhone) {
  console.error("❌ ข้อมูลใน .env ไม่ครบถ้วน (TG_API_ID, TG_API_HASH, TARGET_PHONE)");
  process.exit(1);
}

console.log("⚡ [FastRedeem ULTRA] กำลังเริ่มต้นระบบ Userbot Auto-Redeem + QR Code Scanner...");
console.log(`📱 เบอร์รับเงินเป้าหมาย: ${targetPhone}`);

(async () => {
  const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
    connectionRetries: 10,
    autoReconnect: true,
  });

  client.setLogLevel("none");

  await client.start({
    phoneNumber: async () => await input.text("📲 ป้อนเบอร์โทรศัพท์บัญชี Telegram: "),
    password: async () => await input.text("🔑 ป้อนรหัส 2FA (ถ้ามี): "),
    phoneCode: async () => await input.text("📩 ป้อนรหัส OTP จาก Telegram: "),
    onError: (err) => console.error("❌ เข้าสู่ระบบผิดพลาด:", err),
  });

  const savedSession = client.session.save();
  fs.writeFileSync(sessionFile, savedSession, "utf-8");
  console.log("✅ บันทึก Session สำเร็จ!");
  console.log("🚀 Userbot ออนไลน์แล้ว! [โหมดดักจับลิงก์ซองสด + สแกนรูปภาพ QR Code พร้อมทำงาน]");

  // เริ่มต้นระบบค้นหาและเข้าร่วมกลุ่มแจกซองอัตโนมัติในพื้นหลัง (Background Worker 24/7)
  startBackgroundCrawler(client);

  // Ultra-Fast Ingestion Handler (รองรับทั้งข้อความลิงก์ตรงและรูปภาพ QR Code)
  client.addEventHandler((event) => {
    const message = event.message;
    if (!message) return;

    const rawText = message.text || message.message || "";
    const chatTitle = message.chat?.title || message.chat?.username || "Telegram Group";

    // ============================================================
    // ช่องทางที่ 1: ตรวจจับจากข้อความลิงก์ตรง (Zero-Latency Microsecond)
    // ============================================================
    if (rawText.indexOf("?v=") !== -1 || rawText.indexOf("gift.truemoney") !== -1) {
      const codes = extractVoucherCodes(rawText);
      for (let i = 0; i < codes.length; i++) {
        const code = codes[i];
        redeemVoucher(targetPhone, code).then((result) => {
          const timeNow = new Date().toLocaleTimeString("th-TH");
          if (result.success) {
            console.log(`\n🎉 [${timeNow}] [สำเร็จ!] ได้รับเงิน: ${result.amount} บาท | รหัส: ${result.code} | ความเร็ว: ${result.elapsed}`);
          } else {
            console.log(`\n⚠️ [${timeNow}] [ไม่สำเร็จ] รหัส: ${result.code} | ผลลัพธ์: ${result.message || result.reason} | ความเร็ว: ${result.elapsed}`);
          }

          sendDiscordLog({
            ...result,
            phone: targetPhone,
            chatTitle,
          });
        });
      }
    }

    // ============================================================
    // ช่องทางที่ 2: ตรวจจับรูปภาพและถอดรหัส QR Code อัตโนมัติ
    // ============================================================
    const hasMedia = message.photo || (message.media && (message.media.photo || message.media.document));
    if (hasMedia) {
      client
        .downloadMedia(message, {})
        .then((buffer) => {
          if (!buffer || !buffer.length) return;

          // ถอดรหัสรูปภาพเพื่อหา QR Code
          const qrData = decodeQRCode(buffer);
          if (!qrData) return;

          // ดึงรหัสซองจาก QR Code
          const qrCodes = extractVoucherCodes(qrData);
          if (!qrCodes.length) return;

          for (let i = 0; i < qrCodes.length; i++) {
            const code = qrCodes[i];
            redeemVoucher(targetPhone, code).then((result) => {
              const timeNow = new Date().toLocaleTimeString("th-TH");
              if (result.success) {
                console.log(`\n📷🎉 [${timeNow}] [สแกน QR Code สำเร็จ!] ได้รับเงิน: ${result.amount} บาท | รหัส: ${result.code} | ความเร็ว: ${result.elapsed}`);
              } else {
                console.log(`\n📷⚠️ [${timeNow}] [สแกน QR Code แล้วซองไม่สำเร็จ] รหัส: ${result.code} | ผลลัพธ์: ${result.message || result.reason} | ความเร็ว: ${result.elapsed}`);
              }

              sendDiscordLog({
                ...result,
                phone: targetPhone,
                chatTitle: `📷 [QR Code] ${chatTitle}`,
              });
            });
          }
        })
        .catch(() => {});
    }
  }, new NewMessage({}));
})();
