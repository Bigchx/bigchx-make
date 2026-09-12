# 本地执行 / Local CLI

先按 install.md 安装完整技能与 Node 依赖。以下从技能目录执行，路径包含空格时使用引号。`--out` 只写指定文件/目录，重复运行会更新该目录内同名产物，请为不同任务使用不同输出目录。退出码 0 才表示完成；进度与错误写 stderr，stdout 是最终 JSON。这里不是 HTTP API。

## 漫画矢量稿渲染

曲线由助手按 [矢量重绘指南](vector-redraw.md) 编写，使用以下独立辅助脚本渲染；`run.mjs` 的现有五个命令保持不变。

```sh
node scripts/render-svg.mjs --input "/path/artwork.svg" --out "/path/job/vector" --size 1600
```

输入为自包含、显式六位 HEX 填色的几何 SVG，输出可编辑 `artwork.svg`、保留 alpha 的 `transparent.png`、白底查看图 `preview.png`、按主体 alpha 裁剪的 `subject-print.png`、声明色值 `palette.json` 和渲染信息 `render.json`。`--size` 为最长边像素数，64–4096，默认 1600；打印输入仍会按分色命令的最大边 1200 px 规则重采样。该脚本渲染已有矢量稿，不执行照片自动描摹；详细支持范围见指南。

制作去背景模型时使用 `subject-print.png`，按实际尺寸运行 `separate`，内部白色会保留；不要拿白底 `preview.png` 重新生成背景实体。

## 1. 分析完整原图

```sh
node scripts/run.mjs analyze --input "/path/photo.png" --out "/path/job/colors.json"
```

`colors.json` 返回原图尺寸、totalPixels、visiblePixels、uniqueRgbCount、colors。每个主色有 `hex/count/percent`，`recommendations` 为 9 个纯色差排序推荐，`nearestByPlaFamily` 额外给五种 PLA 系列各自最近项。不要把这两组重复项当不同耗材。推荐字段包含完整组件 `id`、类型、名称、`colorCode`、`hex`、官方材料系列 `filamentId`。

`percent` 已是百分数（如 26.3），无需再次乘 100。分母是整图像素数，完全透明像素不进入颜色组；不透明照片的主色组占比合计约 100%。不要把 grouped count 报告为单个精确 HEX 的出现次数。

## 2. 分色与预览

配置文件示例 `config.json`（实际值由用户用途决定）：

```json
{
  "mode": "printable",
  "colors": 4,
  "lockedColors": [],
  "nozzle": 0.4,
  "widthCm": 10,
  "heightCm": 10,
  "keepAspect": true,
  "orientation": "flat",
  "thicknessMm": 1.2,
  "smooth": 1,
  "isolatedPixels": 0
}
```

```sh
node scripts/run.mjs separate --input "/path/photo.png" --config config.json --out "/path/job/separated"
```

输出 `preview.png` 为与 LAYER EDITOR 同一标签图渲染的分色合并预览；`processed.png` 为图像处理结果；`layer-01.png` 等为透明单层；`layers.json` 含每层占比、推荐、实际打印计划与提醒；`project.json.gz` 保存模型几何和标签，供换色/导出继续使用。它不是 Bambu 工程，真正工程是 export 的 `.3mf`。

原图统计使用完整分辨率；分色工作图缩到最大边 1200 px，规则与网页一致。不要从 PNG 像素数推断毫米，必须看 `printSpec` / `sizeMm`。默认模式 printable，默认 4 色，但助手应先澄清用户未给出的目标与数量，而不是擅自假定。

### 参数

除以下字段外的拼错/未知参数会报错，避免静默忽略。

| 字段 | 可选值/默认 | 说明 |
| --- | --- | --- |
| mode | printable / detail / mosaic | 对应 bigchx-K / 手动块面 / 像素方块 |
| colors | 整数 2–36，默认 4 | 无原图锁时生效 |
| lockedColors | 不同的 #RRGGBB 数组，最多 36 | 1 个锁→2 色；多个锁→锁数量，无需另填同值 colors |
| nozzle | .2 / .4，默认 .4 | 自动采用 .10/.20 层高与 .22/.42 线宽 |
| widthCm / heightCm | .1–50，默认 10 | 按打印尺寸模式的外接范围 |
| keepAspect | true / false，默认 true | 图片等比放进范围 |
| orientation | flat / vertical | 默认 flat；vertical 实验性、不推荐 |
| thicknessMm | .01–100 或 null | null 自动随平放层高/竖放线宽；总厚度 |
| blockSize | 整数 1–10，默认 1 | 仅 detail 模式生效 |
| layerHeight / lineWidth | .04–.4 / .1–1.2 mm | 允许编辑不等于该喷嘴都能打印 |
| syncFirstLayer | 默认 true | 首层线宽随普通线宽 |
| firstLayerLineWidth | .1–1.2 mm | syncFirstLayer=false 才独立使用 |
| brightness / contrast / saturation | -100–100 / .5–1.8 / 0–1.8 | 默认 0/1/1 |
| sharpness / blur | -100–100 / 整数 0–6 | 默认 0/0；负锐化柔化 |
| smooth | 整数 0–10，默认 1 | 标签边界平滑 |
| isolatedPixels | 整数 0–20 | printable/mosaic 默认 0；detail 默认建议值 10 |

输入限 1 亿像素，分色计算限 400 万采样点；内存较小的环境可提前降低图片分辨率，但应明确这时原图统计针对的是缩小后的输入。静态技能本身不启动持久服务。

## 3. 图层换色 / 材料分配

根据 `layers.json` 的推荐或 `catalog` 取得真实组件 `id`。**不要使用通用 GFA00 代替组件 ID**；同一材料系列有许多颜色。

`assignments.json` 示例（hex 用于手动颜色；filament 应填写实际目录返回的 id）：

```json
[
  { "layer": 1, "hex": "#FFFFFF" }
]
```

官方耗材分配格式为 `{ "layer": 2, "filament": "从推荐结果复制的完整 id" }`，不要按示例文字直接运行。一次分配只能有 filament 或 hex，图层号从 1 开始。未列出的图层保持原色。选择 filament 时保存材料身份、官方色值和温度预设；手动 hex 会清除该层材料选择。

```sh
node scripts/run.mjs recolor --state "/path/job/separated/project.json.gz" --assignments assignments.json --out "/path/job/recolored"
```

重新返回 recolored/preview.png；换色只更改调色板，像素区域不变。锁定选择适用于下一轮分色，手动换色不会偷偷再执行 KMeans。

## 4. 导出机型专用 3MF

```sh
node scripts/run.mjs export --state "/path/job/recolored/project.json.gz" --printer "A1" --out "/path/job/model"
```

可另加 `--assignments assignments.json` 一次应用材料后导出。必须显式指定支持的 printer；`catalog` 返回 14 款平台及官方材料组件。

输出 `.3mf`、完整 STL/SVG/3MF ZIP、最终配色 `preview.png`、单层 PNG 和可继续修改的项目文件。SVG 仅 bigchx-K 模式提供。若没有非空网格、超出平台或所选材料无对应官方预设，命令失败并给出具体原因。只比较包围盒不自动给擦拭塔排版，不生成 G-code，不调用实际打印机。

```sh
node scripts/run.mjs catalog --out catalog.json
```

支持 A1 mini、A1、P1P、P1S、X1、X1C、X1E、A2L、P2S、H2D、H2D Pro、H2S、H2C、X2D。含空格型号必须引号包裹。

本地脚本暂不提供画笔框选、隐藏遮罩、逐像素编辑的 CLI 命令；需要这些操作时使用网页，不能通过自己猜测或修改压缩项目中的标签来声称等同于已验证编辑流程。
