# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 这是什么

这是一个 **Skill**（`SKILL.md` 驱动的 agent 技能），不是一个传统应用。仓库交付两部分：

- `SKILL.md` — agent 宿主（Cola 或 Codex）读取的主指令文档，定义 8 步空耳 MV 生成工作流。
- `scripts/` — 把工作流中"能确定化的步骤"做成零依赖的 Node ESM（`.mjs`）和 bash 脚本。

三宿主：Cola 用内置 `gen_video` 工具生成视频（host=cola）；Codex 与 Claude Code 用 `listenhub` CLI（host=codex/claude，二者代码路径相同，都走 `listenhub openapi`，仅安装目录与 companion skill 目录不同）。模型固定 `doubao-seedance-2-pro`。成片规格写死：1080×1920、30fps、原曲为唯一音轨、镜头静音硬切、底部空耳大字字幕。

仓库本身**没有 `package.json`、没有构建步骤、没有运行时依赖**——脚本只用 Node 22+ 标准库 + `ffmpeg`/`ffprobe` + HyperFrames CLI（+ 可选 `listenhub`）。`node_modules` 不应存在。

## 常用命令

```bash
# 依赖自检（开工前必跑）
bash scripts/check-deps.sh --host cola     # 或 codex

# 全量测试（T1 静态 + T2 单元 + T3 合成集成 + T4 HyperFrames check）
bash tests/run-all.sh

# 跳过需要 HyperFrames CLI 的 T4（无该 CLI 时）
SKIP_HYPERFRAMES_CHECK=1 bash tests/run-all.sh

# 单独跑某一层
bash tests/t1-static.sh                       # bash -n / node --check / frontmatter / 无媒体无密钥
node --test tests/unit.test.mjs               # 状态机单元测试
node tests/integration.mjs --output <dir>     # 用 ffmpeg 合成色块视频跑完整生命周期，不消耗付费 credits

# 安装到宿主技能目录（rsync 同步，排除 tests/README/REQUIREMENTS/install 脚本）
./install.sh --cola        # ~/.cola/skills/misheard-lyrics-video（装完需重启 Cola）
./install.sh --codex       # ~/.codex/skills/misheard-lyrics-video
./install.sh --claude      # ~/.claude/skills/misheard-lyrics-video（装完需重启 Claude Code 会话）
./install.sh --all
```

脚本统一支持 `--json` 输出机器可读结果；缺参/校验失败时退码非零并打印 `ERROR:`/`BLOCKED:`。

## 核心架构

### `scripts/lib/project.mjs` 是唯一事实源

所有 plan 校验、内容摘要、批准门逻辑都集中在这一个模块里；`scripts/*.mjs` 基本都是薄 CLI 包装。改任何状态机或校验规则，**只改这里**。关键导出：`validatePlan`、`assertPlanApproved`、`computePlanDigest`、`computeShotDigest`、`getEffectivePrompt`。

### 两道批准门由内容摘要强制

这是整个设计的关键，理解它才能正确改动：

1. **候选门（candidate gate）**：`computePlanDigest` 覆盖整个 `plan.json`（除 `approval` 字段本身）。`approve-plan.mjs` 写入摘要；之后任何生成相关内容（候选选择、字幕、基础 prompt、片段、镜头时间）变化都会使摘要失效。`assert-generation-ready.mjs` 在每次付费生成前调用 `assertPlanApproved`——摘要不匹配就拒绝放行，**从而从代码层面保证"用户确认前绝不生成视频"**。
2. **渲染门（render gate）**：`npm run check` 通过后必须开 Studio 预览并等用户明确回复才 `npm run render`。

**两级摘要的分层失效**是另一关键点：`computeShotDigest` 只覆盖单镜的 `misheard`/`visual`/`prompt`/`generation_duration_s`。改一镜只把这一镜标为 `stale`，**不会迫使其他已通过镜头重新付费生成**。自动审片重试只改 prompt，必须用 `set-retry-prompt.mjs` 写入独立的 `shots/retry-prompts.json`，**绝不动 `plan.json`**；只有改的是空耳梗/画面语义/镜头时间时，才回用户确认并重新批准。

### 状态由磁盘事实派生

`project-status.mjs` 不读任何手写 status 字段，而是根据实际文件计算阶段：

```
initialized → transcribed → plan_draft → approved
→ generating / reviewing / recovering / stale → ready_to_assemble → assembled → rendered
```

恢复项目时先跑 `project-status.mjs`，按报告的阶段继续，**绝不从头重来、绝不重复生成已通过镜头**：
- `missing_shots`：生成。
- `recoverable_shots`：canonical 被删但已选 attempt 还在，用 `restore-selected-shots.mjs` 本地恢复，禁止重新生成。
- `stale_shots`：某镜摘要与当前计划不符，只重做这些（下一个 revision）。
- 批准摘要失效：阶段回到 `plan_draft`，即便磁盘上有旧镜头也禁止新生成。

### 输出是一个自包含的 HyperFrames 项目

`init-project.mjs` 在输出目录生成独立的 `package.json`（含 `check`/`preview`/`render`/`upgrade:check` 脚本，pin 住 HyperFrames 版本）。合成由 `assemble.mjs` 生成 `index.html`（视频/音频必须是 root 直接子元素、`data-*` 声明时间轴、确定性 GSAP timeline、禁用 `Math.random()`/`Date.now()`/`repeat:-1`）。`npm run check` 必须 0 error 才能渲染。

### 项目 JSON 结构

详见 `references/project-schema.md`。`plan.json`（含 `approval` 摘要）、`shots/review.json`（每次尝试都保留，不删失败记录）、`shots/retry-prompts.json`、`shots/generation.json` 是断点续作的事实源。**所有路径在项目内以相对路径存储，禁止写入个人绝对路径。**

## 工作流与约束

`SKILL.md` 是工作流的权威；`references/*.md` 按阶段按需加载（workflow / misheard-writing / video-prompts / review / composition / project-schema）。改工作流时同步改 `SKILL.md` 与对应 reference。

硬约束（来自 `REQUIREMENTS.md` §3、§8，已拍板不要重新发明）：
- 只接受用户自备的本地音频（mp3/m4a/wav）；不下载、不搜索、不做 AI 翻唱。
- 只显示空耳歌词，不显示原词对照；字幕样式写死不可配置。
- 每镜必须文生视频，不静默降级为文生图+运镜；画风随梗走、跨镜不一致是特色。
- 不做：画风统一、预算模式、双行字幕、横屏/方形输出、自动发布。
- 禁区：不生成低俗、涉政、真人明星丑化的空耳。

## 仓库卫生

`tests/t1-static.sh` 强制：仓库内不得出现任何 `*.mp3/*.m4a/*.wav/*.mp4` 等媒体文件，不得出现疑似密钥/token。`.gitignore` 已排除所有媒体与 `.work/`、`test-output/`、`renders/`。用户歌曲、生成镜头、成片、密钥一律不进此仓库——它们只存在于各项目输出目录中。

所有文档与对话使用中文。
