#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import JSZip from 'jszip'
import sharp from 'sharp'

const parseArgs = argv => {
  const out = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    if (!/^--[a-z-]+$/.test(key) || argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new Error('参数格式为 --名称 值')
    out[key.slice(2)] = argv[i + 1]
  }
  return out
}

const json = value => Buffer.from(JSON.stringify(value, null, 4) + '\n')
const requireArg = (args, key) => { if (!args[key]) throw new Error(`需要 --${key}`); return args[key] }

async function makePreview(input, width, height, grayscale = false) {
  let image = sharp(input, { limitInputPixels: 100_000_000 }).rotate().resize(width, height, { fit: 'fill' })
  if (grayscale) image = image.grayscale()
  return image.png().toBuffer()
}

export async function createLaserLac({ input, template, out, machine, material, mode = 'laser', widthMm, heightMm }) {
  const zip = await JSZip.loadAsync(await fs.readFile(template))
  const settings = JSON.parse(await zip.file('Metadata2D/project_settings.json').async('string'))
  const project = settings.project_settings || {}
  const batch = settings.canvas_settings?.[0]?.making_batch_list?.[0]
  if (!batch) throw new Error('模板缺少 canvas_settings/making_batch_list')
  if (machine && project.machine_settings_name !== machine) throw new Error(`模板机型为 ${project.machine_settings_name}，不是 ${machine}`)
  if (material && batch.material_name !== material) throw new Error(`模板材料为 ${batch.material_name}，不是 ${material}`)
  const processType = settings.canvas_settings?.[0]?.object_settings?.[0]?.process_type
  const expected = mode === 'laser' ? 'LaserImageEngrave' : mode === 'blade' ? 'KCPrintThenCut' : null
  if (!expected) throw new Error('--mode 只能是 laser 或 blade')
  if (processType !== expected) throw new Error(`模板工艺为 ${processType}，与 --mode ${mode} 不匹配`)

  const modelFile = zip.file('2D/2dmodel.json')
  if (!modelFile) throw new Error('模板缺少 2D/2dmodel.json')
  const model = JSON.parse(await modelFile.async('string'))
  const object = model.canvas_list?.[0]?.obj_list?.[0]
  if (!object) throw new Error('模板缺少 RasterImage 对象')
  const oldObjectPath = Object.keys(zip.files).find(name => name.startsWith('2D/Objects/') && name.endsWith('.png'))
  if (!oldObjectPath) throw new Error('模板缺少 2D/Objects/*.png')

  const stem = path.basename(input, path.extname(input))
  const objectName = `${stem}.png`
  const baseWidthMm = 50
  const baseHeightMm = 50
  const targetWidthMm = widthMm ? Number(widthMm) : baseWidthMm
  const targetHeightMm = heightMm ? Number(heightMm) : baseHeightMm
  if (![targetWidthMm, targetHeightMm].every(value => Number.isFinite(value) && value >= 1 && value <= 500)) throw new Error('width-mm / height-mm 必须是 1–500 的数字')
  const scaleX = targetWidthMm / baseWidthMm
  const scaleY = targetHeightMm / baseHeightMm
  object.file_name = objectName
  object.name = stem
  object.width = 960
  object.height = 960
  const canvas = model.canvas_list?.[0]
  const component = canvas?.components?.find(item => item.obj_id === object.obj_id)
  if (component) {
    const parts = component.transform.split(/\s+/).map(Number)
    if (parts.length === 6) component.transform = `${(0.0520833 * scaleX).toFixed(7)} 0 0 ${(0.0520833 * scaleY).toFixed(7)} ${parts[4]} ${parts[5]}`
  }
  const plateComponent = batch.making_plate_list?.[0]?.components?.find(item => item.obj_id === object.obj_id)
  if (plateComponent) {
    const parts = plateComponent.transform.split(/\s+/).map(Number)
    if (parts.length === 6) plateComponent.transform = `1 0 0 1 ${parts[4] || 0} ${parts[5] || 0}`
  }
  zip.file('2D/2dmodel.json', json(model))
  settings.canvas_settings[0].making_batch_list[0].requested_size_mm = { width: targetWidthMm, height: targetHeightMm }
  zip.file('Metadata2D/project_settings.json', json(settings))
  zip.remove(oldObjectPath)
  zip.file(`2D/Objects/${objectName}`, await makePreview(input, 960, 960))
  zip.file('2D/design_thumbnail.png', await makePreview(input, 768, 768))
  zip.file('Metadata2D/c1_b1_p1.png', await makePreview(input, 512, 512, true))
  zip.file('Metadata2D/c1_b1_p1_small.png', await makePreview(input, 128, 128, true))
  zip.file('Metadata2D/full_c1_b1_p1.png', await makePreview(input, 496, 512, true))
  zip.file('Metadata2D/full_c1_b1_p1_small.png', await makePreview(input, 170, 176, true))
  for (const name of Object.keys(zip.files)) if (name.endsWith('.gcode')) zip.remove(name)

  await fs.mkdir(path.dirname(path.resolve(out)), { recursive: true })
  await fs.writeFile(out, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
  return {
    output: path.resolve(out),
    machine: project.machine_settings_name,
    material: batch.material_name,
    processType,
    mode,
    sizeMm: { width: targetWidthMm, height: targetHeightMm },
    sliced: false,
    gcodeIncluded: false,
    note: 'LAC 项目包已生成，可直接导入 Bambu Suite；如需机器 G-code，请在 Suite 中重新切片，不能复用模板 G-code。'
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  const input = requireArg(args, 'input')
  const template = requireArg(args, 'template')
  const out = requireArg(args, 'out')
  return createLaserLac({ input, template, out, machine: args.machine, material: args.material, mode: args.mode || 'laser', widthMm: args['width-mm'], heightMm: args['height-mm'] })
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(value => process.stdout.write(JSON.stringify(value, null, 2) + '\n')).catch(error => {
    process.stderr.write(JSON.stringify({ error: error.message }) + '\n')
    process.exitCode = 1
  })
}
