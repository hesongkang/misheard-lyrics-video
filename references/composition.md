# HyperFrames 合成

在生成或手改 `index.html` 前读取本文件，并同时遵守当前 `hyperframes-core` contract。

## 时间坐标

ASR 使用原曲绝对时间；合成使用片段本地时间：

```text
local_time = source_time - segment.source_start
```

保留两套字段，不覆盖原始时间。根时长固定为：

```text
segment.source_end - segment.source_start
```

## 画面窗口与字幕窗口

- 视频窗口连续覆盖 0 到根时长，按歌词开始点硬切。
- 每个视频的 `data-duration` 等于 `visual_window.duration`。
- 生成素材必须不短于视觉窗口；更长素材由 HyperFrames 截断。
- 字幕按 `caption.start/end` 独立出现，不因视觉镜头延长而延长。
- 同时只显示一条字幕；若 ASR 行重叠，先人工拆解或选择主唱行。

## DOM 结构

- 使用一个 1080×1920、30fps、显式像素尺寸的 standalone composition root。
- 所有可见 timed clip 是 root 的直接子元素。
- 每个镜头使用唯一 ID 和 track；视频静音、`playsinline`、`object-fit: cover`。
- 原曲使用一个独立 `<audio>`，`data-media-start` 为片段原曲起点。
- 使用根级全黑 full-bleed 子 clip，避免缺帧时透明。
- 字幕 clip 是 root 的直接子元素，使用独立 track 和唯一 ID。
- 注册一个同步创建、paused 的 GSAP timeline。不要调用 play、定时器或随机数。

## 字幕样式

样式固定：

- 底部安全区约 10%–22%。
- 72–92px 粗体白字，最多两行。
- 3px 黑色描边加多方向阴影。
- 水平居中，左右保留至少 64px。
- 不做逐字动画、弹跳或转场；出现与消失均硬切。
- 只写 `misheard`，不显示原词、候选标签或制作注释。

`build-caption-font.mjs` 根据批准文本下载并冻结 Noto Sans SC 900 的本地子集与 OFL
许可证。合成器检测到字体后使用 `@font-face`；缺失时给出警告并使用系统中文粗体回退。

## 验证

依次执行：

1. `npm run check`
2. 检查开头、中间、结尾和每个硬切附近的帧
3. `npm run preview`
4. 等待用户最终批准
5. `npm run render`
6. `verify-render.sh`

检查重点：

- 无黑帧或镜头短于窗口
- 字幕与唱词误差不超过 0.3 秒
- 字幕不出界、不被画面吞没
- 视频全部静音，只有一个原曲音轨
- 宽高、帧率、时长、H.264/AAC 与完整解码正确

