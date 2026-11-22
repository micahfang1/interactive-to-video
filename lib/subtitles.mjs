// 字幕相关的纯函数（好单独测试）。

/** 一段旁白切成几条字幕：按标点断开，短的并到一起，每条不超过 max 个字 */
export function subtitleChunks(text, max = 22) {
  const parts = text.split(/(?<=[。！？；，、：])/).map((p) => p.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last && (last + p).length <= max && !/[。！？]$/.test(last)) out[out.length - 1] = last + p;
    else out.push(p);
  }
  return out.map((c) => c.replace(/[，、；：。]$/, ''));
}

/** 秒 → SRT 时间戳 00:00:00,000 */
export function srtStamp(t) {
  const ms = Math.round(t * 1000), p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
}

/** [{ from, to, text }] → SRT 文件内容 */
export function toSrt(subs) {
  return subs.map((s, i) => `${i + 1}\n${srtStamp(s.from)} --> ${srtStamp(s.to)}\n${s.text}\n`).join('\n');
}

/** 不配音时估一段旁白要念多久：按每秒 4.5 个字，标点各停一下，最短 1.2 秒 */
export function estimateDuration(text) {
  const chars = text.replace(/[，。？！、：；\s「」“”（）()…]/g, '').length;
  const pauses = (text.match(/[，、：；]/g) || []).length * 0.15 + (text.match(/[。？！]/g) || []).length * 0.3;
  return Math.max(1.2, chars / 4.5 + pauses);
}

/**
 * 找出「没人说话」的时段。busy: [[开始, 结束], ...]（可以重叠、乱序），total: 全片时长，min: 短于它的不算。
 * 返回 [[开始, 结束], ...]
 */
export function silentGaps(busy, total, min = 5) {
  const gaps = [];
  let cur = 0;
  for (const [a, b] of [...busy].sort((x, y) => x[0] - y[0])) {
    if (a - cur > min) gaps.push([cur, a]);
    cur = Math.max(cur, b);
  }
  if (total - cur > min) gaps.push([cur, total]);
  return gaps;
}
