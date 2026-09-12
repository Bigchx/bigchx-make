import JSZip from 'jszip'
import { exportLayerStl, exportContourSvg, getPartHeightRange } from './print-geometry.js'
import { getModelThickness } from './print-settings.js'
import { create3mfArchive } from './bambu-3mf.js'

export async function createModelArchive(result, palette, options = {}) {
  const zip = new JSZip(), layers = [], exportedLayers = []
  for (let layer = 0; layer < palette.length; layer++) {
    const stl = exportLayerStl(result, layer)
    if (!stl) continue
    const name = `layer-${String(layer + 1).padStart(2, '0')}-${palette[layer].hex.slice(1)}`
    zip.file(`${name}.stl`, stl)
    const svg = exportContourSvg(result, palette, layer)
    if (svg) zip.file(`${name}.svg`, svg)
    layers.push({ file: `${name}.stl`, color: palette[layer].hex, filament: palette[layer].filament || null, ...getPartHeightRange(result, layer) })
    exportedLayers.push({ layer })
  }
  if (!layers.length) throw new Error('没有可导出的图层')
  const threeMf = await create3mfArchive(result, palette, exportedLayers, options)
  if (threeMf) zip.file('bigchx-make-model.3mf', threeMf)
  const composite = exportContourSvg(result, palette)
  if (composite) zip.file('composite.svg', composite)
  zip.file('print-settings.json', JSON.stringify({ application: 'Bigchx Make', author: 'bigchx', website: 'https://skills.bigchx.com/', units: 'mm', ...result.printSpec, thicknessMm: getModelThickness(result.printSpec), layers, heightPlan: result.heightPlan, report: result.printReport }, null, 2))
  zip.file('导入说明.txt', [
    'Bigchx Make · 由 bigchx 开发 · 官网 https://skills.bigchx.com/',
    '全部 STL 使用毫米单位，各颜色图层共用坐标。',
    '在 Bambu Studio 中一次选择所有 STL，并选择作为一个对象的多个部分导入，再分别指定耗材颜色。',
    '不要分别自动排列、居中或落地，否则图层会错位。STL 本身不携带颜色或切片参数。',
    '已选耗材类型、颜色名与官方色号保存在 print-settings.json 的 layers 中。',
    '在 Bambu Studio 中通过“文件 → 打开项目”打开 bigchx-make-model.3mf；若询问导入方式，请选择“打开为项目”，以载入耗材和打印参数。',
    '3MF 将各颜色保存为同一对象的独立部件，包含对应机型/喷嘴的官方预设、层高、线宽、图层耗材槽位和颜色。',
    '图层已选择的官方耗材会带入对应类型和温度；未指定耗材的手动颜色使用当前机器的 PLA Basic 预设。',
    '换色冲刷量采用初始默认值，请按实际耗材在 Bambu Studio 中重新计算；必要时调整擦拭塔位置。',
    `普通线宽、外墙线宽：${result.printSpec.lineWidth} mm；层高和首层层高：${result.printSpec.layerHeight} mm；首层线宽：${result.printSpec.firstLayerLineWidth} mm。`,
    `保持 100% 比例。模型厚度为 ${getModelThickness(result.printSpec)} mm，各部件的起止高度见 print-settings.json；请保持部件位置。`,
    'SVG 是毫米尺寸的连续轮廓。PNG 是高精度采样图，一个像素不等于一道挤出线。',
    '几何约束无法替代切片验证。打印前检查实际走线；孤立部件可能需要底板，竖放悬空区域可能需要支撑。'
  ].join('\n'))
  zip.file('IMPORT.txt', [
    'Bigchx Make / bigchx-K',
    'Developed by bigchx · Official website: https://skills.bigchx.com/',
    'All STL files use millimeters and share the same origin and Z-up coordinates.',
    'Select ALL layer STL files together in Bambu Studio and import as ONE object with multiple parts.',
    'Do not auto-arrange, center or drop each part separately. Assign a filament to each part.',
    'STL does not store colors or slicer settings. See print-settings.json for part colors and dimensions.',
    'Use File → Open Project in Bambu Studio to open bigchx-make-model.3mf. If prompted, choose Open as Project to load materials and print settings.',
    'The 3MF stores color regions as parts of one object, with official printer/nozzle presets, layer heights, line widths, filament slots and colors.',
    'Selected official filaments retain their material type and temperatures. Unassigned custom colors use the machine-specific PLA Basic preset.',
    'Purge volumes use initial defaults; recalculate them for your actual filaments in Bambu Studio and adjust the wipe tower position if needed.',
    `Set line width and outer-wall width to ${result.printSpec.lineWidth} mm.`,
    `Set layer height AND first-layer height to ${result.printSpec.layerHeight} mm.`,
    `Set first-layer line width to ${result.printSpec.firstLayerLineWidth} mm.`,
    `Keep scale at 100%. Model thickness is ${getModelThickness(result.printSpec)} mm; see print-settings.json for each part’s bottom/top height; preserve all part positions.`,
    'SVG files contain continuous contours in mm. PNG pixels are high-resolution samples, not extrusion widths.',
    'Minimum-feature filtering is a geometric approximation, not a toolpath guarantee.',
    'Inspect the sliced toolpaths before printing; disconnected islands may need a backing or supports.',
    'Transparent holes remain excluded.'
  ].join('\n'))
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}
