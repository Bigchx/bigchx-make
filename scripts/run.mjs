#!/usr/bin/env node
import fs from 'node:fs/promises'
import { notifyUpdates } from './check-update.mjs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { gzipSync, gunzipSync } from 'node:zlib'
import { originalDominantColorStats } from './core/color-stats.js'
import { recommendFilaments, normalizeHex } from './core/filament-colors.js'
import { BAMBU_FILAMENTS, BAMBU_CATALOG } from './core/bambu-filaments.js'
import { PRINT_DEFAULTS, NOZZLES, getModelSize } from './core/print-settings.js'
import { PRINTERS } from './core/printers.js'
import { separateImage, previewImage, hexToRgb } from './core/algorithm.js'

const require = createRequire(import.meta.url)
const saveJson = async (file, value) => {
  await fs.mkdir(path.dirname(path.resolve(file)), { recursive: true })
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n')
}
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'))
const keyRanges = {
  colors: [2, 36, true], nozzle: [.2, .4], widthCm: [.1, 50], heightCm: [.1, 50], blockSize: [1, 10, true],
  thicknessMm: [.01, 100], lineWidth: [.1, 1.2], layerHeight: [.04, .4], firstLayerLineWidth: [.1, 1.2],
  brightness: [-100, 100], contrast: [.5, 1.8], saturation: [0, 1.8], sharpness: [-100, 100],
  blur: [0, 6, true], smooth: [0, 10, true], isolatedPixels: [0, 20, true]
}
const optionalKeys = ['mode', 'lockedColors', 'orientation', 'keepAspect', 'syncFirstLayer']

export function buildSettings(config = {}) {
  if (!config || Array.isArray(config) || typeof config !== 'object') throw new Error('config 必须是 JSON 对象')
  for (const key of Object.keys(config)) if (!(key in keyRanges) && !optionalKeys.includes(key)) throw new Error(`未知参数 ${key}，请读取 references/local-cli.md`)
  for (const [key, [min, max, integer]] of Object.entries(keyRanges)) {
    if (!(key in config) || (key === 'thicknessMm' && config[key] === null)) continue
    const value = config[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`${key} 必须为 ${min}–${max}${integer ? ' 的整数' : ''}`)
  }
  for (const key of ['keepAspect', 'syncFirstLayer']) if (key in config && typeof config[key] !== 'boolean') throw new Error(`${key} 必须为布尔值`)
  const mode = config.mode || 'printable'
  if (!['printable', 'detail', 'mosaic'].includes(mode)) throw new Error('mode 必须为 printable / detail / mosaic')
  const nozzle = config.nozzle ?? .4
  if (![.2, .4].includes(nozzle)) throw new Error('仅支持 .2 / .4 mm 喷嘴')
  const orientation = config.orientation || 'flat'
  if (!['flat', 'vertical'].includes(orientation)) throw new Error('orientation 必须为 flat / vertical')
  if (!Array.isArray(config.lockedColors ?? []) || (config.lockedColors?.length || 0) > 36) throw new Error('lockedColors 必须为最多 36 个 HEX 的数组')
  const locks = (config.lockedColors || []).map(normalizeHex)
  if (locks.some(hex => !hex) || new Set(locks).size !== locks.length) throw new Error('lockedColors 需要不同的有效 #RRGGBB 色值')
  const nozzleKey = `${nozzle.toFixed(1)} mm`
  const settings = {
    ...PRINT_DEFAULTS, ...NOZZLES[nozzleKey], nozzleKey,
    brightness: 0, contrast: 1, saturation: 1, sharpness: 0, blur: 0, smooth: 1,
    isolatedPixels: mode === 'detail' ? 10 : 0, blockSize: 1,
    resolutionMode: mode === 'detail' ? 'manual' : 'print', algorithm: mode === 'printable' ? 'bigchx-k' : 'pixel-kmeans',
    colorCount: locks.length ? Math.max(2, locks.length) : (config.colors ?? 4), lockedSourceColors: locks,
    printWidthCm: config.widthCm ?? 10, printHeightCm: config.heightCm ?? 10, orientation, fresh: true
  }
  for (const key of ['brightness', 'contrast', 'saturation', 'sharpness', 'blur', 'smooth', 'isolatedPixels', 'blockSize', 'layerHeight', 'lineWidth', 'firstLayerLineWidth', 'thicknessMm', 'keepAspect', 'syncFirstLayer']) if (key in config) settings[key] = config[key]
  return settings
}

function warningsFor(settings) {
  const notes = ['几何预览与未切片工程不等于实际走线验证；请在 Bambu Studio 打开为项目并检查切片。']
  if (settings.resolutionMode === 'manual') notes.push('手动块面优先保留工作图细节，不执行 bigchx-K 最小物理特征筛选；增大块面会减少细节和模型尺寸。')
  if (settings.orientation === 'vertical') notes.push('竖放算法仍在开发测试，当前仅推荐平放。')
  const nominal = NOZZLES[settings.nozzleKey].lineWidth
  if (settings.lineWidth < nominal) notes.push(`当前线宽低于此喷嘴的默认 ${nominal} mm，不保证细线可打印。`)
  if (settings.thicknessMm !== null && settings.thicknessMm < settings.layerHeight) notes.push('模型厚度小于首层高度，可能无法切出完整一层。')
  return notes
}

async function loadImage(file, resize = false) {
  const sharp = require('sharp')
  let pipeline = sharp(file, { limitInputPixels: 100000000 }).rotate().toColourspace('srgb')
  if (resize) pipeline = pipeline.resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
  const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (info.width < 2 || info.height < 2) throw new Error('图片宽高至少为 2 px')
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) }
}

const filamentInfo = item => ({ id: item.id, type: item.type, name: item.name, nameEn: item.nameEn, colorCode: item.colorCode, hex: item.hex, filamentId: item.filamentId, kind: item.kind, colors: item.colors })
const recommendations = (hex, sort = 'material') => recommendFilaments(hex, '', 9, sort).map(filamentInfo)

async function analyze(input, out) {
  const original = await loadImage(input)
  const stats = originalDominantColorStats(original)
  let visiblePixels = 0
  for (let i = 3; i < original.data.length; i += 4) if (original.data[i]) visiblePixels++
  const report = {
    application: 'Bigchx Make', catalog: BAMBU_CATALOG,
    width: original.width, height: original.height, totalPixels: original.width * original.height, visiblePixels,
    percentageBasis: 'full-image-pixels; alpha=0 is not counted in colors', uniqueRgbCount: stats.uniqueCount,
    colors: stats.colors.map(item => ({ ...item, recommendations: recommendations(item.hex, 'distance'),
      nearestByPlaFamily: ['PLA Basic', 'PLA Lite', 'PLA Matte', 'PLA Silk', 'PLA Silk+'].flatMap(type => recommendFilaments(item.hex, type, 1, 'distance').map(filamentInfo)) }))
  }
  await saveJson(out, report)
  return { report: path.resolve(out), colors: report.colors.length, uniqueRgbCount: stats.uniqueCount }
}

async function png(file, image) {
  const sharp = require('sharp')
  await sharp(Buffer.from(image.data), { raw: { width: image.width, height: image.height, channels: 4 } }).png().toFile(file)
}

function render(result, palette, selected = -1) {
  const data = new Uint8ClampedArray(result.width * result.height * 4)
  const colors = palette.map(item => hexToRgb(item.hex))
  result.labels.forEach((label, index) => {
    if (label < 0 || (selected >= 0 && label !== selected)) return
    const color = colors[label]
    if (!color) throw new Error('图层标签与调色板不匹配')
    data.set([...color, 255], index * 4)
  })
  return { width: result.width, height: result.height, data }
}

async function saveState(out, state) {
  await fs.mkdir(out, { recursive: true })
  await fs.writeFile(path.join(out, 'project.json.gz'), gzipSync(JSON.stringify(state, (_, value) => ArrayBuffer.isView(value) ? Array.from(value) : value)))
  await png(path.join(out, 'preview.png'), render(state.result, state.palette))
  const layers = state.palette.map((item, index) => ({ layer: index + 1, hex: item.hex, pixels: state.result.area[index], percent: state.result.area[index] / state.result.labels.length * 100, filament: item.filament || null, recommendations: recommendations(item.hex) }))
  for (let i = 0; i < layers.length; i++) await png(path.join(out, `layer-${String(i + 1).padStart(2, '0')}.png`), render(state.result, state.palette, i))
  await saveJson(path.join(out, 'layers.json'), { layers, printSpec: state.result.printSpec, printReport: state.result.printReport, warnings: warningsFor(state.settings) })
}

export async function loadState(file) {
  const state = JSON.parse(gunzipSync(await fs.readFile(file), { maxOutputLength: 256 * 1024 * 1024 }).toString())
  if (state.version !== 1 || !state.result || !Array.isArray(state.palette) || state.palette.length < 1 || state.palette.length > 36) throw new Error('不是有效的 Bigchx 技能项目文件')
  const result = state.result
  if (!Number.isInteger(result.width) || !Number.isInteger(result.height) || result.width < 2 || result.height < 2 || result.width * result.height > 4000000 || !Array.isArray(result.labels) || result.labels.length !== result.width * result.height) throw new Error('项目图片尺寸或标签无效')
  if (result.labels.some(label => !Number.isInteger(label) || label < -1 || label >= state.palette.length) || state.palette.some(p => !normalizeHex(p.hex))) throw new Error('项目色值或标签无效')
  result.labels = Int16Array.from(result.labels)
  return state
}

async function assignMaterials(state, file) {
  if (!file) return
  const assignments = await readJson(file)
  if (!Array.isArray(assignments)) throw new Error('assignments 必须为数组')
  const seen = new Set()
  for (const assignment of assignments) {
    const index = assignment.layer - 1
    if (!Number.isInteger(index) || !state.palette[index] || seen.has(index)) throw new Error('图层编号无效或重复')
    seen.add(index)
    if (assignment.filament) {
      const filament = BAMBU_FILAMENTS.find(item => item.id === assignment.filament)
      if (!filament) throw new Error(`耗材组件 ID 不存在：${assignment.filament}`)
      if (assignment.hex) throw new Error('每个分配项只能指定 filament 或 hex')
      state.palette[index] = { ...state.palette[index], hex: filament.hex, filament: { ...filament } }
    } else {
      const hex = normalizeHex(assignment.hex)
      if (!hex) throw new Error('分配项需要有效的 filament ID 或 hex')
      state.palette[index] = { ...state.palette[index], hex, filament: null }
    }
  }
  state.result.palette = state.palette
}

export async function main(argv = process.argv.slice(2)) {
  const [command = 'help', ...args] = argv
  const options = {}
  for (let i = 0; i < args.length; i += 2) {
    if (!/^--[a-z]+$/.test(args[i]) || args[i + 1] === undefined || args[i + 1].startsWith('--')) throw new Error('参数格式为 --名称 值')
    const key = args[i].slice(2)
    if (key in options) throw new Error(`重复参数 --${key}`)
    options[key] = args[i + 1]
  }
  const allowed = { help: [], catalog: ['out'], analyze: ['input', 'out'], separate: ['input', 'config', 'out'], recolor: ['state', 'assignments', 'out'], export: ['state', 'assignments', 'printer', 'out'] }
  if (!(command in allowed)) throw new Error('未知命令；使用 help')
  for (const key of Object.keys(options)) if (!allowed[command].includes(key)) throw new Error(`${command} 不支持 --${key}`)
  const required = keys => { for (const key of keys) if (!options[key]) throw new Error(`需要 --${key}`) }
  if (command === 'help') return { commands: ['analyze --input image.png --out colors.json', 'separate --input image.png --config config.json --out preview-dir', 'recolor --state preview-dir/project.json.gz --assignments assignments.json --out recolored-dir', 'export --state recolored-dir/project.json.gz --printer A1 --out model-dir', 'catalog [--out catalog.json]'], reference: 'references/local-cli.md', compute: 'local Node.js; no HTTP API' }
  await notifyUpdates(({ catalog: ['filament'], analyze: ['color-analysis', 'filament'], separate: ['separation'], recolor: ['filament'], export: ['print-export', 'filament'] })[command])
  if (command === 'catalog') {
    const value = { version: BAMBU_CATALOG, printers: PRINTERS, nozzles: NOZZLES, filaments: BAMBU_FILAMENTS.map(filamentInfo) }
    if (options.out) { await saveJson(options.out, value); return { catalog: path.resolve(options.out) } }
    return value
  }
  required(['out'])
  if (command === 'analyze') { required(['input']); return analyze(options.input, options.out) }
  const out = path.resolve(options.out)
  if (command === 'separate') {
    required(['input', 'config'])
    const config = await readJson(options.config), settings = buildSettings(config)
    const source = await loadImage(options.input, true)
    const result = separateImage(source, settings, [], message => process.stderr.write(message + '\n'), false)
    if (result.area.every(area => !area)) throw new Error('没有可分色的非透明像素')
    const state = { version: 1, config, settings, result, palette: result.palette }
    await saveState(out, state)
    await png(path.join(out, 'processed.png'), previewImage(source, settings))
    return { preview: path.join(out, 'preview.png'), state: path.join(out, 'project.json.gz'), layers: path.join(out, 'layers.json'), colors: result.palette.length, sizeMm: getModelSize(result.printSpec), warnings: warningsFor(settings) }
  }
  required(['state'])
  if (command === 'recolor') required(['assignments'])
  if (command === 'export') required(['printer'])
  const state = await loadState(options.state)
  await assignMaterials(state, options.assignments)
  if (command === 'export') {
    const bed = PRINTERS[options.printer]
    if (!bed) throw new Error(`未知机型 ${options.printer}；使用 catalog 查看支持列表`)
    const size = getModelSize(state.result.printSpec)
    if (size.width > bed.x || size.depth > bed.y || size.height > bed.z) throw new Error(`模型 ${size.width.toFixed(2)} × ${size.depth.toFixed(2)} × ${size.height.toFixed(2)} mm 超出 ${options.printer} 平台；按最终尺寸重算或增加手动块面值。仅更换喷嘴不会缩小按打印尺寸模式的成品。`)
    const { createModelArchive } = await import('./core/model-export.js')
    const { default: JSZip } = await import('jszip')
    const blob = await createModelArchive(state.result, state.palette, { printerName: options.printer })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const archive = await JSZip.loadAsync(bytes)
    await saveState(out, state)
    const model = path.join(out, 'bigchx-make-model.3mf')
    await fs.writeFile(model, await archive.file('bigchx-make-model.3mf').async('uint8array'))
    await fs.writeFile(path.join(out, 'bigchx-make-models.zip'), bytes)
    return { model, archive: path.join(out, 'bigchx-make-models.zip'), preview: path.join(out, 'preview.png'), printer: options.printer, sizeMm: size, sliced: false, warnings: warningsFor(state.settings) }
  }
  await saveState(out, state)
  return { preview: path.join(out, 'preview.png'), state: path.join(out, 'project.json.gz'), layers: path.join(out, 'layers.json') }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(value => process.stdout.write(JSON.stringify(value, null, 2) + '\n')).catch(error => {
    process.stderr.write(JSON.stringify({ error: error.message }) + '\n')
    process.exitCode = 1
  })
}
