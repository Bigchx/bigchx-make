import snapshot from './bambu-print-profiles.json' with { type: 'json' }
import { BAMBU_FILAMENTS } from './bambu-filaments.js'

export const BAMBU_PROJECT_VERSION = snapshot.version
export const BAMBU_PRINTER_KEYS = Object.keys(snapshot.machines)
const unpack = config => Object.fromEntries(Object.entries(config).map(([key, index]) => [key, structuredClone(snapshot.values[index])]))
const materialKeys = new Set(snapshot.materialKeys)
const specialMaterialKeys = new Set(['filament_colour', 'filament_multi_colour', 'filament_colour_type', 'filament_ids', 'filament_settings_id', 'filament_self_index', 'filament_map', 'filament_volume_map', 'filament_nozzle_map'])
const skipTemplateKeys = new Set(['flush_volumes_matrix', 'flush_volumes_vector', 'first_layer_print_sequence', 'other_layers_print_sequence', 'other_layers_print_sequence_nums'])
const typeIds = new Map(BAMBU_FILAMENTS.map(item => [item.type, item.filamentId]))
const decimal = value => String(Number(Number(value).toFixed(5)))

export function createBambuProjectSettings(spec, palette, printerName = 'A1 mini') {
  const nozzle = Number(spec.nozzle || .4).toFixed(1)
  const profile = snapshot.machines[`${printerName}/${nozzle}`]
  if (!profile) throw new Error(`没有 ${printerName} / ${nozzle} mm 的官方打印配置`)
  const template = unpack(profile.template || snapshot.base)
  const config = { ...template, ...unpack(profile.machine), ...unpack(profile.process) }
  const templateCount = template.filament_colour.length
  const perFilament = new Set([...materialKeys, ...Object.keys(template).filter(key => key.startsWith('filament_'))])
  perFilament.delete('filament_map_mode')
  const materials = palette.map((item, index) => {
    const requestedId = item.filament?.filamentId || typeIds.get(item.filament?.type)
    const name = item.filament ? profile.materials[requestedId] : profile.defaultMaterial
    if (!name) throw new Error(`图层 ${index + 1} 的 ${item.filament?.type || '所选耗材'} 没有适用于 ${printerName} / ${nozzle} mm 的官方预设，请调整喷嘴或耗材`)
    const preset = snapshot.filaments[name]
    return { preset, values: unpack(preset.config), color: item.hex.toUpperCase() }
  })
  for (const key of perFilament) {
    if (specialMaterialKeys.has(key)) continue
    const fallback = template[key]
    const pieces = materials.map(({ values }) => {
      if (key in values) return values[key]
      if (Array.isArray(fallback)) return fallback.slice(0, Math.max(1, Math.floor(fallback.length / templateCount)))
      return fallback
    })
    if (pieces.every(value => value === undefined)) { delete config[key]; continue }
    if (Array.isArray(fallback) || pieces.some(Array.isArray)) {
      config[key] = pieces.flatMap(value => Array.isArray(value) ? value : [value ?? ''])
    } else config[key] = pieces[0]
  }
  for (const key of skipTemplateKeys) delete config[key]
  delete config.filament_nozzle_map
  config.from = 'project'
  config.version = snapshot.version
  config.name = 'Bigchx Make'
  config.printer_settings_id = profile.name
  config.print_settings_id = profile.processName
  config.default_print_profile = profile.processName
  config.default_filament_profile = [profile.defaultMaterial]
  config.print_compatible_printers = [profile.name]
  config.layer_height = decimal(spec.layerHeight)
  config.initial_layer_print_height = decimal(spec.layerHeight)
  for (const key of ['line_width', 'outer_wall_line_width', 'inner_wall_line_width', 'top_surface_line_width', 'internal_solid_infill_line_width', 'sparse_infill_line_width']) config[key] = decimal(spec.lineWidth)
  config.initial_layer_line_width = decimal(spec.firstLayerLineWidth ?? spec.lineWidth)
  config.filament_settings_id = materials.map(item => item.preset.name)
  config.filament_ids = materials.map(item => item.preset.filamentId)
  config.filament_colour = materials.map(item => item.color)
  // Each image layer uses the selected solid component of a gradient/multicolor spool.
  config.filament_multi_colour = [...config.filament_colour]
  config.filament_colour_type = materials.map(() => '1')
  config.filament_self_index = materials.flatMap(({ values }, index) => (values.filament_extruder_variant || ['Direct Drive Standard']).map(() => String(index + 1)))
  config.filament_map = materials.map(() => String(config.master_extruder_id || 1))
  config.filament_volume_map = materials.map(() => '0')
  config.filament_map_mode = 'Auto For Flush'
  // Reference projects retain their old plate layout. Start the new tower inside
  // the common nozzle area instead of copying an edge position from another image.
  const bed = config.printable_area.map(point => point.split('x').map(Number))
  const nozzleAreas = (config.extruder_printable_area || []).map(area => area.split(',').map(point => point.split('x').map(Number)))
  config.wipe_tower_x = [decimal(Math.max(Math.min(...bed.map(point => point[0])), ...nozzleAreas.map(area => Math.min(...area.map(point => point[0])))) + 20)]
  config.wipe_tower_y = [decimal(Math.min(...bed.map(point => point[1])) + 20)]
  // Studio's PresetBundle uses 140 + 140 mm³ as the default for a new color pair.
  // A complete matrix is required by the CLI slicer; it cannot be left empty.
  const extruderCount = config.nozzle_diameter.length
  config.flush_multiplier = Array.from({ length: extruderCount }, (_, index) => template.flush_multiplier[index] ?? template.flush_multiplier[0] ?? '1')
  config.flush_multiplier_fast = Array.from({ length: extruderCount }, (_, index) => template.flush_multiplier_fast[index] ?? template.flush_multiplier_fast[0] ?? '1.2')
  config.flush_volumes_matrix = Array.from({ length: extruderCount }, () => materials.flatMap((_, from) => materials.map((_, to) => from === to ? '0' : '280'))).flat()
  config.flush_volumes_vector = materials.flatMap(() => ['140', '140'])
  // Some official preset JSON uses singleton arrays even for project scalars.
  // The saved-project schema is authoritative for the serialized field shape.
  for (const [key, value] of Object.entries(config)) {
    if (!(key in template)) continue
    if (Array.isArray(template[key]) && !Array.isArray(value)) config[key] = [value]
    else if (!Array.isArray(template[key]) && Array.isArray(value)) config[key] = value[0] ?? template[key]
  }
  return { config, profileName: profile.name, materials: materials.map(item => ({ profile: item.preset.name, filamentId: item.preset.filamentId })) }
}
