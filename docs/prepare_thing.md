# 在 Claude Code 中使用该 skill 工程的准备内容

## 一句话结论

**不需要在 Claude Code 里接入视频生成模型。** 视频生成由外部 `listenhub` CLI 完成，Claude Code 只是通过 `scripts/listenhub-shot.mjs` 起一个 CLI 子进程来调用它。你不用给 Claude Code 配任何视频生成的 MCP server、工具或 API key。

## 视频生成路径

该 skill 设计了两条视频生成路径，Claude Code 只能走第二条：

| 路径 | 怎么生成视频 | Claude Code 是否可用 |
|---|---|---|
| Cola（`host=cola`） | 调 Cola 宿主**内置的 `gen_video` 工具** | ❌ Claude Code 没有这个原生工具 |
| Codex（`host=codex`） | 调外部 **`listenhub` CLI** | ✅ 走这条 |

`scripts/listenhub-shot.mjs` 的实际调用链：

```
listenhub openapi config show                         # 检查 API Key
listenhub openapi video create \
  --model doubao-seedance-2-pro \             # SeeDance 2.0 Pro
  --resolution 1080p --ratio 9:16 \
  --duration <N> --no-generate-audio --json   # 提交生成
# -> 轮询任务 -> 下载 mp4 到 shots/attempts/
```

模型调用（SeeDance 2.0 Pro）封装在 listenhub CLI 内部，与 Claude Code 无关。所以"接入视频生成模型"= **安装 listenhub CLI 并配置 OpenAPI Key**。

## 准备清单

### 1. listenhub CLI（视频生成的关键，必装）

```bash
# 安装（npm 全局包）
npm install -g @marswave/listenhub-cli

# 配置 API Key（交互式；或 export LISTENHUB_API_KEY="lh_sk_..."）
listenhub openapi config set-key

# 验证 API Key 已配置
listenhub openapi config show

# 验证视频生成路径可用（应输出含 doubao-seedance-2-pro 的帮助）
listenhub openapi video create --help
```

> 注意：`api.marswave.ai/openapi` 不可达时切换 `api.listenhub.app/openapi`（或设 `LISTENHUB_OPENAPI_URL`），切换后需重试一次命令。

### 2. HyperFrames CLI（合成 / 渲染 / ASR，必装）

```bash
# 验证版本与 transcribe 子命令
npx --yes hyperframes --version
npx --yes hyperframes transcribe --help   # 应包含 "word-level timestamps"
```

无需手动全局安装，脚本统一用 `npx --yes hyperframes` 拉取。首次运行会下载，稍慢。

### 3. ffmpeg / ffprobe（音频裁剪、抽帧、探针，必装）

```bash
ffmpeg -version
ffprobe -version
# Debian/Ubuntu: sudo apt install ffmpeg
# macOS:         brew install ffmpeg
```

### 4. Node.js 22+（脚本运行时，必装）

```bash
node --version   # 必须 >= 22
npx --version
```

仓库脚本只用 Node 标准库，没有 `node_modules`、无需 `npm install`。

### 5. whisper-cpp（ASR 转录引擎，必装）

HyperFrames 的 `transcribe` 实际依赖 whisper-cpp 引擎（`check-deps.sh` 只检查 `transcribe --help` 的帮助文本，不检查引擎本体，容易漏判）。本 skill 第 1 步 ASR 用 `--engine whisper --model medium`，中文必须用不带 `.en` 的多语种模型。

**编译安装**（需 cmake + C 编译器）：

```bash
BUILD_DIR="$HOME/.cache/hyperframes/whisper/whisper.cpp"
mkdir -p "$(dirname "$BUILD_DIR")"

# github.com 国内直连被拒（connection refused），必须走镜像；gh-proxy.com 实测可用
git clone --depth 1 https://gh-proxy.com/https://github.com/ggml-org/whisper.cpp.git "$BUILD_DIR"

# 编译；产物 build/bin/whisper-cli 会被 hyperframes 的 findBuiltBinary 自动发现
cmake -B "$BUILD_DIR/build" -S "$BUILD_DIR"
cmake --build "$BUILD_DIR/build" --config Release -j
```

> 路径必须放在 `~/.cache/hyperframes/whisper/whisper.cpp`——hyperframes 的 `findBuiltBinary` 只查这个 `BUILD_DIR`。也可改设 `HYPERFRAMES_WHISPER_PATH` 环境变量指向任意 `whisper-cli`。
>
> 若 `gh-proxy.com` 失效，换 `gitclone.com`（用法 `https://gitclone.com/github.com/ggml-org/whisper.cpp.git`）。

**验证**（`check-deps.sh` 不查此项，用 `hyperframes doctor`）：

```bash
hyperframes doctor --json   # whisper-cpp 检查应 ok: true
~/.cache/hyperframes/whisper/whisper.cpp/build/bin/whisper-cli --version   # 应输出 whisper.cpp version
```

**模型**：首次 `transcribe` 时 hyperframes 自动从 HuggingFace 下载到 `~/.cache/hyperframes/whisper/models/ggml-<model>.bin`。`medium`（多语种，约 1.5GB）国内下载可能慢；如卡住可手动从 `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin` 下载放入该目录。

### 6. GitHub 镜像配置（国内网络，按需）

第 5 节 whisper-cpp 和下文配套 skill 的安装都要从 github.com clone 仓库，国内直连通常被拒（`connection refused`）。配一次 git 全局 URL 重写，之后所有 `git clone https://github.com/...` 自动走镜像，无需每次手动加前缀：

```bash
git config --global url."https://gh-proxy.com/https://github.com/".insteadOf "https://github.com/"
```

> 实测可用镜像：`gh-proxy.com`、`gitclone.com`（二选一）。此重写全局生效，影响本机所有 github.com 的 clone——在国内环境下有益无害。撤销：`git config --global --unset url."https://gh-proxy.com/https://github.com/".insteadOf`。
>
> 配了重写后，第 5 节的 clone 命令可直接写 `https://github.com/ggml-org/whisper.cpp.git`，git 会自动改走镜像。

## 验证环境

上述依赖装好后，跑依赖自检（**必过才开工**）：

```bash
bash scripts/check-deps.sh --host codex
```

期望全部 `OK:`、`SUMMARY: 0 error(s)`。`WARN:` 可以容忍（见下文"配套 skill"），`ERROR:` 必须修复。

## 把 skill 装进 Claude Code

`install.sh` 只支持 `--cola` / `--codex` 两个目标目录，**没有 `--claude`**。Claude Code 的 skill 目录是 `~/.claude/skills/`（用户级）或项目级 `.claude/skills/`。需手动同步：

```bash
rsync -a --delete \
  --exclude '.git' --exclude '.gitignore' --exclude '.DS_Store' \
  --exclude 'node_modules' --exclude 'tests' \
  --exclude 'README.md' --exclude 'REQUIREMENTS.md' \
  --exclude 'install.sh' --exclude 'uninstall.sh' \
  /home/hsk/music/misheard-lyrics-video/ \
  ~/.claude/skills/misheard-lyrics-video/
```

排除项与 `install.sh` 的 `sync_skill` 保持一致，避免把测试/交接文档/安装脚本带进 skill 目录。

## 配套 skill（必装）

`SKILL.md` 在运行时按需加载 4 个配套 skill：`hyperframes`、`hyperframes-core`、`hyperframes-cli`、`media-use`（分别提供合成 HTML 契约、CLI 用法、媒体使用合规等指导）。用 HyperFrames 自带命令一键安装：

```bash
hyperframes skills   # 检测到 agent 会非交互安装；装到 ~/.claude/skills/ 与 ~/.agents/skills/
```

> 此命令从 `github.com/heygen-com/hyperframes.git` clone--需先完成上节「GitHub 镜像配置」，否则 `connection refused`。共装 25 个 skill（4 个配套 + 若干通用视频模板），全部复制到 `~/.claude/skills/`。

验证 4 个配套 skill 已就位：

```bash
ls ~/.claude/skills/{hyperframes,hyperframes-core,hyperframes-cli,media-use}/SKILL.md
```

**关于 `check-deps.sh` 的 WARN（可忽略）**：`check-deps.sh --host codex` 查的是 `~/.codex/skills/`，而 Claude Code 实际从 `~/.claude/skills/` 加载。因此即便已装好，自检仍会报 4 条 `WARN: Companion Skill 'xxx' is not installed under ~/.codex/skills`--这是检查脚本只认 cola/codex 两个宿主、对 Claude Code 的盲区，不影响实际开工。只要上面 `ls` 能列出 4 个 `SKILL.md` 即已就绪。

## 跑测试确认

用本地合成媒体跑一遍，**不消耗付费 credits**：

```bash
bash tests/run-all.sh
```

若机器上 HyperFrames CLI 暂时不可用，跳过 T4：

```bash
SKIP_HYPERFRAMES_CHECK=1 bash tests/run-all.sh
```

全过即说明脚本逻辑、状态机、摘要门、合成在你这台机器上正常。

## 使用时的注意事项

- **统一用 `host=codex`**：所有依赖检查、视频生成都走 listenhub 路径，不要试图在 Claude Code 里模拟 Cola 的 `gen_video`。
- **两道批准门照常生效**：候选门（用户逐句确认空耳前绝不生成视频）和渲染门（最终预览确认前绝不渲染）由 `assert-generation-ready.mjs` 的内容摘要从代码层面强制，与宿主无关。
- **首次真实跑通需付费**：`tests/run-all.sh` 用 ffmpeg 合成的色块视频，不花钱；只有用真实歌曲走到 `listenhub openapi video create` 才消耗 credits（参考：5 秒 1080p 9:16 ≈ 233 credits）。首次端到端验收须由你提供音频，并在候选表逐句确认后单独执行。
- **音频来源**：只接受用户自备的本地 mp3/m4a/wav，不做下载、不做 AI 翻唱，版权风险自担。
