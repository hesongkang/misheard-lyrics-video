# misheard-lyrics-video — 空耳沙雕MV生成 Skill · 需求与实现规格

> 本文档是完整的开发交接文档。阅读后可直接开工，无需向需求方追问。
> 需求方：huntingrin（GitHub）。参照工程：https://github.com/huntingrin/make-90s-tutorial-video

---

## 1. 一句话需求

做一个 Agent Skill（SKILL.md 驱动，双宿主：Cola / Codex）：**用户输入一首歌的音频文件，产出一条 60-90 秒的"空耳歌词"沙雕短视频**——每句歌词被替换成谐音错别字（空耳），AI 文生视频把空耳的字面意思一本正经地画出来，配上原曲和底部大字字幕，竖屏成片。

### 1.1 效果参照（这是整个产品的灵魂，必须理解）

参照小红书爆款玩法（王菲《红豆》空耳版，73 秒）：

| 原歌词 | 空耳字幕 | AI 生成的画面 |
|---|---|---|
| 还没好好地感受 | 含**煤**好好的感受 | 古装女子嘴里含着一块煤对着麦克风唱歌 |
| 我们一起颤抖 | 我们一起**战斗** | 魔幻战场混战 |
| 什么是温柔 | 什么是**蚊揉** | 一只巨型蚊子在野猪背上揉搓 |
| 可能从此以后 | 可能**葱刺**以后 | 沙漠对峙，武士手持巨型大葱冲刺 |
| 有时候，有时候 | 又是**猴**，又是**猴** | 穿礼服戴高帽的猴子站上舞台 |
| 相聚离开都有时候 | **象车**离开都又是猴 | 西装大象头男子走向汽车 |
| 看细水长流 | 看细水**长牛** | 脖子无限拉长的长颈鹿牛 |

**笑点机制**：观众脑内自动播放原曲旋律 → 看到字幕发现"词不对" → 画面把错词一本正经地具象化 → 荒诞感爆炸。因此三要素缺一不可：**原曲音频**（唤起旋律记忆）、**空耳字幕精确卡在唱到那句的瞬间**、**画面忠实表达空耳的字面意思**。

---

## 2. 用户流程（Happy Path）

```
用户: "用这首歌做个空耳视频" + 提供 红豆.mp3
  ↓
[1] ASR 对轴     npx hyperframes transcribe → 逐句歌词 + 精确时间戳
  ↓
[2] 自动选段     LLM 分析歌曲结构，选"一段主歌 + 一段副歌"共 60-90 秒
                 （用户显式指定时间段/起止歌词时，用用户的）
  ↓
[3] 空耳创作     每句歌词生成 2-3 个空耳候选 + 每个候选的画面描述
  ↓
[4] ★人工确认★  以表格形式呈现给用户：逐句选择/修改/重写
                 ── 这是烧钱前的最后免费卡点，用户确认前绝不生成视频 ──
  ↓
[5] 文生视频     每句一个镜头（约5秒），SeeDance 2.0 Pro，画风随梗走不锁定
  ↓
[6] 镜头审片     vision 检查每个镜头"是否画出了空耳的字面意思"
                 不合格 → 自动改 prompt 重试（每镜头上限 2 次）
                 仍失败 → 保留最佳一版，交付时明确标注
  ↓
[7] 合成         HyperFrames：镜头序列 + 原曲音频 + 底部空耳大字幕
  ↓
[8] 交付         MP4 + 分镜清单（用户可指定"重做第N镜"）
```

---

## 3. 已拍板的需求决策（不要重新发明，全部照做）

| # | 决策项 | 结论 |
|---|---|---|
| 1 | 音频来源 | **用户自备原曲音频文件**（mp3/m4a/wav）。不做下载、不做AI翻唱。版权风险用户自担 |
| 2 | 空耳生成 | **半自动**：LLM 每句出 2-3 个候选，用户逐句确认/修改后才继续。绝不跳过确认环节 |
| 3 | 画面形式 | **全部文生视频**（不是文生图+运镜）。费用不设上限，不做预算模式 |
| 4 | 废片处理 | **镜头级审片**：vision 自检 + 自动重试（≤2次/镜头），失败镜头交付时标注 |
| 5 | 选段策略 | 默认**一段主歌 + 一段副歌**（60-90秒）；用户可显式指定时间段覆盖 |
| 6 | 字幕 | **只显示空耳歌词**，不显示原词对照。底部大白字，样式写死不做配置 |
| 7 | 画风 | **随梗走，不锁定**——每句的画面风格独立发挥，怎么好笑怎么来（古装/魔幻/写实混搭是特色不是bug） |
| 8 | 发布 | GitHub 公开仓库，规格参照 make-90s-tutorial-video（README、依赖自检、安装脚本） |
| 9 | 视频生成路径 | **双路径**：Cola 环境用内置 `gen_video` 工具；非 Cola 环境用 `listenhub` CLI 的 `video` 命令 |
| 10 | ASR | **`npx hyperframes transcribe`**（跨宿主可用，且 HyperFrames 本来就是合成环节的核心依赖，不新增概念）。不用 Cola 专属的 coli |

---

## 4. 技术栈与环境事实

开发和首次运行都在需求方的 macOS 机器上，以下是已验证的环境事实：

| 依赖 | 状态 | 说明 |
|---|---|---|
| HyperFrames CLI | v0.7.70 可用，`npx hyperframes ...` | 合成、渲染、transcribe 都靠它 |
| ffmpeg | v8.1.2 可用 | 音频裁剪、抽帧、探针 |
| Cola `gen_video` | 可用（Cola 宿主内置 agent 工具） | SeeDance 2.0 Pro（`doubao-seedance-2-pro`）。成本参考：5秒 1080p 9:16 ≈ 233 credits |
| listenhub CLI | `/opt/homebrew/bin/listenhub`（`@marswave/listenhub-cli` 0.0.16）已配置 OpenAPI Key | 备用视频生成路径。OpenAPI 链路默认走 `api.marswave.ai/openapi`，不可达时切换 `api.listenhub.app/openapi`（或设 `LISTENHUB_OPENAPI_URL`），切换后需重试一次命令 |
| Cola skills 目录 | `~/.cola/skills/` | Cola 宿主的 skill 安装位置；**安装后需重启 Cola 才生效**（技能列表在启动时扫描） |

### 4.1 HyperFrames 合成的关键契约（合成环节必读）

HyperFrames 是"HTML 即视频"框架：一个 `index.html` 用 `data-*` 属性声明时间轴，`npx hyperframes render` 逐帧截图渲染成 MP4。硬性规则：

- 根元素 `data-composition-id` + `data-width/height/duration`；每个片段是 `class="clip"` + `data-start` / `data-duration` / `data-track-index`
- **`<video>`/`<audio>` 必须是根元素的直接子元素**，框架接管播放；`<video>` 元素同样用 `data-start` 排在时间轴上，用 `data-volume="0"` 静音（原曲音频才是唯一音轨）
- 动画（如果有）：单条 `gsap.timeline({ paused: true })` 挂 `window.__timelines["<composition-id>"]`，确定性、可 seek；禁止 `Math.random()`/`Date.now()`/`repeat:-1`
- 本 skill 的合成很简单：N 个视频 clip 首尾相接 + 1 条音轨 + 每句一个字幕 clip。字幕用純 CSS 定位（底部安全区、大号粗体白字、黑描边或阴影保证任何画面上可读），**建议不做字幕入场动画或只做瞬间出现**——参照原版就是硬切，沙雕感的一部分
- 渲染前跑 `npx hyperframes check .`（0 error 才能渲），渲染命令 `npx hyperframes render . --output renders/video.mp4 --fps 30`
- 输出规格写死：**1080×1920 竖屏 30fps**

### 4.2 ASR（hyperframes transcribe）注意事项

- 唱歌的识别准确率低于说话（拖音、和声、伴奏），**错词没关系**（反正要改成空耳，用户确认环节会顺手修正），**时间戳必须保留原样**——它是字幕和镜头切换的对轴依据
- transcribe 的输出（词级或句级时间戳）要先整理成"逐句歌词 + start/end"的中间 JSON，作为后续所有环节的单一事实源

### 4.3 双路径视频生成的实现方式

Skill 是 SKILL.md 驱动的（给 agent 看的指令文档，不是传统代码库）。双路径这样写：

```
检测顺序：
1. 宿主是 Cola（有 gen_video 工具可调）→ 用 gen_video
   参数：模型 doubao-seedance-2-pro，5秒，1080p，9:16，prompt 为该镜头的画面描述
2. 否则 → 用 listenhub CLI：先 `listenhub openapi config show` 检查 API Key，
   未配置则停下引导用户执行 `listenhub openapi config set-key`（或设置 LISTENHUB_API_KEY）；
   已配置则用其 openapi video 生成命令（开工前先 `listenhub openapi video --help` 确认参数格式）
```

每个镜头的生成 prompt 结构建议：`[主体+动作，直白表达空耳字面意思] + [场景] + [风格基调，可每镜不同] + [5秒内完成的单一动作]`。prompt 用中文或英文由实现时实测哪个出片效果好来定。

### 4.4 镜头审片（vision 自检）

- Cola 宿主有 `vision_analyze` 工具；Codex 宿主用其可用的视觉能力。审片问题模板："这个画面是否清晰表达了『{空耳句}』的字面意思（{画面描述}）？主体是否正确？"
- 判定不合格 → 修改 prompt 侧重点（如主体画错则强化主体描述）重新生成，每镜头最多重试 2 次
- 重试 2 次仍不合格 → 保留视觉上最好的一版进入合成，并在交付清单中标注该镜头"未过审，建议人工重做"

---

## 5. 交付物（仓库结构）

参照 make-90s-tutorial-video 的工程规格：

```
misheard-lyrics-video/
├── README.md                 # 项目介绍 + 效果说明 + 安装方法（含 Cola 一键安装命令）+ 使用示例
├── SKILL.md                  # 主 skill 文件：name/description frontmatter + 完整工作流指令
├── install.sh                # 安装到 ~/.cola/skills/（或 Codex 对应目录），装完提示重启宿主
├── uninstall.sh
├── references/               # 按需加载的详细文档（SKILL.md 保持精简，细节放这里）
│   ├── workflow.md           # 8 步流程的逐步详细操作
│   ├── misheard-writing.md   # 空耳创作指南（什么样的空耳好笑，见 §6）
│   ├── video-prompts.md      # 文生视频 prompt 模板与技巧
│   ├── composition.md        # HyperFrames 合成模板（可直接套用的 index.html 骨架）
│   └── review.md             # 审片标准与重试策略
├── scripts/                  # 确定性操作的辅助脚本（能脚本化的不要让 agent 现想）
│   ├── check-deps.sh         # 依赖自检：node/npx/ffmpeg/hyperframes/（宿主检测）
│   └── （其他实现时按需）
└── assets/                   # 字幕字体等静态资源（中文字体注意授权，可用思源黑体）
```

**SKILL.md 的 description 触发词**（中英都要）：空耳视频、沙雕MV、谐音歌词视频、misheard lyrics video、把歌做成空耳。

**项目工作目录约定**：每次生成在输出目录建独立项目文件夹：

```
<output>/<歌名>-空耳MV/
├── source/song.mp3           # 用户提供的原曲
├── transcript.json           # ASR 结果（句 + 时间戳）
├── plan.json                 # 确认后的空耳方案（每句：原词/空耳/画面prompt/时间窗）
├── shots/shot_01.mp4 ...     # 各镜头素材 + 审片记录 shots/review.json
├── index.html                # HyperFrames 合成
├── assets/                   # 裁剪后的音频段等
└── renders/video.mp4         # 成片
```

`plan.json` 是断点续作的关键：任何一步中断后重新进入，应能从 plan.json + shots/ 现状继续，不重复烧钱。

---

## 6. 空耳创作指南（写进 references/misheard-writing.md 的核心内容）

好空耳的标准（LLM 生成候选时的评分依据）：

1. **音近**：普通话读音与原词高度相似（声母韵母近，声调可放宽）。"从此→葱刺"✓，"从此→葱翅"✗（翅 chì 对 cǐ 勉强）——宁可少换字，不硬凑
2. **可画**：换出来的词必须是**具体的、可视觉化的名词/动作**。"葱刺"（大葱+刺出去）可画，"层次"不可画。抽象词是废案
3. **荒诞反差**：画面越一本正经越好笑。优先选与原句意境反差大的词（深情歌词→菜市场食材）
4. **一句一梗**：每句最多换 1-2 个词，全句换光反而失去"听着听着不对劲"的渐进感
5. **不是每句都要换**：主歌部分可以保留 1-2 句原词不动（铺垫，让观众放松警惕），副歌集中爆发
6. 禁区：不生成低俗、涉政、真人明星丑化的空耳

呈现给用户确认的格式（表格）：

```
| # | 时间 | 原词 | 候选A | 候选B | 候选C |
|---|------|------|-------|-------|-------|
| 1 | 0:12-0:16 | 还没好好地感受 | 含煤好好的感受 | 韩梅好好的感受 | (保留原词) |
```

用户回复形如"1A 2B 3自定义：xxx 4A..."即可锁定方案。

---

## 7. 验收标准

- [ ] `check-deps.sh` 在缺依赖时给出明确安装指引，全过时输出 OK
- [ ] 用一首真实歌曲端到端跑通：mp3 输入 → 确认环节 → 成片 MP4（1080×1920, 30fps, 原曲音轨, 字幕对轴误差 ≤0.3s）
- [ ] 确认环节之前，没有任何视频生成调用发生（可从日志/credits 消耗验证）
- [ ] 中断后重入：删掉一半 shots 再运行，只补生成缺失镜头，不重做已有镜头
- [ ] 审片重试逻辑实际触发过并有记录（shots/review.json）
- [ ] README 含 Cola 一键安装命令，install.sh 装完提示"重启 Cola 生效"
- [ ] SKILL.md frontmatter 的 description 包含中英文触发词
- [ ] 全部 shell 脚本 `bash -n` 通过；仓库无密钥/token 泄漏

## 8. 明确不做（防止范围膨胀）

- 不做歌曲下载/搜索（用户自备音频）
- 不做原词+空耳双行字幕
- 不做画风统一模式、预算模式、文生图降级模式
- 不做字幕样式配置项（写死）
- 不做横屏/方形输出
- 不做自动发布到社交平台
