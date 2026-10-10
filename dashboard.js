const http = require("http");

const PORT = process.env.PORT || 3000;

// In-memory log buffer (เก็บ 100 ข้อความล่าสุดสำหรับคนที่เพิ่งเปิดหน้าเว็บ)
const logHistory = [];
const sseClients = new Set();

// สถิติแบบ Realtime
const stats = {
  successCount: 0,
  totalBaht: 0,
  failCount: 0,
  qrCount: 0,
  onlineSince: new Date().toISOString(),
};

/**
 * ส่ง Log เข้าสู่ระบบ Dashboard และสตรีมไปยังหน้าเว็บทุกแท็บแบบ Realtime
 * @param {string} type - 'success' | 'warn' | 'info' | 'crawler' | 'qr'
 * @param {string} text
 */
function pushLog(type, text) {
  const item = {
    id: Date.now() + Math.random().toString(36).substring(2, 7),
    time: new Date().toLocaleTimeString("th-TH"),
    type,
    text,
  };

  logHistory.push(item);
  if (logHistory.length > 150) logHistory.shift();

  // ส่งให้ SSE clients ที่เปิดหน้าเว็บอยู่
  const payload = `data: ${JSON.stringify(item)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

// Hook เข้ากับ console.log และ console.error เดิม
const origLog = console.log;
const origWarn = console.warn;
const origError = console.error;

console.log = function (...args) {
  origLog.apply(console, args);
  const text = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : a)).join(" ");
  let type = "info";
  if (text.includes("[สำเร็จ!]") || text.includes("SUCCESS")) type = "success";
  else if (text.includes("[ไม่สำเร็จ]") || text.includes("ข้าม")) type = "warn";
  else if (text.includes("AutoCrawler") || text.includes("スแกน")) type = "crawler";
  else if (text.includes("QR Code")) type = "qr";
  pushLog(type, text);
};

console.warn = function (...args) {
  origWarn.apply(console, args);
  pushLog("warn", args.join(" "));
};

console.error = function (...args) {
  origError.apply(console, args);
  pushLog("error", args.join(" "));
};

// HTML Dashboard UI (Cyberpunk / Modern Dark Glassmorphism)
const HTML_PAGE = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>⚡ TrueMoney Sniper - Live Console</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;600&family=Prompt:wght@300;400;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: rgba(18, 26, 43, 0.75);
      --border: rgba(255, 255, 255, 0.08);
      --accent: #00ff88;
      --accent-glow: rgba(0, 255, 136, 0.25);
      --orange: #ff9900;
      --red: #ff3366;
      --cyan: #00d4ff;
      --text: #f0f4f8;
      --text-dim: #7e8b9b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      background-image: 
        radial-gradient(circle at 15% 15%, rgba(0, 255, 136, 0.05) 0%, transparent 40%),
        radial-gradient(circle at 85% 85%, rgba(0, 212, 255, 0.05) 0%, transparent 40%);
      color: var(--text);
      font-family: 'Prompt', sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      padding: 1.25rem 2rem;
      border-bottom: 1px solid var(--border);
      background: rgba(9, 13, 22, 0.85);
      backdrop-filter: blur(12px);
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .brand h1 {
      font-size: 1.35rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      background: linear-gradient(135deg, #fff 40%, var(--accent));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.25rem 0.65rem;
      background: rgba(0, 255, 136, 0.12);
      border: 1px solid rgba(0, 255, 136, 0.3);
      border-radius: 9999px;
      font-size: 0.75rem;
      color: var(--accent);
      font-weight: 600;
    }
    .pulse-dot {
      width: 7px;
      height: 7px;
      background: var(--accent);
      border-radius: 50%;
      box-shadow: 0 0 8px var(--accent);
      animation: pulse 1.6s infinite ease-in-out;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }
    main {
      flex: 1;
      padding: 1.5rem 2rem;
      max-width: 1400px;
      width: 100%;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1rem;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 1.25rem;
      backdrop-filter: blur(12px);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
      position: relative;
      overflow: hidden;
    }
    .card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; height: 2px;
      background: linear-gradient(90deg, transparent, var(--card-accent, var(--accent)), transparent);
    }
    .card.green { --card-accent: var(--accent); }
    .card.orange { --card-accent: var(--orange); }
    .card.cyan { --card-accent: var(--cyan); }
    .card.red { --card-accent: var(--red); }
    .card-title {
      font-size: 0.8rem;
      color: var(--text-dim);
      font-weight: 500;
      margin-bottom: 0.35rem;
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    .card-value {
      font-size: 1.75rem;
      font-weight: 700;
      color: #fff;
      font-family: 'Fira Code', monospace;
    }
    .console-container {
      flex: 1;
      background: rgba(11, 16, 28, 0.9);
      border: 1px solid var(--border);
      border-radius: 14px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-height: 480px;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.5);
    }
    .console-header {
      padding: 0.75rem 1.25rem;
      background: rgba(18, 26, 43, 0.6);
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.85rem;
      color: var(--text-dim);
    }
    .controls {
      display: flex;
      gap: 0.5rem;
    }
    .btn {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 0.35rem 0.75rem;
      border-radius: 6px;
      font-size: 0.75rem;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .btn:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.2);
    }
    .btn.active {
      background: var(--accent);
      color: #000;
      font-weight: 600;
    }
    .console-body {
      flex: 1;
      padding: 1rem 1.25rem;
      overflow-y: auto;
      font-family: 'Fira Code', monospace;
      font-size: 0.82rem;
      line-height: 1.6;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .log-line {
      display: flex;
      gap: 0.75rem;
      word-break: break-all;
      padding: 0.2rem 0.4rem;
      border-radius: 4px;
    }
    .log-line:hover { background: rgba(255, 255, 255, 0.02); }
    .log-time { color: var(--text-dim); user-select: none; font-size: 0.75rem; }
    .log-text { color: #d0d7de; flex: 1; }
    .log-line.success { background: rgba(0, 255, 136, 0.08); }
    .log-line.success .log-text { color: var(--accent); font-weight: 600; }
    .log-line.warn .log-text { color: #ffab70; }
    .log-line.crawler .log-text { color: var(--cyan); }
    .log-line.qr .log-text { color: #f6c177; }
    .log-line.error .log-text { color: var(--red); }
    footer {
      padding: 1rem 2rem;
      text-align: center;
      font-size: 0.75rem;
      color: var(--text-dim);
      border-top: 1px solid var(--border);
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <h1>⚡ TrueMoney Sniper Bot</h1>
      <span class="badge"><span class="pulse-dot"></span> LIVE ON RENDER</span>
    </div>
    <div style="font-size: 0.8rem; color: var(--text-dim);">
      Auto-Crawler • Zero-Latency • QR Reader
    </div>
  </header>

  <main>
    <div class="stats-grid">
      <div class="card green">
        <div class="card-title">💰 ยอดเงินที่รับได้ (บาท)</div>
        <div class="card-value" id="stat-money">0</div>
      </div>
      <div class="card cyan">
        <div class="card-title">🎉 สไนป์ซองสำเร็จ (ครั้ง)</div>
        <div class="card-value" id="stat-success">0</div>
      </div>
      <div class="card orange">
        <div class="card-title">⚠️ ซองหมด / พลาด (ครั้ง)</div>
        <div class="card-value" id="stat-fail">0</div>
      </div>
      <div class="card red">
        <div class="card-title">📷 สแกนจาก QR Code</div>
        <div class="card-value" id="stat-qr">0</div>
      </div>
    </div>

    <div class="console-container">
      <div class="console-header">
        <div>Terminal Stream &mdash; เรียลไทม์ Sub-Millisecond</div>
        <div class="controls">
          <button class="btn" onclick="clearLogs()">ล้างหน้าจอ</button>
          <button class="btn" id="btn-autoscroll" onclick="toggleAutoScroll()">Auto-Scroll: ON</button>
        </div>
      </div>
      <div class="console-body" id="console"></div>
    </div>
  </main>

  <footer>
    Render Web Service • Port ${PORT} • Telegram Userbot MTProto
  </footer>

  <script>
    const consoleEl = document.getElementById('console');
    const statMoney = document.getElementById('stat-money');
    const statSuccess = document.getElementById('stat-success');
    const statFail = document.getElementById('stat-fail');
    const statQr = document.getElementById('stat-qr');
    let autoScroll = true;

    let totalMoney = 0;
    let totalSuccess = 0;
    let totalFail = 0;
    let totalQr = 0;

    function appendLine(item) {
      const line = document.createElement('div');
      line.className = 'log-line ' + (item.type || 'info');
      line.innerHTML = '<span class="log-time">' + item.time + '</span><span class="log-text">' + escapeHtml(item.text) + '</span>';
      consoleEl.appendChild(line);

      // ตรวจจับสถิติจากข้อความ
      if (item.text.includes('[สำเร็จ!]') || item.text.includes('SUCCESS')) {
        totalSuccess++;
        statSuccess.textContent = totalSuccess;
        const match = item.text.match(/เงิน:\\s*([0-9.]+)/i) || item.text.match(/ได้:\\s*([0-9.]+)/i);
        if (match) {
          totalMoney += parseFloat(match[1]);
          statMoney.textContent = totalMoney.toFixed(2);
        }
      } else if (item.text.includes('[ไม่สำเร็จ]') || item.text.includes('ซองหมด')) {
        totalFail++;
        statFail.textContent = totalFail;
      }
      if (item.text.includes('QR Code')) {
        totalQr++;
        statQr.textContent = totalQr;
      }

      if (autoScroll) {
        consoleEl.scrollTop = consoleEl.scrollHeight;
      }
    }

    function escapeHtml(str) {
      return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function clearLogs() {
      consoleEl.innerHTML = '';
    }

    function toggleAutoScroll() {
      autoScroll = !autoScroll;
      const btn = document.getElementById('btn-autoscroll');
      btn.textContent = 'Auto-Scroll: ' + (autoScroll ? 'ON' : 'OFF');
      btn.classList.toggle('active', autoScroll);
    }

    // โหลดประวัติเดิม
    fetch('/api/history')
      .then(r => r.json())
      .then(items => {
        items.forEach(appendLine);
      });

    // ต่อเชื่อม Realtime ผ่าน Server-Sent Events (SSE)
    const evtSource = new EventSource('/api/stream');
    evtSource.onmessage = function(e) {
      try {
        const item = JSON.parse(e.data);
        appendLine(item);
      } catch (err) {}
    };
    evtSource.onerror = function() {
      // Browser จะ auto-reconnect อัตโนมัติ
    };
  </script>
</body>
</html>`;

/**
 * Start the Web Dashboard HTTP server
 */
function startDashboardServer() {
  const server = http.createServer((req, res) => {
    const url = req.url.split("?")[0];

    // Health check สำหรับ Render
    if (url === "/health" || url === "/ping") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
      return;
    }

    // หน้าแรก HTML Dashboard
    if (url === "/" || url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(HTML_PAGE);
      return;
    }

    // ดึงประวัติ Log ล่าสุด
    if (url === "/api/history") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(logHistory));
      return;
    }

    // Realtime Server-Sent Events (SSE) stream
    if (url === "/api/stream") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      res.write(":\n\n");
      sseClients.add(res);

      req.on("close", () => {
        sseClients.delete(res);
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });

  server.listen(PORT, "0.0.0.0", () => {
    origLog(`🌐 [Dashboard] เว็บคอนโซลเปิดให้บริการที่ http://0.0.0.0:${PORT} (พร้อมสำหรับ Render)`);
  });
}

module.exports = { startDashboardServer, pushLog, stats };
