# misheard-lyrics-video

把用户自己的歌曲音频做成一条 60–90 秒、1080×1920 的空耳沙雕 MV。

每句歌词先变成 2–3 个谐音候选；用户逐句确认后，Skill 才会调用
SeeDance 2.0 Pro 生成镜头。成片使用原曲、硬切镜头和底部空耳大字字幕。

## 笑点怎么成立

```text
原曲旋律唤起记忆
    ↓
唱到那一刻出现“词不对”的空耳字幕
    ↓
AI 画面一本正经地执行错词的字面意思
```

比如“可能从此以后”可以写成“可能葱刺以后”，画面是一名武士拿着巨型大葱冲刺。
原曲、字幕对轴和字面具象化缺一不可。

## 安装

### Cola 一键安装

```bash
work_dir="$(mktemp -d /tmp/misheard-lyrics-video.XXXXXX)" && git clone https://github.com/huntingrin/misheard-lyrics-video.git "$work_dir/repo" && "$work_dir/repo/install.sh" --cola && rm -r "$work_dir"
```

安装完成后必须重启 Cola，技能列表才会重新扫描。

### Codex 或双宿主

```bash
./install.sh --codex  # ~/.codex/skills/misheard-lyrics-video
./install.sh --cola   # ~/.cola/skills/misheard-lyrics-video
./install.sh --all    # 两边都装
```

卸载：

```bash
./uninstall.sh --all
```

## 依赖

- Node.js 22 或更新版本
- `npx`
- FFmpeg 与 ffprobe
- HyperFrames CLI，含 `transcribe`、`check`、`preview`、`render`
- Cola 路径：宿主内置 `gen_video`
- 非 Cola 路径：已配置 API Key 的 ListenHub CLI

检查当前环境：

```bash
bash scripts/check-deps.sh --host cola
bash scripts/check-deps.sh --host codex
```

## 使用

在 Cola 中直接说：

```text
用这首歌做个空耳视频
```

并附上本地 `mp3`、`m4a` 或 `wav`。在 Codex 中可显式调用：

```text
$misheard-lyrics-video 用 /path/to/song.mp3 做一条空耳视频
```

默认流程：

1. ASR 对轴并选择一段主歌加一段副歌。
2. 为每句生成 2–3 个空耳候选。
3. 暂停，让用户逐句选择或改写。
4. 只在确认后生成视频镜头。
5. 每镜 Vision 审片；最多重试两次。
6. HyperFrames 合成、检查和最终预览。
7. 用户确认最终预览后才渲染 MP4。

中断后再次指向已有输出目录即可恢复。`plan.json` 锁定确认内容，
`shots/review.json` 记录每次审片；已有合格镜头不会重复生成。

## 输出

```text
<output>/<歌名>-空耳MV/
├── project.json
├── source/song.<ext>
├── transcript.json
├── plan.json
├── shots/
│   ├── attempts/
│   ├── review/
│   ├── review.json
│   └── shot_01.mp4 ...
├── assets/fonts/
├── index.html
└── renders/video.mp4
```

成片固定为 1080×1920、30fps、原曲音轨、底部白色粗体空耳字幕。画风随梗变化，
不提供画风统一、预算模式、文生图降级、双行字幕或横屏输出。

## 开发与测试

```bash
bash tests/run-all.sh
```

快速测试使用本地合成媒体，不消耗视频生成 credits。真实歌曲的付费端到端验收必须由用户
提供音频，并在候选表明确确认后单独执行。

本仓库不会收录歌曲、生成镜头、成片、密钥或 token。用户应确保自己有权使用提供的音频。

