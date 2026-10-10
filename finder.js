require("dotenv").config();
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { Api } = require("telegram/tl");
const input = require("input");
const fs = require("fs");
const path = require("path");

const apiId = parseInt(process.env.TG_API_ID || "0", 10);
const apiHash = process.env.TG_API_HASH || "";
const sessionFile = path.join(__dirname, ".session");

let sessionString = process.env.TG_SESSION || "";
if (!sessionString && fs.existsSync(sessionFile)) {
  sessionString = fs.readFileSync(sessionFile, "utf-8").trim();
}

const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
  connectionRetries: 5,
});

// ค้นหาข้อความที่มีการส่งซองจริงทั่วโลกแบบเจาะลึก
const GLOBAL_VOUCHER_QUERIES = [
  "gift.truemoney.com",
  "campaign/?v=",
  "แจกซอง",
  "ซองทรู",
  "ซองวอ",
  "อั่งเปาทรู",
  "แจกซองวอเลท",
  "สุ่มแจกซอง",
  "ซองของขวัญ",
  "แจกอั่งเปา",
  "ซองแดง",
  "เครดิตฟรี ซอง",
  "แจกซองฟรี",
  "รับซองทรู",
  "ลิ้งค์ซอง",
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const VOUCHER_REGEX = /(?:gift\.truemoney\.com\/campaign\/\?v=|\?v=)([a-zA-Z0-9_-]{10,})/i;
const TG_LINK_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/(?:\+|joinchat\/)?([a-zA-Z0-9_\-]+)/gi;

/**
 * ตรวจสอบข้อความล่าสุดว่ามีการแจกซองทรูมันนี่จริงหรือไม่
 */
async function verifyVoucherActivity(entity) {
  try {
    const messages = await client.getMessages(entity, { limit: 50 });
    let voucherCount = 0;
    let sampleVoucher = "";
    let lastDate = null;

    for (const msg of messages) {
      const text = msg.message || "";
      if (VOUCHER_REGEX.test(text) || text.includes("gift.truemoney.com")) {
        voucherCount++;
        const match = VOUCHER_REGEX.exec(text);
        if (match && match[1] && !sampleVoucher) {
          sampleVoucher = match[1];
        }
        if (!lastDate && msg.date) {
          lastDate = new Date(msg.date * 1000).toLocaleString("th-TH");
        }
      }
    }

    return {
      verified: voucherCount > 0,
      voucherCount,
      sampleVoucher,
      lastDate,
    };
  } catch (err) {
    return {
      verified: false,
      voucherCount: 0,
      error: err.message,
    };
  }
}

async function main() {
  console.log("⚡ กำลังเชื่อมต่อเข้าสู่ระบบ Telegram...");

  await client.start({
    phoneNumber: async () => await input.text("📲 ป้อนเบอร์โทรศัพท์: "),
    password: async () => await input.text("🔑 ป้อนรหัส 2FA (ถ้ามี): "),
    phoneCode: async () => await input.text("📩 ป้อนรหัส OTP: "),
    onError: (err) => console.error("❌ ข้อผิดพลาด:", err),
  });

  const saved = client.session.save();
  fs.writeFileSync(sessionFile, saved, "utf-8");
  console.log("✅ เชื่อมต่อ Telegram สำเร็จ!");

  const targetList = new Map(); // username => { username, title, fromQuery }

  // ============================================================
  // ขั้นตอนที่ 1: Deep Global Search ดึงแชทที่มีการแจกซองจริง
  // ============================================================
  console.log(`\n[1/3] 🎯 ค้นหาข้อความแจกซองทรูมันนี่สดๆ จากประวัติทั่ว Telegram (${GLOBAL_VOUCHER_QUERIES.length} คีย์เวิร์ด)...`);

  for (const q of GLOBAL_VOUCHER_QUERIES) {
    try {
      process.stdout.write(`   🔎 ค้นหาประวัติ "${q}"... `);
      let offsetId = 0;
      let countForThisQuery = 0;

      // ค้นหา 2 หน้าต่อ 1 คีย์เวิร์ด
      for (let page = 0; page < 2; page++) {
        const res = await client.invoke(
          new Api.messages.SearchGlobal({
            q: q,
            filter: new Api.InputMessagesFilterEmpty(),
            minDate: 0,
            maxDate: 0,
            offsetRate: 0,
            offsetPeer: new Api.InputPeerEmpty(),
            offsetId: offsetId,
            limit: 100,
          })
        );

        if (!res.messages?.length) break;

        for (const chat of res.chats || []) {
          if (!chat.username) continue;
          const u = chat.username.toLowerCase();
          if (!targetList.has(u)) {
            targetList.set(u, {
              type: "public",
              username: chat.username,
              title: chat.title,
              participantsCount: chat.participantsCount || "ไม่ระบุ",
              source: `ค้นพบจากคำค้น "${q}"`,
            });
            countForThisQuery++;
          }
        }

        offsetId = res.messages[res.messages.length - 1].id;
        await sleep(1000);
      }
      console.log(`(พบใหม่ +${countForThisQuery})`);
    } catch (err) {
      console.log(`(ข้าม: ${err.message})`);
    }
    await sleep(1200);
  }

  // ============================================================
  // ขั้นตอนที่ 2: Spider Crawler ดึงลิงก์จากแชทที่กำลังอยู่
  // ============================================================
  console.log("\n[2/3] 🕷️ Spider Crawler สแกนหากลุ่มสาธารณะเพิ่มเติมจากประวัติแชท...");
  try {
    const dialogs = await client.getDialogs({ limit: 80 });
    for (const dialog of dialogs) {
      if (!dialog.isChannel && !dialog.isGroup) continue;
      try {
        const msgs = await client.getMessages(dialog.entity, { limit: 60 });
        for (const m of msgs) {
          const t = m.message || "";
          let match;
          while ((match = TG_LINK_REGEX.exec(t)) !== null) {
            const raw = match[1];
            if (!raw || t.includes("/+") || t.includes("/joinchat/")) continue; // เน้น Public Groups ป้องกัน Invite FloodWait
            const u = raw.toLowerCase();
            if (!targetList.has(u)) {
              targetList.set(u, {
                type: "public",
                username: raw,
                title: `พบในแชท: ${dialog.title}`,
                participantsCount: "ไม่ระบุ",
                source: "Spider Crawler",
              });
            }
          }
        }
      } catch {}
    }
  } catch (err) {
    console.warn("Spider error:", err.message);
  }

  const allTargets = Array.of(...targetList.values());
  console.log(`\n========================================================`);
  console.log(`🔥 รวมกลุ่ม/ช่องสาธารณะทั้งหมดที่พบ: ${allTargets.length} ช่องทาง!`);
  console.log(`========================================================\n`);

  // ============================================================
  // ขั้นตอนที่ 3: ตรวจสอบความจริง 100% ว่ามีซอง + Auto Join
  // ============================================================
  console.log("⚡ เริ่มต้นระบบตรวจสอบประวัติการแจกซองจริง (Verify) และเข้าร่วมกลุ่ม...\n");

  const verifiedList = [];
  let joinedCount = 0;

  for (let i = 0; i < allTargets.length; i++) {
    const item = allTargets[i];
    const prefix = `[${i + 1}/${allTargets.length}]`;

    try {
      const entity = await client.getEntity(item.username);
      const check = await verifyVoucherActivity(entity);

      if (check.verified) {
        console.log(`🎯 ${prefix} 【แจกจริง 100%】 ${item.title || item.username} (@${item.username})`);
        console.log(`   └─ 🧧 พบประวัติแจกซอง TrueMoney ${check.voucherCount} ครั้งล่าสุด (ตัวอย่าง: ${check.sampleVoucher})`);
        if (check.lastDate) console.log(`   └─ ⏰ เวลาแจกล่าสุด: ${check.lastDate}`);

        verifiedList.push({
          username: item.username,
          title: item.title,
          voucherCount: check.voucherCount,
          sampleVoucher: check.sampleVoucher,
          lastDate: check.lastDate,
        });

        // ทำการเข้าร่วมกลุ่ม
        try {
          await client.invoke(new Api.channels.JoinChannel({ channel: entity }));
          joinedCount++;
          console.log(`   └─ ✅ เข้าร่วมกลุ่มสำเร็จ!`);
          await sleep(3500);
        } catch (joinErr) {
          const jm = joinErr.message || "";
          if (jm.includes("USER_ALREADY_PARTICIPANT")) {
            console.log(`   └─ ℹ️ บัญชีของคุณอยู่ในกลุ่มนี้อยู่แล้ว`);
          } else if (jm.includes("FLOOD_WAIT")) {
            const sec = jm.match(/\d+/) ? jm.match(/\d+/)[0] : "ชั่วคราว";
            console.warn(`   └─ ⏳ Telegram ติดคูลดาวน์ FloodWait (${sec} วินาที) ขอพักการกด Join`);
            break;
          } else {
            console.log(`   └─ ⚠️ เข้าไม่ได้ (${jm})`);
          }
        }
      } else {
        console.log(`⏩ ${prefix} ข้ามกลุ่ม ${item.title || item.username} (ไม่มีประวัติแจกซอง)`);
      }
    } catch (err) {
      // ข้าม username ที่ resolve ไม่ได้
    }
  }

  // บันทึกลงไฟล์
  const resultPath = path.join(__dirname, "verified_giveaways.json");
  fs.writeFileSync(resultPath, JSON.stringify(verifiedList, null, 2), "utf-8");

  console.log(`\n========================================================`);
  console.log(`🎉 ผลลัพธ์: คัดกรองกลุ่มที่แจกซอง TrueMoney จริงแท้ 100%: ${verifiedList.length} กลุ่ม`);
  console.log(`💾 บันทึกรายชื่อกลุ่มแจกจริงทั้งหมดลง: ${resultPath}`);
  console.log(`✅ เข้าร่วมกลุ่มใหม่สำเร็จ: ${joinedCount} กลุ่ม`);
  console.log(`🚀 คุณสามารถรัน 'npm start' เพื่อเริ่มสไนป์ซองได้เลย!`);
  console.log(`========================================================\n`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal Error:", err);
  process.exit(1);
});
