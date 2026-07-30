# Chrome 浏览器镜像安装方案

> 日期：2026-07-30
> 背景：HyperFrames 渲染（`render`）靠 `puppeteer-core` 驱动 Chrome Headless Shell 逐帧截图合成 MP4。默认从 Google 源下载，国内极慢。本文记录绕开 Google 源、改用国内镜像的安装方案。

## 一、问题诊断

### 1. 慢的根因是网络

HyperFrames 用 `puppeteer-core` + `@puppeteer/browsers` 下载 Chrome，默认源是 Google 的 `storage.googleapis.com`。实测对比：

| 下载源 | 首字节延迟 | 速度 |
|---|---|---|
| `storage.googleapis.com`（Google 默认） | 1.25s | 516 B/s |
| `cdn.npmmirror.com`（国内镜像） | 0.28s | 1384 B/s |

国内访问 Google 源慢，是下载慢的直接原因。

### 2. `npx playwright install chromium` 是错误方向

HyperFrames 用的是 **`puppeteer-core`**（见其 `package.json` 的 `dependencies`），**不是 playwright**。`npx playwright install chromium` 下载的 Chromium 它用不上。正确命令是 `hyperframes browser ensure`，但它同样走 Google 慢源。

## 二、关键事实（读 HyperFrames 源码确认）

读 `dist/cli.js`（esbuild bundle）确认：

- **找浏览器优先级**：`HYPERFRAMES_BROWSER_PATH` 环境变量 → `~/.cache/hyperframes/chrome` 缓存目录 → 系统 Chrome → 下载（`ensure`）。
- **pinned 版本**：`CHROME_VERSION = "152.0.7928.2"`（用固定版本保证像素输出可复现）。
- **缓存目录**：`CACHE_DIR2 = ~/.cache/hyperframes/chrome`。
- **缓存结构**：`<cacheDir>/chrome-headless-shell/linux-<buildId>/chrome-headless-shell-linux64/chrome-headless-shell`。
- **无镜像环境变量**：HyperFrames 自己代码里不读 `PUPPETEER_DOWNLOAD_BASE_URL`，下载源由 `@puppeteer/browsers` 内部决定（默认 Google）。但读 `HYPERFRAMES_BROWSER_PATH` 指定可执行文件路径。

## 三、踩坑过程

| # | 尝试 | 结果 |
|---|---|---|
| 1 | `npx playwright install chromium` | 方向错，HyperFrames 用 puppeteer 不用 playwright |
| 2 | `hyperframes browser ensure` | 走 Google 慢源，极慢 |
| 3 | `npx @puppeteer/browsers install chrome-headless-shell@152.0.7928.2 --base-url=https://cdn.npmmirror.com/binaries/chrome-for-testing --path=~/.cache/hyperframes/chrome` | 下载的 zip 损坏，解压报 `End-of-central-directory signature not found`，失败后自动清理 |
| 4 | **curl 直接下载镜像 zip + 手动解压** | ✅ 成功 |

坑 3 的教训：`@puppeteer/browsers` 的下载过程在这个网络环境下会产出损坏文件；**curl 下载稳定**（下载后 `unzip -t` 通过、大小与 `content-length` 一致）。

## 四、解决方案（可复现）

```bash
# 1. 从 npmmirror 镜像用 curl 下载 pinned chrome-headless-shell（115MB，稳定）
curl -L --fail -o /tmp/chs.zip \
  "https://cdn.npmmirror.com/binaries/chrome-for-testing/152.0.7928.2/linux64/chrome-headless-shell-linux64.zip"

# 2. 解压到 HyperFrames 缓存目录（目录名格式：linux-<buildId>）
target=~/.cache/hyperframes/chrome/chrome-headless-shell/linux-152.0.7928.2
mkdir -p "$target"
unzip -o -q /tmp/chs.zip -d "$target"
chmod +x "$target/chrome-headless-shell-linux64/chrome-headless-shell"

# 3. 验证
hyperframes browser path                                      # 应秒回可执行文件路径
hyperframes doctor --json | grep -A3 '"Chrome"'              # Chrome 检查应 ok: true
"$target/chrome-headless-shell-linux64/chrome-headless-shell" --version   # 应输出版本号
```

## 五、验证结果

```text
$ hyperframes browser path
/home/hsk/.cache/hyperframes/chrome/chrome-headless-shell/linux-152.0.7928.2/chrome-headless-shell-linux64/chrome-headless-shell

$ hyperframes doctor --json  (Chrome 检查项)
{ "name": "Chrome", "ok": true,
  "detail": "cache: $HOME/.cache/hyperframes/chrome/chrome-headless-shell/linux-152.0.7928.2/..." }

$ chrome-headless-shell --version
Google Chrome for Testing 152.0.7928.2

$ ldd chrome-headless-shell | grep "not found"
（无输出 → 无缺失共享库）
```

## 六、备选方案

- **`HYPERFRAMES_BROWSER_PATH` 环境变量**：指向任意 Chrome 可执行文件，优先级最高，绕过版本与缓存结构检查。适合用系统已装的 Chrome 临时顶替（但版本非 pinned，像素输出可能与 pinned 版有微差）。
- **`hyperframes cloud`**：在 HeyGen 云端渲染，不需本地 Chrome/ffmpeg。本地 Chrome 实在装不上时的兜底（需账号）。

## 七、HyperFrames 升级后如何更新 Chrome

HyperFrames 升级后 `CHROME_VERSION` 可能变化，需重新下载对应版本。查当前 pinned 版本：

```bash
grep -oE 'CHROME_VERSION = "[^"]+"' \
  "$(npm root -g)/hyperframes/dist/cli.js"
```

然后用查到的版本号替换上面命令里的 `152.0.7928.2` 重新下载。npmmirror 镜像 URL 规则：

```text
https://cdn.npmmirror.com/binaries/chrome-for-testing/<版本>/linux64/chrome-headless-shell-linux64.zip
```

## 八、注意事项

- **不要用 `npx playwright install`**：HyperFrames 用 puppeteer-core，两者浏览器下载机制和缓存结构不同。
- **不要用 `@puppeteer/browsers install --base-url` 直装**：本环境下其下载会损坏；改用 curl 下载再手动解压。
- **`--ignore-scripts` 安装 HyperFrames 的后续**：本文方案正是为补上 `--ignore-scripts` 跳过的浏览器下载，详见 `环境依赖安装记录.md`。
- **目录名格式**：缓存目录是 `linux-<buildId>`（不是 `linux64-<buildId>`），解压后的二级目录才是 `chrome-headless-shell-linux64/`。
