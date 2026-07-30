# 端到端工作流

本文件补充 `SKILL.md` 的执行细节。恢复项目时先跑 status，不要机械地从第一步重来。

## 0. 定位 Skill 与宿主

把包含本文件的上级目录记为 `<skill-dir>`。宿主能看到原生 `gen_video` 时选 `cola`，
否则选 `codex`：

```bash
bash <skill-dir>/scripts/check-deps.sh --host <cola|codex>
```

依赖失败时先修复。ListenHub API Key 未配置时停止并让用户执行 `listenhub openapi config set-key`，不要尝试
绕过认证或切换到未约定的视频模型。

## 1. 初始化

```bash
node <skill-dir>/scripts/init-project.mjs \
  --audio "/absolute/path/song.m4a" \
  --output "/absolute/path/output/歌名-空耳MV" \
  --title "歌名"
```

初始化拒绝覆盖已有 `project.json`。若目录已存在，运行：

```bash
node <skill-dir>/scripts/project-status.mjs --project <project>
```

若返回 `recoverable_shots`，说明 canonical 文件被删但已选 attempt 仍在。先本地恢复，禁止
重新生成：

```bash
node <skill-dir>/scripts/restore-selected-shots.mjs --project <project>
```

若返回 `stale_shots`，只重做摘要变化的镜头；其他镜头继续复用。

## 2. ASR 与人工校正

```bash
mkdir -p <project>/.work/asr
npx hyperframes transcribe <project>/source/<file> \
  --dir <project>/.work/asr --engine whisper --model medium --language zh --json
node <skill-dir>/scripts/group-transcript.mjs \
  --input <project>/.work/asr/transcript.json \
  --output <project>/transcript.json
```

HyperFrames 输出统一的 `[{text,start,end}]` 词级数组。分组脚本按标点、停顿、字符数与最大
时长生成行。对唱歌的错误处理：

- 中文必须显式使用不带 `.en` 的多语种 Whisper 模型；不要依赖默认 `small.en`。
- 默认从 `medium` 开始；机器资源充足且需更高质量时可改为 `large-v3`。
- 可改 `lines[].original`。
- 可合并或拆分行，但保留所覆盖词的最早 `start` 和最晚 `end`。
- 不凭歌词记忆重写时间戳。
- 和声或重复拖音无法可靠识别时，听音频和看波形后再调整。

## 3. 选择片段

优先选包含一段主歌和一段副歌的连续区间，默认 60–90 秒。片段起点尽量落在第一句开始，
终点落在一句结束或乐句收束。用户显式指定时设置 `--user-override`：

```bash
node <skill-dir>/scripts/create-plan.mjs \
  --project <project> --start 42.3 --end 115.0
```

短测试或用户明确指定非 60–90 秒时：

```bash
node <skill-dir>/scripts/create-plan.mjs \
  --project <project> --start 42.3 --end 58.0 --user-override
```

脚本生成连续视觉窗口：

- 第一镜从片段本地时间 0 开始。
- 后续镜头在对应歌词开始时硬切。
- 最后一镜延伸到片段结束。
- 字幕只在实际唱词窗口显示。
- 视觉窗口超过 15 秒时脚本拒绝；先拆分或增加镜头。

## 4. 候选与确认

按 `misheard-writing.md` 写候选，按 `video-prompts.md` 写初始 Prompt。将结果写入
`plan.json`，保持 `status: "draft"`。

把所有行一次性呈现给用户。用户未选择完整时，只修改候选并再次呈现；不要批准部分计划。
明确选择后：

1. 将所选候选复制到同一行的 `selected`、`misheard`、`visual`、`prompt`。
2. 自定义项使用 `selected: "custom"`，并同样补齐后三个字段。
3. 运行批准脚本。

```bash
node <skill-dir>/scripts/approve-plan.mjs \
  --project <project> \
  --confirmation "user reply: 1A 2B 3 custom ..."
```

脚本校验每行完整后写入内容摘要。之后任何生成相关字段变化都会使摘要失效。

## 5. 镜头生成

先查询：

```bash
node <skill-dir>/scripts/project-status.mjs --project <project> --json
```

只处理 `missing_shots`。每次生成前运行：

```bash
node <skill-dir>/scripts/assert-generation-ready.mjs \
  --project <project> --shot shot_01 --revision 1 --attempt 1 --json
```

Cola 调用原生工具，并把结果保存为：

```text
shots/attempts/shot_01_r1_attempt_1.mp4
```

随后验证并记录：

```bash
node <skill-dir>/scripts/record-generation.mjs \
  --project <project> --shot shot_01 --revision 1 --attempt 1 \
  --file <project>/shots/attempts/shot_01_r1_attempt_1.mp4 --host cola
```

Codex/其他宿主：

```bash
node <skill-dir>/scripts/listenhub-shot.mjs \
  --project <project> --shot shot_01 --revision 1 --attempt 1
```

可以并发生成多个已批准镜头，但每个调用都必须单独通过 guard。不要并发写同一镜头的同一
revision/attempt。

## 6. 审片与重试

按 `review.md` 生成联系表并用视觉能力评分。失败后根据原因最小修改 Prompt，但不要改动
已批准的 `plan.json`。将自动修补写入独立审计记录：

```bash
node <skill-dir>/scripts/set-retry-prompt.mjs \
  --project <project> --shot shot_01 --revision 1 --attempt 2 \
  --prompt "修补后的完整 Prompt" --reason "主体错误，需强化主体"
```

该脚本只在前一 attempt 已记录为失败时放行，并绑定当前批准摘要。一次 revision 最多三次
生成。若改变的不是最小修补，而是空耳梗、字面画面或镜头时间，则必须回到用户确认并重新
批准计划。

通过并选中：

```bash
node <skill-dir>/scripts/record-review.mjs \
  --project <project> --shot shot_01 --revision 1 --attempt 1 \
  --result pass --score 5 --reason "主体和动作清楚" \
  --file <project>/shots/attempts/shot_01_r1_attempt_1.mp4 \
  --contact-sheet <project>/shots/review/shot_01_r1_attempt_1.jpg \
  --select
```

三版均失败时，从三版中选最佳并记录
`--result fail --select --select-attempt <1|2|3>`。

## 7. 合成、预览、渲染

所有镜头有已选 canonical 文件后：

```bash
node <skill-dir>/scripts/build-caption-font.mjs --project <project>
node <skill-dir>/scripts/assemble.mjs --project <project>
cd <project>
npm run upgrade:check
npm run check
```

如果 HyperFrames 项目 pin 落后，在第一次 render-affecting 命令前按 HyperFrames 的
upgrade contract 检查并升级；升级后重新执行 check。

check 通过后打开：

```bash
npm run preview
```

以后台长进程启动，确认服务没有退出，再把包含
`#project/<project-directory-name>` 的最终 timeline URL 交给用户。不要交付 `index.html`
路径。只有用户明确回复渲染后：

```bash
npm run render
bash <skill-dir>/scripts/verify-render.sh renders/video.mp4 plan.json
```

验证成功后，除非用户退出 telemetry，按 `hyperframes-cli` 的反馈合同发送一次
`npx hyperframes feedback`；不得包含绝对路径、用户身份或歌曲文本。

## 8. 重做一镜

用户说“重做第 N 镜”时：

1. 保留旧 canonical、attempts 和 review 记录。
2. 修改该镜 Prompt；让用户确认变化。
3. 重新运行 `approve-plan.mjs`。
4. 使用下一个 revision，例如 `--revision 2 --attempt 1`。
5. 新版通过或选择最佳后，`record-review --select` 更新 canonical。
6. 重新 assemble、check、最终预览；其他镜头不生成。
