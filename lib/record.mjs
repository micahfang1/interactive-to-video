// 录制：无头浏览器打开动页，按脚本一段一段操作，用 CDP screencast 抓帧，按固定帧率边录边送进 ffmpeg 压成视频（不落盘存帧）。
// 画面上叠三样东西（注入页面，不改动页本身）：看得见的光标、底部字幕、右上角站名。
import { mkdir } from 'node:fs/promises';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

// 默认用本目录 npm install 装的 playwright 和它自带的 Chromium；也可以指到别处已经装好的
const PLAYWRIGHT = process.env.PLAYWRIGHT_FROM || 'playwright';
const CHROME = process.env.CHROME_PATH || null;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 注入页面的叠加层和工具函数（在页面里运行） */
function overlay({ hideCss, brand, zoom }) {
  if (zoom !== 1) document.documentElement.style.zoom = String(zoom);
  const css = `
    ${hideCss || ''}
    #__v_cursor { position: fixed; left: 0; top: 0; z-index: 2147483646; width: 28px; height: 28px; pointer-events: none;
      transform: translate(-200px, -200px); will-change: transform; filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
    #__v_ring { position: fixed; left: 0; top: 0; z-index: 2147483645; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%;
      border: 3px solid rgba(255, 99, 71, .9); pointer-events: none; opacity: 0; transform: translate(-200px, -200px) scale(.3); }
    #__v_ring.go { animation: __v_ring .5s ease-out; }
    @keyframes __v_ring { 0% { opacity: .95; scale: .3; } 100% { opacity: 0; scale: 1.5; } }
    #__v_sub { position: fixed; left: 50%; bottom: 34px; z-index: 2147483644; transform: translateX(-50%); max-width: 82%;
      padding: 9px 20px 10px; border-radius: 12px; background: rgba(20, 18, 16, .86); color: #fff; text-align: center;
      font: 600 25px/1.45 "PingFang SC", "Hiragino Sans GB", system-ui, sans-serif; letter-spacing: .02em;
      opacity: 0; transition: opacity .18s; pointer-events: none; text-wrap: balance; }
    #__v_sub.on { opacity: 1; }
    #__v_brand { position: fixed; right: 22px; top: 18px; z-index: 2147483643; padding: 5px 12px; border-radius: 99px;
      background: rgba(255,255,255,.82); color: #3a2a20; font: 600 14px/1.3 system-ui, sans-serif; letter-spacing: .03em; pointer-events: none; }
    #__v_card { position: fixed; inset: 0; z-index: 2147483642; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px;
      background: #f7f3ec; color: #1c1815; opacity: 0; transition: opacity .5s; pointer-events: none; text-align: center; }
    #__v_card.on { opacity: 1; }
    #__v_card h1 { font: 700 56px/1.25 "PingFang SC", system-ui, sans-serif; margin: 0; }
    #__v_card p { font: 500 28px/1.5 "PingFang SC", system-ui, sans-serif; margin: 0; color: #5c4a3d; }
    #__v_card b { font: 700 34px/1.4 ui-monospace, Menlo, monospace; color: #c2410c; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  const add = (id, html = '') => { const d = document.createElement('div'); d.id = id; d.innerHTML = html; document.body.appendChild(d); return d; };
  const cur = add('__v_cursor', '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M4 2l15 9.5-6.6 1.4 3.8 7.4-2.7 1.4-3.8-7.5L5 19z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>');
  const ring = add('__v_ring');
  const sub = add('__v_sub');
  if (brand) add('__v_brand').textContent = brand;
  const card = add('__v_card');
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const V = (window.__v = { x: -200, y: -200 });
  // x、y 是真实视口像素；页面整体放大了 zoom 倍，叠加层里的长度要除回去
  V.place = (x, y) => { V.x = x; V.y = y; cur.style.transform = `translate(${x / zoom - 4}px, ${y / zoom - 2}px)`; };
  V.ring = () => { ring.style.transform = `translate(${V.x / zoom}px, ${V.y / zoom}px)`; ring.classList.remove('go'); void ring.offsetWidth; ring.classList.add('go'); };
  V.sub = (text) => { if (text) { sub.textContent = text; sub.classList.add('on'); } else sub.classList.remove('on'); };
  V.card = (html) => { cur.style.opacity = html ? '0' : '1'; if (html) { card.innerHTML = html; card.classList.add('on'); } else card.classList.remove('on'); };
  V.scrollTo = (top, ms) => new Promise((done) => {
    const from = window.scrollY, t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      window.scrollTo(0, from + (top - from) * ease(t));
      if (t < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });
}

/**
 * 打开页面并开始抓帧。返回的 ctx 给脚本用：
 *   say(text)             换字幕（配音在后期按时间戳合进去）
 *   scrollTo(y|selector)  平滑滚动；选择器会滚到元素落在画面 offset 处
 *   click(selector)       光标移过去、点一下（真实点击）
 *   move(selector|{x,y})  只移动光标
 *   wait(ms)
 */
export async function openRecorder({ url, outDir, width = 1280, height = 720, scale = 1.5, zoom = 1, hideCss = '', brand = 'interflus.com', serve = null, captureAudio = false }) {
  const { chromium } = await import(PLAYWRIGHT);
  await mkdir(outDir, { recursive: true });
  // 要完整的 Chromium（新版无头模式），不是 headless shell：后者不认窗口大小和缩放这两个参数
  const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : { channel: 'chromium' }), args: ['--autoplay-policy=no-user-gesture-required', '--disable-audio-output', '--hide-scrollbars',
    // 不听系统的媒体键 / 「正在播放」控制：别的应用一按暂停，这里的声音也会被按停
    '--disable-features=HardwareMediaKeyHandling,MediaSessionService,GlobalMediaControls,AudioFocusEnforcement',
    // 整个浏览器按 scale 倍渲染：页面看到的还是 width×height（vh、媒体查询都正常），抓到的帧是 scale 倍的像素。
    // 不用 CSS zoom：zoom 之后 100vh 不再等于一屏高，粘性布局会错位。窗口高度多出的 87 是无头窗口自己占掉的
    `--force-device-scale-factor=${scale}`, `--window-size=${width},${height + 87}`] });
  const context = await browser.newContext({ viewport: null, locale: 'zh-CN' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // serve：{ origin, root }，把本地文件夹当成一个网站（请求拦截，不开端口）
  if (serve) {
    const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.json': 'application/json', '.woff2': 'font/woff2' };
    await page.route(serve.origin + '/**', (route) => {
      let f = decodeURIComponent(new URL(route.request().url()).pathname); if (f.endsWith('/')) f += 'index.html';
      const file = join(serve.root, f);
      if (!existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
      route.fulfill({ status: 200, contentType: TYPES[extname(file)] || 'application/octet-stream', body: serve.transform ? serve.transform(f, readFileSync(file)) : readFileSync(file) });
    });
  }
  // captureAudio：页面自己出的声音（Web Audio）在送去扬声器的同时分一路录下来，录成 audio.webm
  const audioPath = join(outDir, 'audio.webm');
  let audioFile = null, audioStartAbs = null;
  if (captureAudio) {
    audioFile = createWriteStream(audioPath);
    await page.exposeFunction('__audioChunk', (b64) => { audioFile.write(Buffer.from(b64, 'base64')); });
    await page.exposeFunction('__audioStart', () => { audioStartAbs = Date.now() / 1000; });
    await page.addInitScript(() => {
      const AC = window.AudioContext; window.__acs = [];
      window.AudioContext = function (...a) { const c = new AC(...a); window.__acs.push(c); return c; }; window.AudioContext.prototype = AC.prototype;
      const dests = new WeakMap(), orig = AudioNode.prototype.connect;
      let chain = Promise.resolve();
      AudioNode.prototype.connect = function (target, ...rest) {
        if (target instanceof AudioDestinationNode) {
          const ac = target.context;
          if (!dests.has(ac)) {
            const d = ac.createMediaStreamDestination(); dests.set(ac, d);
            const rec = new MediaRecorder(d.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192000 });
            rec.onstart = () => window.__audioStart();
            rec.ondataavailable = (e) => { chain = chain.then(async () => {
              const u = new Uint8Array(await e.data.arrayBuffer()); let s = '';
              for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
              await window.__audioChunk(btoa(s));
            }); };
            window.__stopRec = () => new Promise((res) => { rec.onstop = () => setTimeout(() => chain.then(res), 200); rec.stop(); });
            rec.start(2000);
          }
          orig.call(this, dests.get(ac));
        }
        return orig.call(this, target, ...rest);
      };
    });
  }
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(overlay, { hideCss, brand, zoom });
  await page.evaluate(() => document.fonts.ready);
  await sleep(800);

  const cdp = await page.context().newCDPSession(page);
  const FPS = 30;
  const videoPath = join(outDir, 'video.mp4');
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-vf', `scale=${Math.round(width * scale)}:${Math.round(height * scale)}`, '-pix_fmt', 'yuv420p', '-r', String(FPS), videoPath], { stdio: ['pipe', 'inherit', 'inherit'] });
  const ffDone = new Promise((res) => ff.on('close', res));
  let latest = null, written = 0, got = 0, ticker = null;
  cdp.on('Page.screencastFrame', (f) => {
    latest = Buffer.from(f.data, 'base64');
    got++;
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  // 固定帧率：每次看「到现在应该写了多少帧」，用最新的一帧补齐（画面没变时浏览器不发新帧）
  const pump = () => {
    if (!latest) return;
    const due = Math.floor((Date.now() / 1000 - t0) * FPS);
    while (written < due) { ff.stdin.write(latest); written++; }
  };

  const marks = [];
  let t0 = 0;
  const now = () => Date.now() / 1000;
  const ctx = {
    page,
    wait: sleep,
    /** 记一个时间点（配音从这里开始放） */
    mark(id) { marks.push({ id, t: now() - t0 }); },
    say: (text) => page.evaluate((t) => window.__v.sub(t), text || ''),
    card: (html) => page.evaluate((h) => window.__v.card(h), html || ''),
    async scrollTo(target, { ms = 1100, offset = 120 } = {}) {
      // 选择器走 Playwright 的写法（支持 >> nth=1 这类），和 click / move 一致
      const top = typeof target === 'number' ? target
        : await page.locator(target).first().evaluate((el, off) => Math.max(0, el.getBoundingClientRect().top + window.scrollY - off), offset);
      await page.evaluate(([y, d]) => window.__v.scrollTo(y, d), [top, ms]);
      await sleep(120);
    },
    async point(target) {
      if (typeof target !== 'string') return target;
      const box = await page.locator(target).first().boundingBox();
      if (!box) throw new Error('看不到 ' + target);
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    },
    async move(target, ms = 650) {
      const to = await ctx.point(target);
      const from = await page.evaluate(() => ({ x: window.__v.x, y: window.__v.y }));
      const start = from.x < 0 ? { x: width * 0.62, y: height * 0.7 } : from;
      const steps = Math.max(8, Math.round(ms / 16));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const x = start.x + (to.x - start.x) * e, y = start.y + (to.y - start.y) * e;
        await page.evaluate(([px, py]) => window.__v.place(px, py), [x, y]);
        await page.mouse.move(x, y);
        await sleep(ms / steps);
      }
      return to;
    },
    /** 按住拖动：从 from 拖到 to（都是选择器或坐标） */
    async drag(from, to, { ms = 900, after = 300 } = {}) {
      await ctx.move(from, 600);
      await sleep(120);
      await page.evaluate(() => window.__v.ring());
      await page.mouse.down();
      await sleep(120);
      await ctx.move(to, ms);
      await sleep(120);
      await page.mouse.up();
      await sleep(after);
    },
    async click(target, { ms = 650, after = 350 } = {}) {
      const to = await ctx.move(target, ms);
      await sleep(140);
      await page.evaluate(() => window.__v.ring());
      await page.mouse.down();
      await sleep(70);
      await page.mouse.up();
      await sleep(after);
      return to;
    },
  };

  return {
    ctx,
    async start() {
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 1 });
      while (!latest) await sleep(20);
      t0 = now();
      ticker = setInterval(pump, 8);
    },
    async stop() {
      pump();
      clearInterval(ticker);
      const duration = written / FPS;
      await cdp.send('Page.stopScreencast').catch(() => {});
      if (audioFile) { await page.evaluate(() => window.__stopRec?.()).catch(() => {}); await new Promise((r) => audioFile.end(r)); }
      ff.stdin.end();
      await ffDone;
      await browser.close();
      return { videoPath, marks, duration, framesCaptured: got, framesWritten: written, errors, audioPath: audioStartAbs ? audioPath : null, audioStart: audioStartAbs ? audioStartAbs - t0 : null };
    },
  };
}
