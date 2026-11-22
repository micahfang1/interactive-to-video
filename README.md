# interactive-to-video

把动页（可交互的网页作品）做成完整的讲解视频。这是一个 [Claude Code](https://claude.com/claude-code) skill，也可以不经 Claude、直接当命令行工具用。

*Turn an interactive web page (an explorable explanation, a scrollytelling piece) into a full narrated video. You — or Claude — write a short script for the page; a headless browser then walks through it like a reader would (scrolling, clicking, dragging, with a visible cursor) while the screen and the page's own audio are recorded, and narration is added with a cloned voice. Docs are in Chinese.*

![示例：脚本驱动光标拖动滑块，字幕跟着旁白走](docs/demo.gif)

上面这段出自仓库自带的示例，一条命令就能在你机器上录出来（见「五分钟试一下」）。

> **早期版本。** 目前只做过两条完整的片子（5 分 46 秒和 22 分钟），都是作者自己的动页，只在 Apple 芯片的 Mac 上跑过。

做这个的原因：动页要读者亲手操作才好看，视频平台上的人不会点进来操作。把动页录成一条有人讲的视频，发到视频平台，想自己动手的人再点进原作品。出自 [Interflus](https://interflus.com)。

## 它做什么，不做什么

自动的部分：

1. 无头浏览器打开动页，照脚本一步步操作：滚动、点击、拖动。画面上有看得见的光标。
2. 边操作边录屏，1080p、30 帧，同时把页面自己发出的声音录下来。
3. 配人声，合成成片 `out/<名字>.mp4` 和 `.srt` 字幕。

要人（或 Claude）来做的部分：**每件动页写一份脚本**。讲什么、删什么、每句话期间在页面上做什么，都写在脚本里。示例的脚本 60 行，真实的一期大约 200 行。丢一个链接就出片，它做不到。

两类动页，做法不同：

- **讲解型**：动页本身没有人声。另写一份旁白，逐段合成人声，操作跟着旁白的时长走，旁白同时是字幕。
- **自带声音型**：动页自己有原声、音效、字幕。录页面的声音，只给那些只有文字、没有声音的地方补人声。

## 五分钟试一下

需要 Node.js 20 以上和 ffmpeg（含 ffprobe）。

```bash
git clone <本仓库地址> interactive-to-video
cd interactive-to-video
npm install
npx playwright install chromium     # 下载约 600MB
npm run demo                        # 约一分钟，成片在 out/demo.mp4
```

示例是一页「钱多久翻一倍」的小动页（`examples/demo/index.html`）和它的脚本（`examples/demo/demo.mjs`）。没装配音的时候只出字幕、没有人声，用来看画面和节奏正合适。

## 配人声

配音用 [IndexTTS-2](https://github.com/index-tts/index-tts) 克隆一段参考录音。按它的说明克隆仓库、下载模型（约 11GB）、装好依赖，然后告诉本工具它在哪：

```bash
export INDEXTTS_DIR=/path/to/index-tts        # 里面有 checkpoints/ 和 .venv
# export INDEXTTS_PYTHON=/path/to/python      # 可选，默认 $INDEXTTS_DIR/.venv/bin/python
# export HEAVY_LOCK=/path/to/lock.sh          # 可选：机器上同时只想跑一个吃显存的任务时，用它排队
```

参考录音放成当前目录的 `voice/ref.wav`，或用 `VOICE_REF=路径` 指定：十几到三十秒，安静，一个人说话。

设好之后同样的命令就会带人声。想暂时不配，加 `--silent`。

IndexTTS-2 的模型有它自己的许可协议（bilibili Model Use License），用之前自己读一遍。本仓库不包含任何模型和录音。

## 用法

装成 skill：把本仓库克隆到 `~/.claude/skills/interactive-to-video`，然后对 Claude Code 说「把这个动页做成视频」。它会读 [SKILL.md](SKILL.md)，为这件动页写脚本、录制、抽帧核对。

直接用：

```bash
cd 你想放视频的目录        # 中间文件进 ./work，成片进 ./out

# 讲解型
node <本仓库>/lib/make.mjs 我的脚本.mjs --silent           # 先不配音看一版
node <本仓库>/lib/make.mjs 我的脚本.mjs --only open,hook   # 只录某几段
node <本仓库>/lib/make.mjs 我的脚本.mjs                    # 全片

# 自带声音型（脚本自己是入口）
node 我的脚本.mjs --max 60    # 先录开头一分钟
node 我的脚本.mjs
```

脚本怎么写、有哪些坑、出片后要核对什么，都在 [SKILL.md](SKILL.md)。

## 范例

| 文件 | 类型 | 说明 |
|---|---|---|
| `examples/demo/` | 讲解型 | 开箱能跑。8 段旁白，57 秒 |
| `examples/explainer-involution.mjs` | 讲解型 | 《内卷》，32 段旁白，5 分 46 秒 |
| `examples/selfvoiced-jensen.mjs` | 自带声音型 | 《黄仁勋 · 上》，22 分钟，12 个互动自动完成，38 条补配的旁白 |

后两个依赖对应动页的本地文件，照原样跑不起来，是拿来看写法的。

## 局限

- 每件动页都要单独写脚本。互动怎么认、怎么做，没有通用办法。
- 实时录制：片子多长，录制就要多久。
- 配音慢：笔记本上每句几十秒到几分钟。
- 自带声音型要在录制时临时改动页的脚本（按原文匹配）。动页一改，匹配不上会报错，要跟着改。
- 语速对齐是按中文「每秒几个字」算的，别的语言要改 `lib/tts.py`。
- 测试只覆盖字幕切分、时间戳、估时长、空镜统计这些纯函数（`npm test`）。录制和配音靠跑示例来验证。
- Claude 听不了音频：画面它会自己抽帧核对，发音和语气要人来听。

## 关于声音

只克隆你自己的声音，或者你明确拿到授权的声音。合成的旁白和真人原声出现在同一条视频里时，发布时请注明旁白为合成。

## 许可

MIT，见 [LICENSE](LICENSE)。
