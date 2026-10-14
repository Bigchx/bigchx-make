# Bigchx Make

[English](README.md)

Bigchx Make 是一个把图片整理为干净、可打印多色图稿的 Agent Skill。它整合原图主色分析、有限色分层、助手辅助漫画矢量重绘、拓竹官方耗材匹配，以及按打印机生成 3MF 工程。

本仓库是由 `bigchx` GitHub 组织维护的公开 `bigchx-make` 技能包，可直接获取并安装。

## 当前能力

- 从完整原图统计主色，返回 HEX、像素数、占比和拓竹耗材匹配。
- 按可打印、细节或马赛克目标分成 2–36 个图层，支持锁色、透明区域和可编辑状态。
- 由助手理解主体并编写平滑贝塞尔曲线，统一描边、有限纯色，输出透明 SVG/PNG 预览。
- 使用拓竹官方材料和颜色身份重新配色。
- 生成保持图层对齐的平面多色 3MF / STL / SVG 工程。
- 创建连续矩形底板，并按明确的 Z 高度生成凸起 Logo。
- 根据匹配的 Bambu Suite 模板生成激光（`LaserImageEngrave`）或刀切（`KCPrintThenCut`）LAC 项目，并校验机型、材料和尺寸。

## 激光 LAC 项目

技能包可以根据已验证的 `.lac` 模板生成可编辑的 Bambu Suite 激光项目。它继承模板的机型、材料和 `LaserImageEngrave` 参数，替换图片与预览，并删除模板 G-code，避免误把旧图片加工出去。

```sh
node scripts/laser-lac.mjs \
  --input logo.png \
  --template laser-template.lac \
  --machine "Bambu Lab H2C-10W" \
  --material "200g Kraft Paper" \
  --out job/logo-laser.lac
```

输出是未切片的 LAC 项目。请在 Bambu Suite 中打开并重新切片，确认新图片对应的 G-code 后再加工。

刀切时请使用刀切模板并传入 `--mode blade`；激光使用 `--mode laser`。用 `--width-mm` 和 `--height-mm` 指定成品尺寸，脚本会校验模板工艺与模式一致。

## 快速开始

要求：Node.js 22.12 或更高版本（推荐 Node 24 LTS）和 npm。

```sh
npm install --omit=dev
node scripts/run.mjs help
node scripts/run.mjs catalog
```

本地示例流程：

```sh
node scripts/run.mjs analyze --input photo.png --out job/colors.json
node scripts/run.mjs separate --input photo.png --config config.json --out job/separated
node scripts/run.mjs recolor --state job/separated/project.json.gz --assignments assignments.json --out job/recolored
node scripts/run.mjs export --state job/recolored/project.json.gz --printer A1 --out job/model
```

助手已经编写好平涂 SVG 后，可运行：

```sh
node scripts/render-svg.mjs --input job/artwork.svg --out job/vector --size 1600
```

渲染器会同时输出可编辑源文件、透明 `transparent.png`、白底查看用 `preview.png`，以及供后续物理分色使用的 `subject-print.png`。

## 在 Agent 客户端安装

把完整目录作为 `bigchx-make` 安装到客户端的 skills 目录。不要只复制 `SKILL.md`：本地命令还依赖 `scripts/`、`references/`、`assets/`、官方配置快照和包清单。

通过 GitHub 仓库压缩包获取完整技能：

<https://github.com/Bigchx/bigchx-make/archive/refs/heads/main.zip>

<https://skills.bigchx.com/> 提供 Skills 文档和浏览器工作台。网页是静态浏览器应用，图片计算在浏览器中完成，或通过本地 Node.js 技能包执行；没有远程图片计算 API。

## 打印行为

默认推荐平放。生成的 3MF 是未切片的 Bambu Studio 项目，不是打印任务，也不会绑定用户的 AMS 槽位。只有实际调用切片器检查成功后，才能称为“已切片验证”。技能支持的图层颜色数量与打印机能自动装载的耗材数量是两回事。

## 版本与更新

当前技能包版本为 **2.3.2**。模块版本和发布记录见 `manifest.json` 与 `releases.json`。任务开始前可检查公开清单：

```sh
node scripts/check-update.mjs --force
```

检查结果只用于提示，带缓存并支持离线继续；不会自动安装或覆盖文件。

## 范围与路线图

成熟流程覆盖主色分析、分色、矢量重绘指导、耗材匹配、平面多色打印导出和凸起 Logo 底板。自由曲面浮雕、完整立体/CAD 重建、雕刻/CAM 刀路，以及 UV 打印和纹理仍是规划方向，目前不作为已完成命令提供。

## 开发与发布说明

算法主源维护在配套网页项目中；本包的 `scripts/core` 是供 Agent 执行的同步运行副本。发布时请保持模块版本、整包版本、`manifest.json`、`releases.json` 和 `SKILL.md` 元数据一致。不要把用户图片、生成模型、依赖缓存或发布 ZIP 放入本仓库。

作者信息、拓竹配置来源和第三方依赖说明见 `NOTICE.md`。

## 许可证

bigchx 自有代码和文档采用 [MIT 许可证](LICENSE)。第三方数据、依赖和商标不在该授权范围内；适用范围及来源见 [NOTICE.md](NOTICE.md)。
