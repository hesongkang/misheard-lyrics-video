# 在 Claude Code 中使用 misheard-lyrics-video 与开工指南

> 本指南与 [`prepare_thing.md`](prepare_thing.md) 互补：那份讲**装依赖**，本份讲**装好之后怎么用起来、怎么开工**。

## 一、定位：这个 skill 在 Claude Code 里怎么跑

`misheard-lyrics-video` 是一个 **agent 技能**（由 `SKILL.md` 驱动），不是一个你手动运行的程序。在 Claude Code 里，它的运行方式是：

- **对话驱动**：你用自然语言下指令，Claude Code（作为 agent 宿主）读取 `SKILL.md` 后自动执行 8 步工作流，按需调用 `scripts/` 下的脚本。
- **走 listenhub CLI 路径**：Claude Code 没有 Cola 的原生 `gen_video` 工具，所以视频生成走 `listenhub openapi` CLI 路径（模型 `doubao-seedance-2-pro`，API Key 认证）。agent 会自动选这条路，你不用干预。依赖自检与安装用 `--host claude`（与 codex 同走 listenhub 代码路径，仅安装目录、companion skill 目录指向 `~/.claude/skills/`）。
- **你只在两个节点交互**：候选门（逐句选空耳）和渲染门（预览后确认渲染）。其余转录、生成、合成、审片都由 agent 自动完成。

**所以：你不需要手动敲脚本命令。** 下文列出命令是为了让你看懂流程、便于排查；实际执行时 agent 会自己跑。

---

## 二、开工前就绪检查

开工前必须满足以下 4 项。前 3 项的安装步骤详见 [`prepare_thing.md`](prepare_thing.md)，这里只给验证方式。

### 1. 依赖已装齐

```bash
bash ~/.claude/skills/misheard-lyrics-video/scripts/check-deps.sh --host claude
```

期望：`SUMMARY: 0 error(s), 0 warning(s), host=claude`。唯一预期的 ERROR 是 listenhub API Key 未配（见第 3 节），其余 `ERROR:` 必须修复。`--host claude` 下 companion skill 检查指向 `~/.claude/skills/`，不会再有误报 WARN。

> `check-deps.sh` 不查 whisper-cpp 和 Chrome，这两项用 `hyperframes doctor --json` 复核，`whisper-cpp` 与 `Chrome` 应为 `ok: true`。

### 2. skill 已装入 Claude Code

```bash
ls ~/.claude/skills/misheard-lyrics-video/SKILL.md
```

存在即已装。若仓库内容更新过，在仓库目录跑一条命令重新同步（`install.sh` 已原生支持 `--claude`，排除规则与 `--cola`/`--codex` 一致，装完自动跑 `check-deps.sh --host claude --soft`）：

```bash
cd /home/hsk/music/misheard-lyrics-video
./install.sh --claude      # 装到 ~/.claude/skills/misheard-lyrics-video
./uninstall.sh --claude    # 卸载
```

### 3. listenhub API Key 已配置（唯一硬阻塞）

```bash
listenhub openapi config show     # 应显示已配置
```

若提示未配置，在 Claude Code 输入框输入（`!` 前缀让命令在当前会话执行）：

```
! listenhub openapi config set-key
```

API Key 可在 ListenHub 控制台获取后在此配置，无需浏览器登录。配置一次后，后续 agent 调用 `listenhub-shot.mjs` 都会自动带认证。

### 4. 重启 Claude Code 会话

Claude Code 在**会话启动时**扫描 `~/.claude/skills/`。若 skill 是本次会话期间才装的，**当前会话看不到它**，需退出重进或 `/clear` 新开会话。

> **配套 skill 检查**：`check-deps.sh` 现已原生支持 `--host claude`，companion skill 检查会指向 `~/.claude/skills/`（Claude Code 实际加载位置）。本机 hyperframes / hyperframes-core / hyperframes-cli / media-use 均已装在此处，故 `--host claude` 不再报 companion WARN。旧版 `--host codex` 会误报 4 条（去 `~/.codex/skills/` 找），现已无需再用。

---

## 三、触发 skill 并开始

会话重启后，任选一种方式触发：

- **自然语言**（推荐）：直接说意图，例如
  > 把这首歌做成空耳 MV：`/home/hsk/music/songs/某某歌.mp3`

- **斜杠命令**：`/misheard-lyrics-video`

agent 会加载 `SKILL.md`，先跑 `check-deps.sh` 自检，然后进入工作流。

**你需要提供的只有一样东西：本地音频文件路径**（mp3 / m4a / wav）。不接受网络下载、不接受 AI 翻唱——只认你自备的本地音频。

---

## 四、开工步骤（8 步工作流）

下文 `<project>` 指项目输出目录（见第 0 步），`<skill-dir>` 在 Claude Code 里是 `~/.claude/skills/misheard-lyrics-video`。

每步标注：🤖 agent 自动 / 👤 你参与。

### 0. 创建项目 🤖

agent 用你的音频初始化一个**独立项目目录**，所有媒体和生成物都放里面，绝不进 skill 仓库：

```bash
node <skill-dir>/scripts/init-project.mjs \
  --audio <song.mp3> \
  --output <输出目录>/<歌名>-空耳MV \
  --title <歌名>
```

项目目录会包含 `source/`（你的音频）、`plan.json`（计划）、`transcript.json`、`shots/`（镜头）、`.work/`（中间产物）等。

### 1. 转录并分组 🤖

用 HyperFrames 的 whisper 引擎做带时间戳的中文 ASR，再归一成逐行候选：

```bash
npx hyperframes transcribe <project>/source/<song-file> \
  --dir <project>/.work/asr --engine whisper --model medium --language zh --json

node <skill-dir>/scripts/group-transcript.mjs \
  --input <project>/.work/asr/transcript.json \
  --output <project>/transcript.json
```

> 首次转录会自动下载 whisper `medium` 模型（约 1.5GB，从 HuggingFace），可能慢。ASR 文本可能出错，agent 会据证据修正歌词文字，但**不改动时间戳**（除非音频证明边界错了）。

### 2. 选段并搭建计划 🤖

默认选「一段主歌 + 一段副歌」，共 60–90 秒。你也可以指定起止时间或起止歌词。据此生成 `plan.json`：

```bash
node <skill-dir>/scripts/create-plan.mjs \
  --project <project> --start <秒> --end <秒>
```

### 3. 写候选并暂停 —— 候选门 👤

agent 为每行写 2–3 个空耳候选（含画面、生成 prompt、评分），然后**展示一张候选表并停下来等你**：

```text
| # | 时间 | 原词 | 候选A | 候选B | 候选C |
```

你可以回答 `1A 2B 3自定义：…`（选候选或自己写）。**此阶段 agent 绝不调用任何视频生成**——这是候选门，由代码层面的内容摘要强制。

### 4. 应用你的选择并锁定 🤖

你回复后，agent 写入每行的 `selected`/`misheard`/`visual`/`prompt`，并锁死内容（写批准摘要）：

```bash
node <skill-dir>/scripts/approve-plan.mjs \
  --project <project> --confirmation "user selected every line in chat"
```

锁定后，任何已批准的时间/字幕/梗/画面/prompt 变化都会让摘要失效，必须回候选门重新确认。**agent 不会替你批准。**

### 5. 生成镜头（付费）🤖

只生成 `missing_shots`。Claude Code 走 listenhub 路径，封装脚本自动检查认证、提交 SeeDance 2.0 Pro、轮询、下载到 `shots/attempts/`：

```bash
node <skill-dir>/scripts/listenhub-shot.mjs \
  --project <project> --shot shot_NN --attempt K
```

> ⚠️ **这一步消耗付费 credits**（参考：5 秒 1080p 9:16 ≈ 233 credits）。生成前 `assert-generation-ready.mjs` 会再校验一次批准摘要——未批准则拒绝放行。原曲是唯一音轨，镜头视频静音。

### 6. 审片 🤖

agent 抽取早/中/晚三帧拼成接触图，用视觉能力逐镜判断：空耳梗是否一目了然、主体/动作对不对、9:16 能不能用、有无违规。每镜最多重试 2 次（共 3 次尝试）。失败重试**只改 prompt 弱点**，不动 `plan.json`：

```bash
bash <skill-dir>/scripts/extract-review-frames.sh \
  <attempt.mp4> <project>/shots/review/shot_NN_attempt_K.jpg

node <skill-dir>/scripts/set-retry-prompt.mjs \
  --project <project> --shot shot_NN --revision 1 --attempt <2|3> \
  --prompt <修复后的prompt> --reason <审片失败原因>

node <skill-dir>/scripts/record-review.mjs \
  --project <project> --shot shot_NN --attempt K --result pass \
  --score <1-5> --reason <小结> --file <attempt.mp4> --select
```

通过的镜头被选中；三次全败则选视觉最佳的一镜，成片标注 `未过审，建议人工重做`。

### 7. 合成并预览 —— 渲染门 👤

冻结字幕字体，生成确定性合成 HTML，跑项目 pin 校验：

```bash
node <skill-dir>/scripts/build-caption-font.mjs --project <project>
node <skill-dir>/scripts/assemble.mjs --project <project>
cd <project>
npm run upgrade:check
npm run check          # 必须 0 error 才能继续
npm run preview
```

`check` 通过后，agent 开 Studio 预览，把含 `#project/<项目目录名>` 的 URL 给你，**问你 revise 还是 render**。你明确答「渲染」才进入下一步。

> 合成规则（写死）：硬切镜头、镜头静音、原曲为唯一音轨、只显示空耳大字字幕。不加转场、不显示原词对照、不加配乐床。

### 8. 渲染并交付 🤖

你确认渲染后：

```bash
cd <project>
npm run render
bash <skill-dir>/scripts/verify-render.sh \
  <project>/renders/video.mp4 <project>/plan.json
```

交付 MP4 + 镜头表（原词 / 空耳 / 选中文件 / 审片结果 / 失败最佳镜）。agent 会告诉你：以后说「重做第 N 镜」可单独回到那一镜，不必重建整个项目。

---

## 五、两道批准门（必读）

整个工作流的安全核心，由 `scripts/lib/project.mjs` 的内容摘要从代码层面强制：

| 门 | 何时 | 谁触发 | 强制方式 |
|---|---|---|---|
| **候选门** | 第 3→4 步 | 你逐句选/改空耳 | `approve-plan.mjs` 写摘要；`assert-generation-ready.mjs` 在每次付费生成前校验，摘要不符就拒绝 |
| **渲染门** | 第 7→8 步 | 你预览后明确说「渲染」 | `npm run check` 通过 + Studio 预览 + 你明确答复 |

**不构成批准的**：沉默、之前一句「做个视频」的泛泛请求、autonomous 模式、预算估算。没有你的逐句选择，绝不生成视频。

**两级摘要的分层失效**：改一镜只把这镜标 `stale`，不迫使其他已通过镜头重新付费生成。自动审片重试只写 `set-retry-prompt.mjs`（独立文件），绝不动 `plan.json`；只有改空耳梗/画面语义/镜头时间才回候选门重新批准。

---

## 六、断点续作

项目可随时中断、随时恢复。恢复时 agent 先跑状态报告：

```bash
node <skill-dir>/scripts/project-status.mjs --project <project-dir>
```

报告根据磁盘实际文件计算阶段（不读手写 status），agent 按报告继续，**绝不从头重来、绝不重复生成已通过镜头**：

- `missing_shots`：只生成缺的镜头。
- `recoverable_shots`：canonical 被删但已选 attempt 还在 → 用 `restore-selected-shots.mjs` 本地恢复，禁止重新生成。
- `stale_shots`：某镜摘要与计划不符 → 只重做这些（下一 revision，用 `--redo`）。
- 批准摘要失效：回到 `plan_draft`，即便磁盘有旧镜头也禁止新生成。

---

## 七、注意事项

- **音频来源**：只接受你自备的本地 mp3/m4a/wav。不下载、不搜索、不做 AI 翻唱，版权风险自担。
- **首次端到端需付费**：`tests/run-all.sh` 用 ffmpeg 合成色块视频跑全流程、不花钱；只有走到第 5 步 `listenhub openapi video create` 才消耗 credits。首次验收须由你提供音频、在候选表逐句确认后单独执行。
- **成片规格写死**：1080×1920、30fps、原曲为唯一音轨、镜头静音硬切、底部空耳大字字幕。不可配置（不做横屏/方形、不做双行字幕、不做画风统一、不做自动发布）。
- **禁区**：不生成低俗、涉政、真人明星丑化/欺骗性的空耳。
- **跑测试确认环境**（不消耗 credits，须在**仓库源目录**跑--`tests/` 在安装 skill 时被排除，skill 安装目录里没有）：
  ```bash
  bash /home/hsk/music/misheard-lyrics-video/tests/run-all.sh
  # 无 HyperFrames CLI 时跳过 T4：
  SKIP_HYPERFRAMES_CHECK=1 bash /home/hsk/music/misheard-lyrics-video/tests/run-all.sh
  ```

---

## 附：快速参考卡

| 你要做 | 什么时候 |
|---|---|
| 提供本地音频路径 | 开工时 |
| `! listenhub openapi config set-key` | 开工前（仅一次） |
| 逐句选空耳 `1A 2B 3自定义：…` | 第 3 步（候选门） |
| 预览后答「渲染」或「改」 | 第 7 步（渲染门） |
| 说「重做第 N 镜」 | 交付后想改某一镜 |
| 仓库更新后 `./install.sh --claude` | 重新安装到 Claude Code |

其余全自动。遇到中断，下次直接说「继续 <项目目录>」，agent 跑 `project-status.mjs` 接着干。

---

## 附：本机环境验证记录（2026-07-30）

在仓库源目录跑 `bash tests/run-all.sh`，T1-T4 全部通过（`ALL TESTS PASSED`）：

| 层 | 内容 | 结果 |
|---|---|---|
| T1 | 静态契约检查（bash -n / node --check / frontmatter / 无媒体无密钥） | ✅ PASS |
| T2 | 状态机单元测试 | ✅ 7/7 全过 |
| T3 | ffmpeg 合成色块视频跑完整生命周期（不消耗 credits） | ✅ PASS |
| T4 | HyperFrames check（Lint / Runtime / Layout / Motion / Contrast） | ✅ 0 error，Contrast 4/4 过 WCAG AA |

T4 用 `npx hyperframes@0.7.83 check` 跑通了合成项目的静态校验，证明 HyperFrames CLI + Chrome 渲染链路在本机正常，`integration.mjs` 生成的合成 HTML 完全合规。

**结论**：脚本逻辑、状态机、摘要门、合成、渲染链路全部就绪。配合 `check-deps.sh`（除 listenhub API Key 未配外全 OK）与 `hyperframes doctor`（whisper-cpp / Chrome 均 ok），环境已可开工，唯一待办仍是 `! listenhub openapi config set-key`。

> T1 出现 `rg: command not found`（ripgrep 未装），但 T1 仍 PASS--脚本有 grep fallback，rg 非必需。想消掉提示可 `sudo apt install ripgrep`，不装不影响。

---

## 附：重新安装到 Claude Code 验证记录（2026-07-31）

项目切换到 listenhub OpenAPI Key 后，把含改动的最新版重新安装到 Claude Code，并新增 `claude` 宿主支持：

| 验证项 | 结果 |
|---|---|
| `./install.sh --claude` 重新安装 | ✅ 装到 `~/.claude/skills/misheard-lyrics-video/` |
| 新装 `listenhub-shot.mjs` 含 `openapi` 改动 | ✅ 4 处（旧版为 0） |
| 新装 `check-deps.sh` 支持 `--host claude` | ✅ |
| `check-deps.sh --host claude --soft` | ✅ `1 error(s), 0 warning(s), host=claude`（companion WARN 误报消除；唯一 ERROR 为 API Key 未配） |
| `bash -n install.sh / uninstall.sh / check-deps.sh` | ✅ 语法 OK |

**本次改动**：`install.sh` / `uninstall.sh` / `check-deps.sh` 新增 `claude` 宿主（与 codex 同走 listenhub 代码路径，安装目录与 companion skill 目录指向 `~/.claude/skills/`）；`README.md` / `CLAUDE.md` 同步 install 用法。

**待办（用户）**：`! listenhub openapi config set-key` 配置 API Key（唯一阻塞，不消耗 credits）。

**已知**：`tests/t1-static.sh` 因仓库内存在 `music/yongqi.mp3`（用户放入、未跟踪）报 `generated/source media is present`。该文件违反仓库卫生契约（仓库内不得有媒体），与本次改动无关；建议把歌曲移出仓库（如 `~/music/songs/`）后再跑 `run-all.sh`。
