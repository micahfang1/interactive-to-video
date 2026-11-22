"""配音：把一批句子用同一段参考录音克隆成人声（IndexTTS-2）。
一般不直接跑，由 lib/voice.mjs 调用：在 IndexTTS-2 仓库目录下、用它的 Python 环境运行
  python <本目录>/lib/tts.py <segments.json> <输出目录>
环境变量 VOICE_REF = 参考录音（十几到三十秒、安静、一个人说话）。
segments.json: [{"id": "s01", "text": "..."}]；每句存成 <id>.wav，文字、参考录音、设置都没变的跳过。

全片听起来要是一个人、一个速度、没有杂音：
1. 音色：所有段落克隆同一段参考录音。
2. 语速：合成后量「每秒几个字」（不算停顿），偏离目标的用变速（不变调）拉回来；句中过长的停顿压短。
3. 杂音：去首尾静音、去低频隆隆声、轻度降噪、各段响度对齐、首尾淡入淡出。
合成有随机性：语速太离谱或音色明显偏了的段落自动重做，最多 TRIES 次，取最接近的一次。
语速按「字」算，是为中文写的；别的语言要改 TARGET_CPS 和计数方式。
"""
import hashlib, json, os, re, subprocess, sys, time, wave
import numpy as np

sys.path.insert(0, os.environ.get("INDEXTTS_DIR") or os.getcwd())
REF = os.environ.get("VOICE_REF", "")
TARGET_CPS = float(os.environ.get("TTS_CPS", "5.0"))  # 目标语速：每秒几个字（不算停顿）
MAX_PAUSE = 0.38  # 句中停顿最长留这么久（秒）
TRIES = 3
VERSION = "idx-v1"  # 改了后处理就加一，旧的缓存作废
PUNCT = re.compile(r"[，。？！、：；\s「」“”（）()…]")


def read_wav(path):
    """任何格式都先让 ffmpeg 转成 24k 单声道再读"""
    raw = subprocess.check_output(["ffmpeg", "-loglevel", "error", "-i", path, "-f", "s16le", "-ac", "1", "-ar", "24000", "-"])
    return np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768, 24000


def write_wav(path, audio, sr):
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())


def tighten(a, sr):
    """去掉首尾静音，句中超过 MAX_PAUSE 的停顿压到 MAX_PAUSE。返回 (音频, 有声时长)"""
    n = int(sr * 0.01)
    fr = a[: len(a) // n * n].reshape(-1, n)
    db = 20 * np.log10(np.sqrt((fr ** 2).mean(1)) + 1e-9)
    loud = db > max(-45.0, np.percentile(db, 95) - 38)
    if not loud.any():
        return a, len(a) / sr
    first, last = np.argmax(loud), len(loud) - np.argmax(loud[::-1])
    keep, run, limit = [], 0, int(MAX_PAUSE * 100)
    for i in range(first, last):
        run = 0 if loud[i] else run + 1
        if run <= limit:
            keep.append(i)
    return np.concatenate([a[i * n:(i + 1) * n] for i in keep]), float(loud[first:last].sum() * n / sr)


def brightness(a, sr):
    """音色亮暗的粗指标：有声帧的频谱质心（Hz）"""
    n = int(sr * 0.02)
    fr = a[: len(a) // n * n].reshape(-1, n)
    rms = np.sqrt((fr ** 2).mean(1))
    spec = np.abs(np.fft.rfft(fr[rms > np.percentile(rms, 60)] * np.hanning(n), axis=1)).mean(0)
    freqs = np.fft.rfftfreq(n, 1 / sr)
    return float((spec * freqs).sum() / spec.sum())


def polish(src, dst, tempo):
    dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src]))
    af = (f"atempo={tempo:.4f},highpass=f=70,lowpass=f=10500,afftdn=nr=10:nf=-50,"
          f"loudnorm=I=-18:TP=-2:LRA=7:linear=true,afade=t=in:d=0.012,afade=t=out:st={max(0, dur / tempo - 0.03):.3f}:d=0.03")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-af", af, "-ar", "48000", "-ac", "1", dst], check=True)


def main(seg_path, out_dir):
    if not os.path.exists(REF):
        sys.exit(f"没有参考录音：{REF or '（没给 VOICE_REF）'}")
    segs = json.load(open(seg_path))
    os.makedirs(os.path.join(out_dir, "raw"), exist_ok=True)
    ref_audio, ref_sr = read_wav(REF)
    ref_bright = brightness(ref_audio, ref_sr)
    ref_id = hashlib.sha256(open(REF, "rb").read()).hexdigest()[:12]
    tts = None
    for s in segs:
        key = hashlib.sha256(f"{VERSION}|{ref_id}|{TARGET_CPS}|{s['text']}".encode()).hexdigest()[:16]
        wav, tag = os.path.join(out_dir, s["id"] + ".wav"), os.path.join(out_dir, s["id"] + ".key")
        if os.path.exists(wav) and os.path.exists(tag) and open(tag).read() == key:
            continue
        if tts is None:
            from indextts.infer_v2 import IndexTTS2
            tts = IndexTTS2(cfg_path="checkpoints/config.yaml", model_dir="checkpoints", use_fp16=False, use_cuda_kernel=False, use_deepspeed=False)
        chars = len(PUNCT.sub("", s["text"]))
        best, tmp = None, os.path.join(out_dir, "raw", s["id"] + ".try.wav")
        for attempt in range(TRIES):
            t = time.time()
            tts.infer(spk_audio_prompt=REF, text=s["text"], output_path=tmp, verbose=False)
            audio, sr = read_wav(tmp)
            audio, voiced = tighten(audio, sr)
            cps, bright = chars / max(voiced, 0.1), brightness(audio, sr)
            score = abs(np.log2(cps / TARGET_CPS)) + abs(bright / ref_bright - 1) / 0.3  # 语速差一倍算 1，亮度差 30% 算 1
            if best is None or score < best[0]:
                best = (score, audio, sr, cps)
            ok = 0.7 < cps / TARGET_CPS < 1.4 and abs(bright / ref_bright - 1) < 0.3
            print(f"  {s['id']} 第{attempt + 1}次 语速{cps:.1f}字/秒 亮度{bright:.0f}Hz（参考{ref_bright:.0f}）{'✓' if ok else '重做'} 用时{time.time() - t:.0f}s", flush=True)
            if ok:
                break
        _, audio, sr, cps = best
        raw = os.path.join(out_dir, "raw", s["id"] + ".wav")
        write_wav(raw, audio, sr)
        tempo = float(np.clip(TARGET_CPS / cps, 0.85, 1.3))
        polish(raw, wav, tempo)
        open(tag, "w").write(key)
        print(f"{s['id']} 语速{cps:.1f}→{cps * tempo:.1f} 变速×{tempo:.2f}  {s['text'][:20]}", flush=True)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
