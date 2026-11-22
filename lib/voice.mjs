// 克隆配音：把一批句子交给 lib/tts.py（IndexTTS-2）合成，返回每句的文件和时长。
// 需要环境变量：
//   INDEXTTS_DIR     IndexTTS-2 仓库的位置（里面有 checkpoints/ 和装好依赖的 .venv）
//   INDEXTTS_PYTHON  可选，默认 $INDEXTTS_DIR/.venv/bin/python
//   HEAVY_LOCK       可选，一个「排队锁」脚本：机器上同时只想跑一个吃显存的任务时用，调用方式是 <锁脚本> <命令...>
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const TTS_PY = resolve(import.meta.dirname, 'tts.py');

/** segments: [{ id, text }]；voiceRef: 参考录音。返回 { [id]: { file, dur } }。已经合成过且没变的不会重做 */
export function synthesize(segments, outDir, voiceRef) {
  const dir = process.env.INDEXTTS_DIR;
  if (!dir) throw new Error('要配音先设 INDEXTTS_DIR（IndexTTS-2 仓库的位置），见 README');
  mkdirSync(outDir, { recursive: true });
  const list = join(outDir, 'segments.json');
  writeFileSync(list, JSON.stringify(segments, null, 1));
  const python = process.env.INDEXTTS_PYTHON || join(dir, '.venv/bin/python');
  const cmd = [python, TTS_PY, list, outDir];
  if (process.env.HEAVY_LOCK) cmd.unshift(process.env.HEAVY_LOCK);
  execFileSync(cmd[0], cmd.slice(1), { cwd: dir, stdio: ['ignore', 'inherit', 'ignore'], env: { ...process.env, VOICE_REF: resolve(voiceRef) } });
  const out = {};
  for (const s of segments) {
    const file = join(outDir, s.id + '.wav');
    out[s.id] = { file, dur: Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString()) };
  }
  return out;
}
