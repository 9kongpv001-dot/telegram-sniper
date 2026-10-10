const { Api } = require("telegram/tl");
const fs = require("fs");
const path = require("path");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const GLOBAL_QUERIES = [
  "gift.truemoney.com",
  "campaign/?v=",
  "แจกซอง",
  "ซองทรู",
  "ซองวอ",
  "อั่งเปาทรู",
  "สุ่มแจกซอง",
  "ซองของขวัญ",
  "เครดิตฟรี ซอง",
];

const VOUCHER_REGEX = /(?:gift\.truemoney\.com\/campaign\/\?v=|\?v=)([a-zA-Z0-9_-]{10,})/i;
const TG_LINK_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/(?:\+|joinchat\/)?([a-zA-Z0-9_\-]+)/gi;

// Cache of usernames and hashes already processed or joined
const joinedSet = new Set();

/**
 * ตรวจสอบกลุ่มว่ามีประวัติแจกซอง TrueMoney จริงหรือไม่
 */
async function verifyGroup(client, entity) {
  try {
    const messages = await client.getMessages(entity, { limit: 40 });
    let count = 0;
    for (const msg of messages) {
      const text = msg.message || "";
      if (VOUCHER_REGEX.test(text) || text.includes("gift.truemoney.com")) {
        count++;
      }
    }
    return count > 0;
  } catch {
    return false;
  }
}

/**
 * Background Auto-Joiner & Crawler Worker
 * ทำงานในแบ็กกราวด์ตลอด 24 ชม. ไม่รบกวนความเร็วของ Sniper
 * @param {import("telegram").TelegramClient} client
 */
async function startBackgroundCrawler(client) {
  console.log("🔄 [AutoCrawler] เริ่มต้นระบบค้นหา & เข้าร่วมกลุ่มแจกซองอัตโนมัติตลอด 24 ชม. ในพื้นหลัง...");

  // รอให้บอทหลักต่อเสร็จ 10 วินาทีก่อนเริ่มรอบแรก
  await sleep(10000);

  while (true) {
    try {
      console.log("\n📡 [AutoCrawler] กำลังสแกนหากลุ่มแจกซองใหม่ทั่ว Telegram...");
      const candidates = new Set();

      // 1. สแกนจาก Global Message Search ล่าสุด
      for (const q of GLOBAL_QUERIES) {
        try {
          const res = await client.invoke(
            new Api.messages.SearchGlobal({
              q,
              filter: new Api.InputMessagesFilterEmpty(),
              minDate: 0,
              maxDate: 0,
              offsetRate: 0,
              offsetPeer: new Api.InputPeerEmpty(),
              offsetId: 0,
              limit: 50,
            })
          );

          for (const chat of res.chats || []) {
            if (chat.username && !joinedSet.has(chat.username.toLowerCase())) {
              candidates.add(chat.username);
            }
          }
          await sleep(2000);
        } catch {
          // ข้ามคำค้นที่ติดปัญหา
        }
      }

      // 2. Spider Crawler จากแชทปัจจุบัน
      try {
        const dialogs = await client.getDialogs({ limit: 40 });
        for (const dialog of dialogs) {
          if (!dialog.isChannel && !dialog.isGroup) continue;
          try {
            const msgs = await client.getMessages(dialog.entity, { limit: 30 });
            for (const m of msgs) {
              const text = m.message || "";
              let match;
              while ((match = TG_LINK_REGEX.exec(text)) !== null) {
                const u = match[1];
                if (u && !text.includes("/+") && !text.includes("/joinchat/")) {
                  if (!joinedSet.has(u.toLowerCase())) {
                    candidates.add(u);
                  }
                }
              }
            }
          } catch {}
        }
      } catch {}

      console.log(`🔎 [AutoCrawler] พบกลุ่มเป้าหมายใหม่ในรอบนี้: ${candidates.size} กลุ่ม`);

      // 3. ตรวจสอบความจริงและกด Join แบบปลอดภัย
      for (const username of candidates) {
        joinedSet.add(username.toLowerCase());
        try {
          const entity = await client.getEntity(username);
          const hasVoucher = await verifyGroup(client, entity);

          if (hasVoucher) {
            console.log(`🎯 [AutoCrawler] พบกลุ่มแจกจริง: @${username} กำลังกดเข้าร่วม...`);
            await client.invoke(new Api.channels.JoinChannel({ channel: entity }));
            console.log(`✅ [AutoCrawler] เข้าร่วมกลุ่ม @${username} สำเร็จ!`);
            // พัก 8 วินาทีเพื่อป้องกัน FloodWait
            await sleep(8000);
          }
        } catch (err) {
          const msg = err.message || "";
          if (msg.includes("USER_ALREADY_PARTICIPANT")) {
            // เคยอยู่แล้ว
          } else if (msg.includes("FLOOD_WAIT")) {
            const sec = parseInt(msg.match(/\d+/)?.[0] || "300", 10);
            console.warn(`⏳ [AutoCrawler] ติดคูลดาวน์ FloodWait ${sec} วิ พักรอบนี้ชั่วคราว`);
            await sleep(sec * 1000);
            break;
          }
        }
      }
    } catch (err) {
      console.warn("⚠️ [AutoCrawler] เกิดข้อผิดพลาดในลูป:", err.message);
    }

    // หน่วงเวลารอบต่อไป 10 นาที เพื่อไม่ให้รบกวนโควตา Telegram
    console.log("💤 [AutoCrawler] สแกนรอบนี้เสร็จสิ้น พัก 10 นาทีก่อนเริ่มรอบถัดไป...");
    await sleep(10 * 60 * 1000);
  }
}

module.exports = { startBackgroundCrawler };
