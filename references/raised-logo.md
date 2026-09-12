# 凸起 Logo 与连续底板 · raised-logo 1.0.0

将已分色的平面图案放在连续矩形底板上，Logo 比底板顶面多一个或多个切片层高。这是明确高度的分层挤出，不是照片深度估计或自由曲面浮雕。

默认：底板 2 mm，Logo 增加 1 层。沿用用户的喷嘴、尺寸和层高；0.4 mm 喷嘴默认层高为 0.2 mm，所以底板 Z=0–2 mm、Logo Z=2–2.2 mm，总高 2.2 mm。**2 mm 是底板厚度，0.2 mm 才是切片层高。** 底板厚度必须是层高的整数倍，保证接触面落在切片层边界。

1. 按最终尺寸用 `mode: printable`、`orientation: flat` 生成分色项目。可先 recolor 匹配官方耗材。
2. 检查 layers.json 和单层预览，选出实际 Logo 图层，排除背景。输入已透明时可以省略 `--layers`；否则必须明确选择图层。编号从 1 开始，不按颜色名称猜编号。
3. 生成工程，例如黑色 Logo 对应第 2 层：

```sh
node scripts/raised-logo.mjs --state job/separated/project.json.gz --layers 2 --base-thickness 2 --raise-layers 1 --base-color "#FFFFFF" --printer A1 --out job/raised
```

多种 Logo 颜色用 `--layers 2,3`。底板颜色使用 `--base-color`，或用 `--base-filament` 指定官方完整耗材组件 ID。底板加图案最多 36 个部件。底板覆盖整张图的矩形外接范围；透明孔洞在上层保留，底板在其下方连续连接。当前没有异形底板、倒角、自由曲面或逐像素高度编辑参数。

输出：`bigchx-make-raised-logo.3mf`、包含 STL/SVG/参数的 ZIP、`height-plan.json`。底板是单独部件，Logo 各色部件从底板顶面起始，没有相互穿插体积；保留对齐位置，在 Bambu Studio **打开为项目**。切片时也保持各部件位置，不逐个自动落地。

脚本不自动切片、不安排人工换料或自动绑定 AMS。实际切片通过后再说明层数与用料。若仅两色且按高度换色，可在切片软件安排顶部换料；未安排暂停前不要把工程称为可直接人工换料打印。

网页主页提供固定案例与高度示意；工作台当前的普通厚度控件仍是同厚导出，凸起流程使用本辅助脚本。
