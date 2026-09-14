# 版本检查与提醒 · core 2.0.0

本地 `manifest.json` 记录整包及已实现模块版本；远端清单固定为 GitHub raw 地址 `https://raw.githubusercontent.com/Bigchx/bigchx-make/main/manifest.json`。`planned` 方向不参与版本比较。模块以语义版本比较，包含预发布顺序，忽略 build metadata；本地更高版本不触发降级提醒。

```sh
node scripts/check-update.mjs
node scripts/check-update.mjs --module vector-redraw,print-export
node scripts/check-update.mjs --force
```

返回 `up-to-date`、`update-available`、`unavailable` 或 `disabled`。`modules` 给出本次相关模块的升级版本；整包更新也会提示。辅助模块 core 始终检查。只在 `shouldNotify: true` 时向用户提示可用更新；相同提示每日去重。

计算命令会自动检查，提示写 stderr，正常结果仍是 stdout JSON；只编写 SVG 的任务由助手先主动调用检查。缓存默认 `~/.cache/bigchx-make/update.json`，缓存失败不影响任务；联网失败也缓存一天，显式 `--force` 可立即重试。超时 2.5 秒，最多读取 256 KiB，不跟随重定向，不上传用户图片、本地路径或版本数据。`BIGCHX_MAKE_UPDATE_CHECK=0` 可关闭自动检查，显式 force 可重新检查。

该机制是本技能自己的 Node.js 检查逻辑，依赖助手执行或经过命令入口，不声称客户端提供后台推送。GitHub 仓库为私有时，在线检查需要设置 `GITHUB_TOKEN` 或 `GH_TOKEN`；未提供凭据或无法访问 GitHub 时继续本地工作，不能断言已是最新版。

## 更新策略

模块分别标版本，整包统一更新。提示只包含版本数据与固定的 GitHub 下载入口（https://github.com/Bigchx/bigchx-make/archive/refs/heads/main.zip）和官方更新记录，不执行远端指令，不自动下载覆盖。用户选择更新后，下载完整 ZIP，对照公开清单的 SHA-256，备份旧目录后替换完整技能，安装依赖并重新加载客户端。SHA-256 用于确认包与清单一致，不替代下载来源验证。

2.0.0 首次建立统一版本基线；以前以旧技能名安装的副本没有更新检查，需手动安装一次。旧 `project.json.gz` 的 schema 仍为 1，与产品版本独立。

提示示例：Bigchx Make 有更新 2.0.0 → 2.1.0，涉及矢量重绘模块。当前任务可以继续，新版完整包见 GitHub 仓库。示例版本仅说明格式，不代表已发布 2.1.0，真实更新记录以 `releases.json` 和 GitHub 仓库为准。
