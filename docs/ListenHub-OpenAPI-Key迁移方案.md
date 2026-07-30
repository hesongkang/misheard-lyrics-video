# ListenHub 认证方式迁移方案：OAuth Login → OpenAPI Key

> 日期：2026-07-30
> 依据：`listenhub-cli/` 的 `README.zh-CN.md` 与源码（`source/openapi/`、`source/_shared/`）
> 范围：将 `misheard-lyrics-video` 项目对 ListenHub CLI 的认证从 **OAuth Login** 改为 **OpenAPI Key**，并把所有相关命令切换到 `openapi` 子命令。

---

## 一、背景与目标

`misheard-lyrics-video` 在非 Cola 宿主（`host=codex`，即 Claude Code / Codex 路径）下，通过 `scripts/listenhub-shot.mjs` 调用外部 `listenhub` CLI 生成 SeeDance 2.0 Pro 视频镜头。当前认证方式是 **OAuth Login**（`listenhub auth login`，浏览器交互），凭证存于 `~/.config/listenhub/credentials.json`。

OAuth 方式有两个不便：

1. **必须人工浏览器登录**，无法在脚本/CI 中静默完成；
2. token 会过期，依赖 CLI 内部的 refresh 逻辑（见 `listenhub-cli/source/_shared/client.ts`）。

ListenHub CLI 同时提供 **OpenAPI Key** 方式：设置一个 `lh_sk_` 开头的 API Key，命令前缀加 `openapi`，适合脚本化、程序化调用——正是本项目的场景。

**目标**：把项目里所有 `listenhub auth *` 与 `listenhub video *`（OAuth 链路）调用，改为 `listenhub openapi *`（OpenAPI Key 链路），并同步更新依赖自检、文档与权限配置。

---

## 二、两种认证方式对比（来自 listenhub-cli）

|          | OAuth 登录（当前） | OpenAPI Key（目标） |
| -------- | ----------------- | ------------------- |
| 设置     | `listenhub auth login`（打开浏览器） | 设置 `LISTENHUB_API_KEY` 环境变量，或 `listenhub openapi config set-key` |
| 命令前缀 | `listenhub video …` | `listenhub openapi video …` |
| 凭证存储 | `~/.config/listenhub/credentials.json` | `~/.config/listenhub/openapi.json` 或环境变量 |
| 适用场景 | 交互式、账号管理 | 脚本、CI/CD、程序化调用 |
| 默认 Base URL | `https://api.listenhub.ai/api` | `https://api.marswave.ai/openapi` |
| Base URL 覆盖变量 | `LISTENHUB_API_URL` | `LISTENHUB_OPENAPI_URL` |
| 网络受限覆盖 | `https://api.listenhub.app/api` | `https://api.listenhub.app/openapi` |

两种方式底层调用相同的 API，按需选择。本项目是 agent 自动调用的脚本场景，OpenAPI Key 更合适。

---

## 三、命令映射表

| 用途 | OAuth（当前） | OpenAPI Key（目标） |
| --- | --- | --- |
| 配置凭证 | `listenhub auth login` | `listenhub openapi config set-key`（交互）或 `export LISTENHUB_API_KEY="lh_sk_…"` |
| 检查认证状态 | `listenhub auth status`（退出码 0=已登录） | `listenhub openapi config show`（退出码 0=已配置 Key，1=未配置） |
| 清除凭证 | `listenhub auth logout` | `listenhub openapi config clear` |
| 创建视频任务 | `listenhub video create …` | `listenhub openapi video create …` |
| 查询任务详情 | `listenhub video get <id> …` | `listenhub openapi video get <id> …` |
| 预估积分 | `listenhub video estimate …` | `listenhub openapi video estimate …` |

---

## 四、兼容性技术分析（关键结论）

迁移之所以能平滑进行，是因为 OpenAPI 的 `video` 命令与 OAuth 版本**参数和输出都兼容**。以下逐项核实（基于 `listenhub-cli/source/openapi/video.ts`）。

### 4.1 `video create` 参数完全兼容

`listenhub-shot.mjs` 当前构造的参数：

```
video create --prompt <p> --model doubao-seedance-2-pro --resolution 1080p
            --ratio 9:16 --duration <N> --no-generate-audio --timeout <N> --json
```

对照 `source/openapi/video.ts:292-342` 的 `openapi video create` 定义：

| 参数 | OAuth `video create` | OpenAPI `openapi video create` | 本项目使用 |
| --- | --- | --- | --- |
| `--prompt`（必填） | ✅ | ✅ | ✅ |
| `--model` | ✅（默认 happyhorse） | ✅（无默认，需显式传） | ✅ 传 doubao-seedance-2-pro |
| `--resolution` | ✅ | ✅ | ✅ 1080p |
| `--ratio` | ✅（含 9:16） | ✅（含 9:16） | ✅ 9:16 |
| `--duration` | ✅（3-15） | ✅（**4-15**） | ✅ 约 5 秒，落在区间内 |
| `--no-generate-audio` | ✅ | ✅ | ✅ |
| `--timeout` | ✅（默认 1200） | ✅（默认 1200） | ✅ |
| `--json` | ✅ | ✅ | ✅ |

**结论**：迁移只需在命令前加 `openapi`，参数无需改动。

> ⚠️ 唯一差异：OpenAPI 的 `--duration` 下限是 **4**（OAuth 是 3）。本项目每镜约 5 秒（见 `REQUIREMENTS.md`），不受影响；但需保证 `shot.generation_duration_s` 永远 ≥ 4，否则 OpenAPI 会拒绝（`video.ts:391-396`）。

### 4.2 JSON 输出字段兼容

`listenhub-shot.mjs` 解析生成结果时做了容错（`listenhub-shot.mjs:147-148`）：

```js
const videoUrl = task.videoUrl ?? task.video_url ?? task.result?.videoUrl;
const taskId   = task.id ?? task.taskId ?? task.task_id ?? null;
```

本项目**不传 `--no-wait`**，所以 CLI 会轮询到完成。OpenAPI 链路在等待完成时执行 `printJson(result)`（`video.ts:510-511`），`result` 是 `OpenAPIVideoGenerationTaskDetail`，其字段（见 `video.ts:274-287` 的 `printVideoDetail`）包含：

- 顶层 `id` ✅ → 命中 `task.id`
- 顶层 `videoUrl` ✅ → 命中 `task.videoUrl`

**结论**：现有解析逻辑无需修改即可匹配 OpenAPI 输出。

### 4.3 `video get` 兼容

`listenhub-shot.mjs:131` 在生成失败但已拿到 taskId 时，用 `video get` 恢复。OpenAPI 对应命令 `openapi video get <taskId> --json`（`video.ts:520-537`）同样输出 `OpenAPIVideoGenerationTaskDetail`，字段一致。

### 4.4 认证检查退出码语义一致

- OAuth：`listenhub auth status` —— 已登录退出码 0，未登录非 0。
- OpenAPI：`listenhub openapi config show` —— 已配置 Key（环境变量或文件）正常退出码 0；未配置时 `process.exit(1)`（见 `source/openapi/config-cmd.ts:66` 的 `runShow`）。

**结论**：`listenhub-shot.mjs` 与 `check-deps.sh` 里「用退出码判断认证是否就绪」的逻辑可直接复用，只换命令字符串。

### 4.5 OpenAPI Key 的读取优先级

`source/openapi/client.ts:6-22` 的 `getOpenAPIOptions`：

1. 先看环境变量 `LISTENHUB_API_KEY`；
2. 否则读 `~/.config/listenhub/openapi.json`（由 `openapi config set-key` 写入）；
3. 都没有则抛错 `'No API Key configured. Set LISTENHUB_API_KEY env var or run listenhub openapi config set-key.'`。

因此用户有两种配置方式，二选一即可。

---

## 五、需要修改的位置（全量清单）

共 **9 个文件**，分三类。

### 5.1 代码（2 个，必改）

| 文件 | 改动点 |
| --- | --- |
| `scripts/listenhub-shot.mjs` | 4 处：认证检查、create 命令前缀、get 恢复命令、网络重试正则 |
| `scripts/check-deps.sh` | 4 处：安装提示、认证检查、错误提示、help 校验命令 |

### 5.2 文档（6 个，必改）

| 文件 | 改动点 |
| --- | --- |
| `README.md` | 「非 Cola 路径：已登录的 ListenHub CLI」措辞 |
| `REQUIREMENTS.md` | 环境事实表、双路径实现方式（§4.3） |
| `SKILL.md` | 候选门提及 `listenhub video`、host 选择说明 |
| `references/workflow.md` | 「未登录时让用户执行 `listenhub auth login`」 |
| `docs/prepare_thing.md` | 调用链说明、准备清单第 1 节 |
| `docs/在Claude Code中使用与开工指南.md` | 开工前就绪检查第 3 节、快速参考卡、验证记录 |
| `docs/环境依赖安装记录.md` | 状态表、自检输出、待办、命令速查 |

### 5.3 配置（1 个，可选）

| 文件 | 改动点 |
| --- | --- |
| `.claude/settings.local.json` | 已预置 `Bash(listenhub openapi *)` 权限（第 73 行），无需新增；旧的 `Bash(listenhub video *)` / `Bash(listenhub auth *)`（第 15-16 行）迁移后不再触发，可保留或清理 |

> `CLAUDE.md` 第 12、14 行仅描述性提及 `listenhub` CLI，无具体认证命令，可不改。`agents/openai.yaml` 无 ListenHub 相关内容，不涉及。

---

## 六、具体改动方案（逐处前后对比）

### 6.1 `scripts/listenhub-shot.mjs`

**① 认证检查（第 102-105 行）**

```diff
- const auth = runListenHub(["auth", "status"], 30_000);
+ const auth = runListenHub(["openapi", "config", "show"], 30_000);
  if (auth.status !== 0) {
-   throw new Error("ListenHub is not authenticated. Run `listenhub auth login`, then retry.");
+   throw new Error("ListenHub API Key is not configured. Run `listenhub openapi config set-key` (or set LISTENHUB_API_KEY), then retry.");
  }
```

**② 生成命令前缀（第 107 行起，`createArgs` 数组）**

```diff
  const createArgs = [
+   "openapi",
    "video",
    "create",
    "--prompt",
    prompt,
    ...
  ];
```

**③ 失败恢复命令（第 131 行）**

```diff
- const recovered = runListenHub(["video", "get", existingTaskId, "--json"], 60_000);
+ const recovered = runListenHub(["openapi", "video", "get", existingTaskId, "--json"], 60_000);
```

**④ 网络错误重试正则（第 136 行）**

OpenAPI 默认走 `api.marswave.ai`，原正则里的 `api\.listenhub\.ai` 不再匹配。加入 `marswave.ai` 与 `listenhub.app`（覆盖变量场景）：

```diff
- } else if (/api\.listenhub\.ai|ENOTFOUND|ECONN|fetch failed|network/i.test(combined)) {
+ } else if (/api\.(listenhub\.ai|marswave\.ai|listenhub\.app)|ENOTFOUND|ECONN|fetch failed|network/i.test(combined)) {
```

> 说明：`fetch failed`、`ENOTFOUND`、`ECONN` 本就是通用网络错误，即使不改也能兜住大多数情况；显式列出三个域名是为了与 README 的 Base URL 说明保持一致，便于排查。

### 6.2 `scripts/check-deps.sh`

**① 安装提示（第 97 行）**

```diff
- need_command listenhub "Install @marswave/listenhub-cli and run listenhub auth login."
+ need_command listenhub "Install @marswave/listenhub-cli and run listenhub openapi config set-key."
```

**② 认证检查（第 99-103 行）**

```diff
- if listenhub auth status >/dev/null 2>&1; then
-   ok "ListenHub authentication is active"
+ if listenhub openapi config show >/dev/null 2>&1; then
+   ok "ListenHub API Key is configured"
  else
-   fail "ListenHub is not logged in. Run: listenhub auth login"
+   fail "ListenHub API Key is not configured. Run: listenhub openapi config set-key (or set LISTENHUB_API_KEY)"
  fi
```

**③ help 校验命令（第 104 行）**

```diff
- if listenhub video create --help 2>&1 | grep -q "doubao-seedance-2-pro"; then
+ if listenhub openapi video create --help 2>&1 | grep -q "doubao-seedance-2-pro"; then
```

### 6.3 文档改动要点

文档统一把「OAuth 登录」叙事改为「OpenAPI Key」叙事。以下是每个文件的改法（不是逐字 diff，而是改动要点；落地时保持各文档原有风格）。

**`README.md`（第 52 行）**
- 「非 Cola 路径：已登录的 ListenHub CLI」→「非 Cola 路径：已配置 API Key 的 ListenHub CLI」

**`REQUIREMENTS.md`**
- 第 84 行环境事实表：`已登录` → `已配置 OpenAPI Key`；网络切换说明里补充 OpenAPI 的 Base URL 是 `api.marswave.ai/openapi`，受限时走 `api.listenhub.app/openapi`。
- 第 111-113 行双路径实现方式：

```diff
- 2. 否则 -> 用 listenhub CLI：先 `listenhub auth status` 检查登录，
-    未登录则停下引导用户执行 `listenhub auth login`；
-    已登录则用其 video 生成命令（开工前先 `listenhub video --help` 确认参数格式）
+ 2. 否则 -> 用 listenhub CLI：先 `listenhub openapi config show` 检查 API Key，
+    未配置则停下引导用户执行 `listenhub openapi config set-key`（或设置 LISTENHUB_API_KEY）；
+    已配置则用其 openapi video 生成命令（开工前先 `listenhub openapi video --help` 确认参数格式）
```

**`SKILL.md`**
- 第 39 行候选门：`listenhub video` → `listenhub openapi video`（语义不变，仍指付费视频生成器）。
- 第 56 行：`Otherwise use host codex and the ListenHub CLI path.` 可补一句「via OpenAPI Key」。

**`references/workflow.md`（第 14 行）**

```diff
- 依赖失败时先修复。ListenHub 未登录时停止并让用户执行 `listenhub auth login`，不要尝试
+ 依赖失败时先修复。ListenHub API Key 未配置时停止并让用户执行 `listenhub openapi config set-key`，不要尝试
```

**`docs/prepare_thing.md`**
- 第 16-25 行调用链说明：

```diff
- listenhub auth status                         # 检查登录
- listenhub video create \
+ listenhub openapi config show                 # 检查 API Key
+ listenhub openapi video create \
    --model doubao-seedance-2-pro \             # SeeDance 2.0 Pro
    --resolution 1080p --ratio 9:16 \
    --duration <N> --no-generate-audio --json   # 提交生成
```

- 第 27 行：`安装并登录 listenhub CLI` → `安装 listenhub CLI 并配置 OpenAPI Key`。
- 第 31-45 行准备清单第 1 节：把 `listenhub auth login` / `listenhub auth status` 换成 `listenhub openapi config set-key` / `listenhub openapi config show`，`listenhub video create --help` 换成 `listenhub openapi video create --help`；补充「或 `export LISTENHUB_API_KEY=lh_sk_…`」。
- 第 47 行网络切换说明：补充 OpenAPI 链路用 `LISTENHUB_OPENAPI_URL`，受限时指向 `https://api.listenhub.app/openapi`。

**`docs/在Claude Code中使用与开工指南.md`**
- 第 49-61 行「listenhub 已登录（唯一硬阻塞）」整节：标题改为「listenhub API Key 已配置（唯一硬阻塞）」；`listenhub auth status` → `listenhub openapi config show`；`! listenhub auth login` → `! listenhub openapi config set-key`（或 `! export LISTENHUB_API_KEY=lh_sk_…`）；删去「交互式浏览器 OAuth，必须你本人完成」措辞，改为「API Key 可在 ListenHub 控制台获取后配置，无需浏览器登录」。
- 第 152 行：`封装脚本自动检查认证` 保持，语义不变。
- 第 264 行快速参考卡：`! listenhub auth login | 开工前（仅一次）` → `! listenhub openapi config set-key | 开工前（仅一次）`。
- 第 286 行结论：「唯一待办仍是 `! listenhub auth login`」→「唯一待办仍是 `! listenhub openapi config set-key`」。

**`docs/环境依赖安装记录.md`**
- 第 17 行状态表：`listenhub 登录 | ❌ 未登录 | 需用户自行 listenhub auth login（浏览器 OAuth）` → `listenhub API Key | ❌ 未配置 | 需用户自行 listenhub openapi config set-key 或设置 LISTENHUB_API_KEY`。
- 第 20 行：`唯一 error 为 listenhub 未登录` → `唯一 error 为 listenhub API Key 未配置`。
- 第 92 行自检输出：`ERROR: ListenHub is not logged in. Run: listenhub auth login` → `ERROR: ListenHub API Key is not configured. Run: listenhub openapi config set-key`。
- 第 103-112 行待办第 1 节：`浏览器 OAuth，交互式，无法代劳` → 改为 API Key 配置方式（`set-key` 交互或 `LISTENHUB_API_KEY` 环境变量，二者皆可由用户在会话中用 `!` 前缀完成）。
- 第 130-133 行命令速查：`listenhub auth login` / `listenhub auth status` / `listenhub video create --help` → 对应 `openapi config set-key` / `openapi config show` / `openapi video create --help`。

### 6.4 `.claude/settings.local.json`

```diff
  "allow": [
    ...
-   "Bash(listenhub video *)",
-   "Bash(listenhub auth *)",
    ...
    "Bash(listenhub openapi *)",   // 已存在（第 73 行），覆盖所有 openapi 子命令
    ...
  ]
```

`listenhub openapi *` 已在白名单内，迁移后所有实际调用（`openapi config show`、`openapi video create`、`openapi video get`）都会自动放行。`listenhub video *` 与 `listenhub auth *` 迁移后不再被触发，删除仅为整洁，保留无害。

---

## 七、注意事项与风险

1. **`--duration` 下限差异**：OpenAPI 校验 `--duration` 为 4-15（`video.ts:391-396`），OAuth 为 3-15。需确认 `shot.generation_duration_s` 永远 ≥ 4。当前设计每镜约 5 秒，安全；但 `create-plan.mjs` 若允许产生 3 秒窗口，会在 OpenAPI 链路报错。建议在 `assert-generation-ready.mjs` 或计划生成阶段加一条 `duration >= 4` 的前置校验。

2. **Base URL 变了**：OAuth 走 `api.listenhub.ai/api`，OpenAPI 走 `api.marswave.ai/openapi`。若用户网络对 `marswave.ai` 不通而 `listenhub.app` 通，需设 `LISTENHUB_OPENAPI_URL=https://api.listenhub.app/openapi`（注意后缀是 `/openapi`，不是 `/api`）。CLI 的 `auto` 自动选域对 OpenAPI 链路同样生效。

3. **网络重试正则**：见 6.1 ④，已纳入 `marswave.ai` 与 `listenhub.app`。注意 CLI 的自动选域机制对**创建/生成类命令失败后绝不重发到另一个域**（防止双份扣费），所以网络受限时第一条生成命令会失败并提示重试——这与 OAuth 时代行为一致，`listenhub-shot.mjs` 的「失败则重试一次」逻辑仅对纯连接错误（`fetch failed`/`ENOTFOUND`）触发，不违背该约束。

4. **API Key 安全**：API Key 不得进仓库。`openapi config set-key` 写入 `~/.config/listenhub/openapi.json`（权限 0o600）；若用环境变量，确保不写入 shell 配置的公开文件或仓库。`tests/run-all.sh` 的 T1 静态检查已校验「仓库无密钥/token」，迁移后该检查依旧适用。

5. **Cola 路径不受影响**：本次改动只涉及 `host=codex`（ListenHub CLI）路径。Cola 宿主的 `gen_video` 内置工具不走 ListenHub，无需改动。

6. **`--no-wait` 与输出形态**：本项目**不传** `--no-wait`，CLI 会轮询到完成并输出完整 task detail（含 `videoUrl`）。若未来改为 `--no-wait`，OpenAPI 输出的是 `{taskId}`（`video.ts:489-490`），`listenhub-shot.mjs` 现有的 `videoUrl` 解析会拿不到 URL——届时需配合 `openapi video get` 二次轮询。当前不涉及。

---

## 八、验证步骤

1. **配置 Key**（二选一）：
   ```bash
   listenhub openapi config set-key        # 交互式，输入 lh_sk_...
   # 或
   export LISTENHUB_API_KEY="lh_sk_..."
   ```
2. **确认状态**：
   ```bash
   listenhub openapi config show           # 应退出码 0，显示 Key ID
   ```
3. **跑依赖自检**（改完 `check-deps.sh` 后）：
   ```bash
   bash scripts/check-deps.sh --host codex
   # 期望：OK: ListenHub API Key is configured / OK: ListenHub SeeDance 2.0 Pro path is available / SUMMARY: 0 error(s)
   ```
4. **跑静态测试**（不消耗 credits）：
   ```bash
   bash tests/run-all.sh
   # 期望 ALL TESTS PASSED；T1 的 bash -n / node --check 覆盖改动的脚本语法
   ```
5. **端到端验收**（消耗 credits，须用户提供音频并逐句确认后单独执行）：
   ```bash
   node scripts/listenhub-shot.mjs --project <project> --shot shot_01 --attempt 1
   # 期望：提交 SeeDance 2.0 Pro、轮询、下载 mp4 到 shots/attempts/、写入 generation.json
   ```
   验证 `generation.json` 里 `task_id` 非空、`file` 指向有效竖屏 mp4。

---

## 九、改动摘要

| 维度 | 数量 | 说明 |
| --- | --- | --- |
| 代码文件 | 2 | `listenhub-shot.mjs`（4 处）、`check-deps.sh`（4 处） |
| 文档文件 | 7 | README、REQUIREMENTS、SKILL、workflow、prepare_thing、开工指南、安装记录 |
| 配置文件 | 1 | `.claude/settings.local.json`（可选清理） |
| 核心机制 | 命令前缀加 `openapi`，参数与 JSON 解析均不变 | 见第四节兼容性分析 |
| 主要风险 | `--duration` 下限 4（vs OAuth 的 3） | 建议加前置校验 |

> 本文档为分析与方案。如需我直接落地这些改动，告知即可。
