// 把一份「视频脚本」做成成片：先合成每段旁白拿到时长 → 按时长驱动浏览器操作并录屏 → 把旁白按时间点合进视频、另出字幕文件。
// 用法：node <本目录>/lib/make.mjs <脚本>.mjs [--silent] [--from 段id] [--only 段id,段id]（后两个只为调试某几段，出的是片段）
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openRecorder, sleep } from './record.mjs';
import { synthesize } from './voice.mjs';
import { estimateDuration, subtitleChunks, toSrt } from './subtitles.mjs';

const ROOT = process.cwd(); // 中间文件进 ./work，成片进 ./out
const args = process.argv.slice(2);
const scriptPath = resolve(args[0]);
const opt = (name) => { const i = args.indexOf(name); return i > 0 ? args[i + 1] : null; };
const script = (await import(pathToFileURL(scriptPath).href)).default;
const slug = script.slug || basename(scriptPath, '.mjs');
const work = join(ROOT, 'work', slug);
mkdirSync(join(work, 'tts'), { recursive: true });
mkdirSync(join(ROOT, 'out'), { recursive: true });

let segs = script.segments;
if (opt('--only')) { const ids = opt('--only').split(','); segs = segs.filter((s) => ids.includes(s.id)); }
if (opt('--from')) { const i = segs.findIndex((s) => s.id === opt('--from')); segs = segs.slice(i); }

// 1. 旁白
const spoken = segs.filter((s) => s.say).map((s) => ({ id: s.id, text: s.tts || s.say }));
// 没装配音（没设 INDEXTTS_DIR）或带了 --silent：不合成人声，按字数估每段的时长，出一版只有字幕的。配音很慢，先这样看节奏很合算
const silent = args.includes('--silent') || !process.env.INDEXTTS_DIR;
if (silent && spoken.length) console.log('不配音：按字数估时长，只出字幕。要人声请设 INDEXTTS_DIR（见 README）并去掉 --silent');
// 参考录音：脚本里的 voice，没写就用当前目录的 voice/ref.wav
const voiced = spoken.length && !silent ? synthesize(spoken, join(work, 'tts'), process.env.VOICE_REF || script.voice || 'voice/ref.wav') : {};
for (const s of segs) s.dur = !s.say ? 0 : silent ? estimateDuration(s.tts || s.say) : voiced[s.id].dur;

// 2. 录屏
// 地址可以写成相对脚本文件的路径（本地动页）
const url = /^[a-z]+:/i.test(script.url) ? script.url : pathToFileURL(resolve(dirname(scriptPath), script.url)).href;
const rec = await openRecorder({ url, outDir: work, hideCss: script.hideCss, brand: script.brand });
const { ctx } = rec;
if (script.setup) await script.setup(ctx);
await rec.start();
const subs = [];
const clock = () => performance.now() / 1000;
const start = clock();
for (const s of segs) {
  const t0 = clock();
  const elapsed = () => clock() - t0;
  const helper = {
    dur: s.dur,
    /** 等到旁白说到 frac 处（0–1） */
    at: async (frac) => { const left = frac * s.dur - elapsed(); if (left > 0) await sleep(left * 1000); },
    elapsed,
  };
  let captions = Promise.resolve();
  if (s.say) {
    ctx.mark(s.id);
    const chunks = subtitleChunks(s.say);
    const total = chunks.reduce((n, c) => n + c.length, 0);
    captions = (async () => {
      let acc = 0;
      for (const c of chunks) {
        const from = (acc / total) * s.dur;
        acc += c.length;
        const to = (acc / total) * s.dur;
        const wait = from - elapsed();
        if (wait > 0) await sleep(wait * 1000);
        subs.push({ from: t0 - start + from, to: t0 - start + to, text: c });
        await ctx.say(c);
      }
      const rest = s.dur - elapsed();
      if (rest > 0) await sleep(rest * 1000);
      await ctx.say('');
    })();
  }
  process.stdout.write(`▶ ${s.id} ${s.dur.toFixed(1)}s ${(s.say || '').slice(0, 20)}\n`);
  await Promise.all([captions, s.run ? s.run(ctx, helper) : null]);
  await sleep((s.gap ?? 0.35) * 1000);
}
const res = await rec.stop();
console.log(`录完：${res.duration.toFixed(1)} 秒，抓到 ${res.framesCaptured} 帧，写入 ${res.framesWritten} 帧，页面报错 ${res.errors.length}`, res.errors.slice(0, 3));

// 3. 合成：旁白按时间点放好，混成一条音轨，再和画面合在一起
const out = join(ROOT, 'out', `${slug}${opt('--only') || opt('--from') ? '-part' : ''}.mp4`);
const marks = res.marks;
if (marks.length && !silent) {
  const inputs = marks.flatMap((m) => ['-i', join(work, 'tts', m.id + '.wav')]);
  const filters = marks.map((m, i) => `[${i + 1}:a]adelay=${Math.round(m.t * 1000)}:all=1[a${i}]`).join(';');
  const mix = `${marks.map((_, i) => `[a${i}]`).join('')}amix=inputs=${marks.length}:normalize=0,volume=1.6dB,alimiter=limit=0.89[a]`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', res.videoPath, ...inputs, '-filter_complex', `${filters};${mix}`,
    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out], { stdio: 'inherit' });
} else {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', res.videoPath, '-c', 'copy', out], { stdio: 'inherit' });
}
writeFileSync(out.replace(/\.mp4$/, '.srt'), toSrt(subs));
writeFileSync(join(work, 'marks.json'), JSON.stringify({ marks, subs, duration: res.duration }, null, 1));
// 时间轴：每段旁白在成片里从几分几秒开始，写发布信息（B 站 / YouTube 的章节）时用
const mmss = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const sayOf = Object.fromEntries(segs.map((s) => [s.id, s.say || '']));
writeFileSync(out.replace(/\.mp4$/, '-时间轴.txt'), marks.map((m) => `${mmss(m.t)}  ${m.id}  ${sayOf[m.id].slice(0, 30)}`).join('\n') + '\n');
console.log('成片：', out);
