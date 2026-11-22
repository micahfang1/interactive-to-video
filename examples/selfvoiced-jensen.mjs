// 自带声音型范例：《黄仁勋 · 上》（Interflus 美漫人物志）。页面自带原声、音效和中英字幕，录的是页面自己的声音；
// 只有打字出来、没有声音的旁白框另外补人声。
// 这份脚本照原样跑不起来（要有这件动页的本地文件），拿来看写法：怎么认互动、怎么做互动、怎么接旁白、怎么压空镜。
// 浏览器像读者一样往下滚；遇到互动就照做一遍（猜、拖、点），做完接着滚。画面和页面的声音一起录。
// 用法：PAGE_ROOT=<动页所在的文件夹> node examples/selfvoiced-jensen.mjs [--max 秒] [--from 位置]
//   --max 只录前面一段；--from 从舞台中间开始（之前的关卡都算走过）。两个都是调试用。
//   旁白框的文字列在 work/jensen/narr/texts.json（一个字符串数组），参考录音用 VOICE_REF 指定。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { openRecorder, sleep } from '../lib/record.mjs';
import { synthesize } from '../lib/voice.mjs';
import { silentGaps } from '../lib/subtitles.mjs';

const ROOT = process.cwd(); // 中间文件进 ./work，成片进 ./out
const args = process.argv.slice(2);
const FROM = args.includes('--from') ? Number(args[args.indexOf('--from') + 1]) : 0; // 调试：从舞台第几个单位开始（之前的关卡都算走过）
const MAX = args.includes('--max') ? Number(args[args.indexOf('--max') + 1]) : Infinity;
const slug = 'jensen', work = join(ROOT, 'work', slug);
mkdirSync(work, { recursive: true }); mkdirSync(join(ROOT, 'out'), { recursive: true });

const W = 1280, H = 720;
// 旁白框的人声：文字 → 文件、时长。有文字清单就先合成（合成过的不会重做），没有清单就不补人声
const NARR_TEXTS = join(work, 'narr', 'texts.json');
const narr = {};
if (existsSync(NARR_TEXTS)) {
  const texts = JSON.parse(readFileSync(NARR_TEXTS, 'utf8'));
  const id = (t) => createHash('sha256').update(t).digest('hex').slice(0, 10);
  const made = synthesize(texts.map((t) => ({ id: id(t), text: t })), join(work, 'narr'), process.env.VOICE_REF || 'voice/ref.wav');
  for (const t of texts) narr[t] = made[id(t)];
}
const TYPE_HEAD = 'function typeInto(el, text, { speed = 42, sound = true } = {}) {';
const rec = await openRecorder({
  url: 'http://pb.local/jensen/web/', outDir: work, captureAudio: true,
  serve: { origin: 'http://pb.local', root: process.env.PAGE_ROOT,
    // 不改动页文件：送给浏览器时在主脚本里多露出关卡表，调试时好从中间开始
    transform: (f, body) => {
      // 端咖啡的小游戏原本 30 秒，视频里只留 15 秒（页面上的说明文字一起改）
      if (f.endsWith('/web/src/scenes/scene2-dawn.js')) return Buffer.from(body.toString().replace('seconds: 30,', 'seconds: 15,').replace('`30 秒，你端出', '`15 秒，你端出'));
      if (f.endsWith('/web/index.html')) return Buffer.from(body.toString().replace('30 秒，能端出去多少杯咖啡', '15 秒，能端出去多少杯咖啡'));
      if (!f.endsWith('/web/src/main.js')) return body;
      const src = body.toString();
      if (!src.includes(TYPE_HEAD)) throw new Error('动页的 typeInto 改过了，旁白接不上');
      return Buffer.from(src
        // 旁白念完到下一步之间的停顿缩短
        .replace('t = setTimeout(() => skipNarr?.(), 900)', 't = setTimeout(() => skipNarr?.(), 400)').replace('.then(() => shown(3200))', '.then(() => shown(700))')
        .replace('const TOTAL = tl.duration();', 'const TOTAL = tl.duration(); window.__gates = GATES; window.__total = TOTAL;')
        // 有人声的旁白：打字声关掉，打字速度跟着人声的时长走（标点处停得久，和原来的规则一样）
        .replace(TYPE_HEAD, TYPE_HEAD + ` const __d = window.__narr && window.__narr[text]; if (__d) { sound = false; const u = [...text].reduce((a, ch) => a + (/[，。、：！？,.]/.test(ch) ? 5 : 1), 0); speed = __d * 1000 / u; window.__typed(text); }`));
    } },
  // 视频里没人能点的东西都收起来
  hideCss: '#soundToggle, #skipHint, #scrollHint, #interactSkip, .task-skip, .fit-hint, #srcOpen, .ad-help { display: none !important; }',
});
const { ctx } = rec, page = ctx.page;
const log = [];
const spoken = []; // 旁白开口的时间点
let narrUntil = 0;
await page.exposeFunction('__typed', (text) => { ctx.mark(text); spoken.push(text); narrUntil = Date.now() + narr[text].dur * 1000 + 350; });
const clips = []; // 原声每一段的起止（查空镜用）
await page.exposeFunction('__ev', (kind) => { const t = (Date.now() - t0) / 1000; if (kind === 'play') clips.push([t, null]); else if (clips.length && clips[clips.length - 1][1] === null) clips[clips.length - 1][1] = t; });
await page.evaluate((n) => { window.__narr = n; }, Object.fromEntries(Object.entries(narr).map(([k, v]) => [k, v.dur])));
const t0 = Date.now();
const note = (m) => { const t = ((Date.now() - t0) / 1000).toFixed(1); log.push([+t, m]); console.log(t, m); };

/** 光标沿一串点走（拖动用）；每步之间隔 stepMs */
async function path(points, stepMs = 16) {
  for (const [x, y] of points) { await page.evaluate(([a, b]) => window.__v.place(a, b), [x, y]); await page.mouse.move(x, y); if (stepMs) await sleep(stepMs); }
}
const line = (a, b, n) => Array.from({ length: n }, (_, i) => [a[0] + (b[0] - a[0]) * (i + 1) / n, a[1] + (b[1] - a[1]) * (i + 1) / n]);
const center = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
async function dragTo(from, to, n = 30) {
  await ctx.move({ x: from[0], y: from[1] }, 600); await sleep(150);
  await page.evaluate(() => window.__v.ring()); await page.mouse.down(); await sleep(150);
  await path(line(from, to, n), 22); await sleep(150); await page.mouse.up();
}

// 每个互动：怎么认出来（页面里跑的判断）+ 怎么做
const INTERACTIONS = [
  { id: 'guess', when: '#guessCard.live', run: async () => { await sleep(1800); await ctx.click('[data-guess="yes"]'); } },
  { id: 'chore', when: '#choreCard.live', run: async () => { await sleep(2000); await ctx.click('[data-chore="kitchen"]'); } },
  { id: 'tapes', when: '#tapeDesk.live', run: async () => { await sleep(1200); for (let i = 0; i < 8; i++) { await ctx.click('#tapeSend', { ms: i ? 80 : 650, after: 250 }); } } },
  { id: 'route', when: '#s-route', wait: 120, run: async () => {} }, // 骑车送报的片段自己放完
  { id: 'coffee', when: '#cfGo', run: async () => {
    await sleep(1800); await ctx.click('#cfGo');
    const y = H * 0.72, bar = [W * 0.85, y], booth = [W * 0.12, y], end = Date.now() + 15300;
    await ctx.move({ x: bar[0], y }, 400); await page.mouse.down();
    while (Date.now() < end) {
      await sleep(2000); await path(line(bar, booth, 45), 22); await sleep(1700); await path(line(booth, bar, 45), 22);
    }
    await page.mouse.up();
  } },
  { id: 'adder', when: '#s-adder', wait: 40, run: async () => {
    await sleep(1800);
    await dragTo(await center('.gate-chip[data-gate="XOR"]'), await center('.slot[data-slot="S"]'), 22); await sleep(500);
    await dragTo(await center('.gate-chip[data-gate="AND"]'), await center('.slot[data-slot="C"]'), 22); await sleep(500);
    await ctx.click('[data-in="A"]'); await sleep(600); await ctx.click('[data-in="B"]');
    await sleep(3200); await page.evaluate(() => document.querySelector('#adSkip').click()); // 视频里只做第一题，第二题（4 位加法器）略过
  } },
  { id: 'masters', when: '#mastersGuess', run: async () => { await sleep(1800); await ctx.click('[data-years="4"]'); } },
  { id: 'pixels', when: '#s-pixels', wait: 30, run: async () => {
    await sleep(2200);
    const h = await center('#pxHandle'), s = await page.locator('#pxScreen').boundingBox();
    await dragTo(h, [h[0] - (h[0] - s.x) * 0.3, h[1] - (h[1] - s.y) * 0.3], 25); await sleep(1300);
    const h2 = await center('#pxHandle');
    await dragTo(h2, [s.x + s.width * 0.1, s.y + s.height * 0.1], 40);
  } },
  { id: 'plan', when: '#planCard.live', run: async () => { await sleep(2600); await ctx.click('[data-plan="write"]'); } },
  { id: 'teapot', when: '#s-teapot .crt:not(.await-gate)', wait: 30, run: async () => {
    await sleep(2000);
    const b = await page.locator('#tris').boundingBox(), c = [b.x + b.width / 2, b.y + b.width / 2], R = b.width * 0.36, pts = [];
    for (let a = -Math.PI / 2; a < -Math.PI / 2 + Math.PI * 2 * 3.2; a += 0.08) pts.push([c[0] + R * Math.cos(a), c[1] + R * Math.sin(a)]);
    await ctx.move({ x: pts[0][0], y: pts[0][1] }, 600); await page.mouse.down(); await path(pts, 20); await page.mouse.up();
  } },
  { id: 'choice', when: '#s-choice .choice-card:not(.await-gate)', run: async () => { await sleep(4500); await ctx.click('[data-choice="finish"]'); } },
  { id: 'sheet', when: '#sheetGame', wait: 30, run: async () => {
    await sleep(3500); await ctx.click('[data-run="direct"]'); await sleep(5000);
    await ctx.click('[data-run="emu"]'); await sleep(4000);
    await ctx.click('#sgMany'); await sleep(2800); await ctx.click('#sgDone');
  } },
];

const state = () => page.evaluate((list) => {
  const vis = (el) => { if (!el || el.hidden) return false; for (let e = el; e && e !== document.body; e = e.parentElement) { const s = getComputedStyle(e); if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity < 0.4) return false; } return el.getBoundingClientRect().width > 0; };
  return {
    waiting: document.querySelector('#interactSkip').classList.contains('show'),
    which: list.find(([, sel]) => vis(document.querySelector(sel)))?.[0] || null,
    typing: [...document.querySelectorAll('.caption .cursor, .narr .cursor, #teaser .cursor')].some((c) => vis(c.parentElement)),
    y: scrollY, max: document.documentElement.scrollHeight - innerHeight,
  };
}, INTERACTIONS.map((i) => [i.id, i.when]));

await page.evaluate(() => { const P = HTMLMediaElement.prototype.play; window.__els = new Set(); HTMLMediaElement.prototype.play = function () { if (!window.__els.has(this) && this.tagName === 'AUDIO') { this.addEventListener('playing', () => { if (this.src.startsWith('blob:')) window.__ev('play'); }); this.addEventListener('ended', () => window.__ev('end')); } window.__els.add(this); return P.call(this); }; });
let dbgAt = Date.now(), lastSig = '', dbgT = 0;
await page.evaluate(() => { window.__probe = () => ({ ac: (window.__acs || []).map((a) => [a.state, +a.currentTime.toFixed(1)]), els: [...window.__els].filter((e) => e.tagName === 'AUDIO').map((e) => [+e.currentTime.toFixed(1), e.paused, e.readyState, e.networkState, e.ended, e.seeking, +(e.duration || 0).toFixed(1)]) }); });
// 保护：原声被外部按了暂停（没播完、也不是页面自己收的尾）就立刻续播，并记一笔
await page.evaluate(() => { window.__rescued = 0; setInterval(() => { for (const e of window.__els) if (e.tagName === 'AUDIO' && e.paused && !e.ended && e.readyState >= 2 && e.src.startsWith('blob:') && !(e.duration && e.currentTime > e.duration - 0.25)) { window.__rescued++; e.play().catch(() => {}); } }, 150); });
await rec.start();
await sleep(1200);
if (FROM) await page.evaluate((u) => { for (const g of window.__gates) if (g.at < u) g.done = true; }, FROM);
await ctx.click('[data-sound="on"]');
if (FROM) { await page.evaluate((u) => window.scrollTo(0, u / window.__total * (document.documentElement.scrollHeight - innerHeight)), FROM); await sleep(1500); console.log('关卡', JSON.stringify(await page.evaluate(() => window.__gates.map((g) => +g.at.toFixed(2))))); }
await ctx.move({ x: W * 0.9, y: H * 0.86 }, 500); // 光标停在角落，不挡画面
const done = new Set();
let typingSince = Date.now(), readUntil = 0, atEnd = 0, stuck = 0, lastY = -1;
while ((Date.now() - t0) / 1000 < MAX) {
  const s = await state();
  // 看门狗：没在等互动、页面没动、原声也没在走，持续 40 秒就是卡死了，停下来重录
  const sig = JSON.stringify([s.y, s.waiting, s.typing, await page.evaluate(() => [...window.__els].map((e) => e.currentTime.toFixed(1)))]);
  if (process.env.DEBUG && Date.now() - dbgT > 3000) { dbgT = Date.now(); note(JSON.stringify(await page.evaluate(() => window.__probe()))); }
  if (sig !== lastSig || s.waiting) { lastSig = sig; dbgAt = Date.now(); }
  else if (Date.now() - dbgAt > 40000 && s.y < s.max - 2) { note('卡住了：' + sig); process.exitCode = 3; break; }
  if (s.waiting) {
    const it = INTERACTIONS.find((i) => i.id === s.which && !done.has(i.id));
    if (it) {
      note('互动 ' + it.id); done.add(it.id);
      try { await it.run(); } catch (e) { note(`互动 ${it.id} 出错：${e.message.split('\n')[0]}`); await page.mouse.up(); }
      await ctx.move({ x: W * 0.9, y: H * 0.86 }, 500);
      // 做完等它自己收场；超时没收场就按页面的「跳过」
      const limit = Date.now() + (it.wait || 20) * 1000;
      while ((await state()).waiting && Date.now() < limit) await sleep(300);
      if ((await state()).waiting) { note(`互动 ${it.id} 没自己结束，跳过`); await page.evaluate(() => document.querySelector('#interactSkip').click()); }
    } else {
      stuck++;
      if (stuck > 150) { note('认不出的互动，跳过：' + s.which); await page.evaluate(() => document.querySelector('#interactSkip').click()); stuck = 0; }
      await sleep(300);
    }
    continue;
  }
  stuck = 0;
  if (s.typing && Date.now() - typingSince < 30000) { readUntil = Date.now() + 700; await sleep(150); continue; } // 最多等 15 秒，免得一个没打完的字幕把全片卡住
  if (!s.typing) typingSince = Date.now(); // 字还在打：等它打完，再留一点时间读
  if (Date.now() < Math.max(readUntil, narrUntil)) { await sleep(120); continue; } // 旁白还没念完也等
  if (s.y >= s.max - 2) { if (!atEnd) { atEnd = Date.now(); note('滚到底'); } if (Date.now() - atEnd > 3500) break; await sleep(200); continue; }
  atEnd = 0;
  await page.mouse.wheel(0, 120); await sleep(110);
  if (Math.abs(s.y - lastY) > 400) { lastY = s.y; note(`位置 ${(s.y / s.max * 100).toFixed(0)}%`); }
}
await ctx.card('<h1>黄仁勋 · 上</h1><p>这是一件可以自己动手的作品，完整版在</p><b>interflus.com</b>');
await sleep(3200);
const rescued = await page.evaluate(() => window.__rescued);
note('被暂停后续播的次数：' + rescued);
const res = await rec.stop();
console.log(`录完：${res.duration.toFixed(1)} 秒，抓到 ${res.framesCaptured} 帧，声音从 ${res.audioStart?.toFixed(2)} 秒开始，页面报错 ${res.errors.length}`, res.errors.slice(0, 3));

// 空镜报告：没有原声、也没有旁白的时段（超过 5 秒的列出来）
clips.forEach((c, i) => { if (c[1] === null) c[1] = clips[i + 1] ? clips[i + 1][0] : res.duration; }); // 没等到结束事件的，算到下一段开始
const gaps = silentGaps([...clips, ...res.marks.map((m) => [m.t, m.t + narr[m.id].dur])], res.duration);
const during = (a, b) => log.filter(([t, m]) => t >= a - 1 && t <= b && m.startsWith('互动')).map(([, m]) => m.slice(3)).join(',');
console.log('没人说话的时段：' + gaps.map(([a, b]) => `${a.toFixed(0)}–${b.toFixed(0)}（${(b - a).toFixed(0)}秒${during(a, b) ? ' ' + during(a, b) : ''}）`).join('  '));
console.log('合计', gaps.reduce((n, [a, b]) => n + b - a, 0).toFixed(0), '秒；旁白念了', res.marks.length, '条');
writeFileSync(join(work, 'log.json'), JSON.stringify({ log, clips, gaps, marks: res.marks, duration: res.duration, audioStart: res.audioStart, errors: res.errors }, null, 1));

const out = join(ROOT, 'out', `${slug}${MAX < Infinity || FROM ? '-part' : ''}.mp4`);
if (res.audioPath) {
  const ins = res.marks.flatMap((m) => ['-i', narr[m.id].file]);
  const fc = [`[1:a]aresample=48000,volume=${process.env.PAGE_GAIN || 1}[p]`, ...res.marks.map((m, i) => `[${i + 2}:a]adelay=${Math.round(m.t * 1000)}:all=1[n${i}]`),
    `[p]${res.marks.map((_, i) => `[n${i}]`).join('')}amix=inputs=${res.marks.length + 1}:normalize=0,alimiter=limit=0.9[a]`].join(';');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', res.videoPath, '-itsoffset', res.audioStart.toFixed(3), '-i', res.audioPath, ...ins, '-filter_complex', fc,
    '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '24', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out], { stdio: 'inherit' });
} else execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', res.videoPath, '-c', 'copy', out], { stdio: 'inherit' });
console.log('成片：', out);
