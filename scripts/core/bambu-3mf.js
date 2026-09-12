import JSZip from 'jszip'
import { createLayerGeometry, getPartHeightRange } from './print-geometry.js'
import { createBambuProjectSettings, BAMBU_PROJECT_VERSION } from './bambu-project.js'
import { getModelThickness } from './print-settings.js'

const xml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
const number = value => Number(value.toFixed(5)).toString()
const identity = '1 0 0 0 1 0 0 0 1 0 0 0'
const matrix4 = '1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1'
const core = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02'
const production = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06'
const relationships = 'http://schemas.openxmlformats.org/package/2006/relationships'
const modelRelationship = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel'
const modelStart = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="${core}" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="${production}" requiredextensions="p">`
const metadata = (name, value) => `<metadata name="${xml(name)}">${xml(value)}</metadata>`
const configMetadata = (key, value) => `<metadata key="${xml(key)}" value="${xml(value)}"/>`
const uuid = () => {
  // getRandomValues also works on HTTP LAN deployments where randomUUID is absent.
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64
  bytes[8] = (bytes[8] & 63) | 128
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function layerMesh(result, layer) {
  const geometry = createLayerGeometry(result, layer)
  if (!geometry) return null
  geometry.rotateX(Math.PI / 2)
  const positions = geometry.getAttribute('position'), indices = geometry.getIndex()
  const vertices = [], triangles = [], known = new Map(), remap = new Uint32Array(positions.count)
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.count; i++) {
    const coordinates = [positions.getX(i), positions.getY(i), positions.getZ(i)].map(number)
    const key = coordinates.join(' ')
    let vertex = known.get(key)
    if (vertex === undefined) {
      vertex = vertices.length; known.set(key, vertex)
      vertices.push(`<vertex x="${coordinates[0]}" y="${coordinates[1]}" z="${coordinates[2]}"/>`)
      coordinates.forEach((value, axis) => { min[axis] = Math.min(min[axis], Number(value)); max[axis] = Math.max(max[axis], Number(value)) })
    }
    remap[i] = vertex
  }
  const count = indices ? indices.count : positions.count
  for (let i = 0; i < count; i += 3) {
    const corners = [0, 1, 2].map(offset => remap[indices ? indices.getX(i + offset) : i + offset])
    if (new Set(corners).size !== 3) continue
    triangles.push(`<triangle v1="${corners[0]}" v2="${corners[1]}" v3="${corners[2]}"/>`)
  }
  geometry.dispose()
  if (!triangles.length) throw new Error(`图层 ${layer + 1} 没有有效三角面，无法导出 3MF`)
  return { text: `<mesh><vertices>${vertices.join('')}</vertices><triangles>${triangles.join('')}</triangles></mesh>`, min, max, faces: triangles.length }
}

export async function create3mfArchive(result, palette, exportedLayers, options = {}) {
  const layers = exportedLayers.map(({ layer }) => ({ layer, item: palette[layer], mesh: layerMesh(result, layer) })).filter(entry => entry.mesh)
  if (!layers.length) return null
  const { config, profileName, materials: profiles } = createBambuProjectSettings(result.printSpec, layers.map(entry => entry.item), options.printerName)
  const zip = new JSZip(), assemblyId = layers.length + 1, materialId = assemblyId + 1
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
  layers.forEach(({ mesh }) => mesh.min.forEach((value, axis) => { bounds.min[axis] = Math.min(bounds.min[axis], value); bounds.max[axis] = Math.max(bounds.max[axis], mesh.max[axis]) }))
  const bed = config.printable_area.map(point => point.split('x').map(Number))
  const center = [0, 1].map(axis => (Math.min(...bed.map(point => point[axis])) + Math.max(...bed.map(point => point[axis]))) / 2)
  const offset = [center[0] - (bounds.min[0] + bounds.max[0]) / 2, center[1] - (bounds.min[1] + bounds.max[1]) / 2, -bounds.min[2]]
  const transform = `1 0 0 0 1 0 0 0 1 ${offset.map(number).join(' ')}`
  const parts = [], objects = [], components = [], materials = []
  layers.forEach(({ layer, item, mesh }, index) => {
    const id = index + 1, name = result.partNames?.[layer] || `Layer ${String(layer + 1).padStart(2, '0')} · ${item.hex}`
    const file = `layer-${String(layer + 1).padStart(2, '0')}-${item.hex.slice(1)}.stl`
    objects.push(`<object id="${id}" p:UUID="${uuid()}" type="model" name="${xml(name)}" pid="${materialId}" pindex="${index}">${mesh.text}</object>`)
    components.push(`<component p:path="/3D/Objects/object_1.model" objectid="${id}" p:UUID="${uuid()}" transform="${identity}"/>`)
    parts.push(`<part id="${id}" subtype="normal_part" uuid="${uuid()}">${configMetadata('name', name)}${configMetadata('matrix', matrix4)}${configMetadata('source_file', file)}${configMetadata('source_object_id', 0)}${configMetadata('source_volume_id', index)}${configMetadata('extruder', index + 1)}<mesh_stat face_count="${mesh.faces}" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/></part>`)
    materials.push({ ...getPartHeightRange(result, layer), layer: layer + 1, slot: index + 1, color: item.hex.toUpperCase(), type: item.filament?.type || '自定义颜色', name: item.filament?.name || '手动颜色', colorCode: item.filament?.colorCode || '', hex: item.hex.toUpperCase(), ...profiles[index] })
  })
  const bases = `<basematerials id="${materialId}">${layers.map(({ item }) => `<base name="${xml(item.filament?.name || item.hex)}" displaycolor="${item.hex.toUpperCase()}FF"/>`).join('')}</basematerials>`
  // Studio gates project configuration loading on this compatibility marker.
  // Keep the real generator and developer in separate explicit metadata.
  zip.file('3D/3dmodel.model', `${modelStart}${metadata('Application', `BambuStudio-${BAMBU_PROJECT_VERSION}`)}${metadata('BambuStudio:3mfVersion', '1')}${metadata('Title', 'Bigchx Make')}${metadata('Designer', 'bigchx')}${metadata('Description', 'Generated by Bigchx Make · https://skills.bigchx.com/')}${metadata('Bigchx:Generator', 'Bigchx Make')}<resources><object id="${assemblyId}" type="model" p:UUID="${uuid()}"><components>${components.join('')}</components></object></resources><build p:UUID="${uuid()}"><item objectid="${assemblyId}" p:UUID="${uuid()}" transform="${transform}" printable="1"/></build></model>`)
  zip.file('3D/Objects/object_1.model', `${modelStart}${metadata('BambuStudio:3mfVersion', '1')}<resources>${bases}${objects.join('')}</resources><build/></model>`)
  zip.file('3D/_rels/3dmodel.model.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${relationships}"><Relationship Target="/3D/Objects/object_1.model" Id="rel-1" Type="${modelRelationship}"/></Relationships>`)
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${relationships}"><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="${modelRelationship}"/></Relationships>`)
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="config" ContentType="text/plain"/><Default Extension="json" ContentType="application/json"/></Types>')
  zip.file('Metadata/model_settings.config', `<?xml version="1.0" encoding="UTF-8"?><config><object id="${assemblyId}">${configMetadata('name', 'Bigchx Make')}${configMetadata('extruder', 1)}<metadata face_count="${layers.reduce((sum, entry) => sum + entry.mesh.faces, 0)}"/>${parts.join('')}</object><plate>${configMetadata('plater_id', 1)}${configMetadata('plater_name', 'Bigchx Make')}${configMetadata('locked', 'false')}${configMetadata('filament_map_mode', 'Auto For Flush')}<model_instance>${configMetadata('object_id', assemblyId)}${configMetadata('instance_id', 0)}${configMetadata('identify_id', 1)}</model_instance></plate><assemble><assemble_item object_id="${assemblyId}" instance_id="0" transform="${transform}" offset="0 0 0"/></assemble></config>`)
  zip.file('Metadata/project_settings.config', JSON.stringify(config, null, 2))
  zip.file('Metadata/filament_sequence.json', JSON.stringify({ plate_1: { nozzle_sequence: [], optimal_assignment: [], sequence: [] } }))
  zip.file('Metadata/bigchx-make-materials.json', JSON.stringify({ application: 'Bigchx Make', author: 'bigchx', website: 'https://skills.bigchx.com/', configurationVersion: BAMBU_PROJECT_VERSION, printer: profileName, algorithm: result.printSpec.algorithm, units: 'mm', thicknessMm: getModelThickness(result.printSpec), heightPlan: result.heightPlan, materials }, null, 2))
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
