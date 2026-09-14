# 激光 LAC 项目 / Laser LAC projects

`laser-lac.mjs` 将一个已验证的 Bambu Suite 激光 `.lac` 作为参数模板，替换输入图片并保留模板中的机型、材料和激光图像工艺。它生成的是可在 Bambu Suite 中继续切片的项目包，不是已经针对新图片生成的机器 G-code。

## 生成

```sh
node scripts/laser-lac.mjs \
  --input "/path/logo.png" \
  --template "/path/激光模板.lac" \
  --machine "Bambu Lab H2C-10W" \
  --material "200g Kraft Paper" \
  --out "/path/job/logo-laser.lac"
```

模板必须包含 `2D/2dmodel.json`、`Metadata2D/project_settings.json`、`2D/Objects/*.png`，并且对象工艺为 `LaserImageEngrave`。`--machine` 与 `--material` 用于校验模板选择，避免误用其他预设；省略时沿用模板值。

脚本会把图片缩放到模板的 960×960 对象尺寸，更新 768、512、128 和全幅预览，并移除模板中已有的 `.gcode`。移除旧 G-code 是强制安全规则：G-code 与模板原图绑定，复制它会加工错误图像。

## 参数继承与限制

- 机型、材料、加工速度、功率、灰度映射、扫描间隔、双向扫描、过扫描、气泵和安全 G-code 均继承模板。
- 当前验证模板为 `Bambu Lab H2C-10W` + `200g Kraft Paper` + `LaserImageEngrave`；换机型或材料时，先在 Bambu Suite 导出对应的已验证激光 `.lac` 作为模板。
- 输出字段 `sliced: false` 是预期结果。打开 `.lac` 后由 Bambu Suite 重新切片，再检查预览、尺寸、功率和 G-code。
- 脚本不启动打印、不绑定设备、不声称已完成加工验证。

## 验证

```sh
node scripts/laser-lac.mjs --input logo.png --template 激光模板.lac --out job/logo-laser.lac
```

命令退出码为 0 且输出 JSON 后，再在 Bambu Suite 打开项目。ZIP/CRC 可由标准 ZIP 工具检查；只有 Bambu Suite 针对新图片重新切片成功，才可称为“已切片验证”。
