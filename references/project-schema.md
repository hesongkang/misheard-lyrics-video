# 项目状态与 JSON 结构

这些文件是恢复和防重复付费的事实源。路径均相对项目根目录保存；禁止写入个人绝对路径。

## `project.json`

```json
{
  "schema_version": 1,
  "title": "歌名",
  "created_at": "ISO-8601",
  "source": {
    "original_name": "song.m4a",
    "audio_path": "source/song.m4a",
    "audio_duration_s": 215.42
  },
  "output": {
    "width": 1080,
    "height": 1920,
    "fps": 30,
    "min_duration_s": 60,
    "max_duration_s": 90
  },
  "tools": {
    "hyperframes_version": "0.7.76"
  }
}
```

## `transcript.json`

```json
{
  "schema_version": 1,
  "source_format": "hyperframes-words",
  "words": [
    {"text": "还没", "start": 12.0, "end": 12.6}
  ],
  "lines": [
    {
      "id": "line_001",
      "start": 12.0,
      "end": 15.8,
      "original": "还没好好地感受",
      "word_start": 0,
      "word_end": 4
    }
  ]
}
```

`word_end` 是包含式索引。人工纠词只改 `original`；边界变化必须有音频证据。

## `plan.json`

```json
{
  "schema_version": 1,
  "project_title": "歌名",
  "status": "draft",
  "segment": {
    "source_start": 12.0,
    "source_end": 82.0,
    "duration": 70.0,
    "user_override": false
  },
  "lines": [
    {
      "id": "shot_01",
      "line_ids": ["line_001"],
      "original": "还没好好地感受",
      "caption": {
        "source_start": 12.0,
        "source_end": 15.8,
        "start": 0.0,
        "end": 3.8
      },
      "visual_window": {
        "start": 0.0,
        "end": 4.7,
        "duration": 4.7
      },
      "generation_duration_s": 5,
      "candidates": [],
      "selected": null,
      "misheard": "",
      "visual": "",
      "prompt": ""
    }
  ],
  "approval": null
}
```

批准后 `status` 变为 `approved`，`approval.digest` 覆盖除 `approval` 本身以外的完整计划。
改变候选选择、字幕、基础 Prompt、片段或镜头时间都会使 guard 失败。

## `shots/retry-prompts.json`

自动审片失败后的最小 Prompt 修补不改 `plan.json`，而是单独记录：

```json
{
  "schema_version": 1,
  "prompts": [
    {
      "shot": "shot_01",
      "revision": 1,
      "attempt": 2,
      "prompt": "强化主体后的完整 Prompt",
      "reason": "主体错误",
      "previous_attempt": 1,
      "approval_digest": "sha256:..."
    }
  ]
}
```

只有前一 attempt 已审片失败、attempt 不超过 3、摘要仍匹配时才能使用。

## `shots/review.json`

```json
{
  "schema_version": 1,
  "shots": {
    "shot_01": {
      "active_revision": 1,
      "status": "passed",
      "selected_file": "shots/shot_01.mp4",
      "shot_digest": "sha256:...",
      "revisions": {
        "1": {
          "status": "passed",
          "selected_attempt": 1,
          "attempts": [
            {
              "attempt": 1,
              "result": "pass",
              "score": 5,
              "reason": "主体与动作清楚",
              "file": "shots/attempts/shot_01_r1_attempt_1.mp4",
              "contact_sheet": "shots/review/shot_01_r1_attempt_1.jpg",
              "prompt": "..."
            }
          ]
        }
      }
    }
  }
}
```

顶层 `selected_file` 始终指向 canonical 文件。旧 revision 保留，不被新版覆盖。
`shot_digest` 只覆盖该镜的空耳、画面语义、基础 Prompt 与生成时长：改一镜只会把这一镜标为
stale，不会迫使其他已通过镜头重新付费生成。

## 状态判断

`project-status.mjs` 按事实文件计算阶段，不依赖手写 status 文件：

```text
initialized → transcribed → plan_draft → approved
→ generating/reviewing/recovering/stale → ready_to_assemble → assembled → rendered
```

如果批准摘要失效，阶段回到 `plan_draft`，即使磁盘上已有旧镜头也禁止新生成。
`recovering` 表示 canonical 镜头可从已选 attempt 免费恢复。
`stale` 表示某个已选镜头的独立摘要与当前计划不一致，只重做 `stale_shots`。
