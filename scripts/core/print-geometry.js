import * as THREE from 'three'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import { getModelThickness } from './print-settings.js'

export function getPartHeightRange(result, layer) {
  const range = result.partHeightRanges?.[layer]
  if (!range) return { bottomMm: 0, topMm: getModelThickness(result.printSpec) }
  const { bottomMm, topMm } = range
  if (result.printSpec.orientation !== 'flat' || !Number.isFinite(bottomMm) || !Number.isFinite(topMm) || bottomMm < 0 || topMm <= bottomMm || topMm > getModelThickness(result.printSpec) + 1e-6) throw new Error('Invalid flat part height range')
  return { bottomMm, topMm }
}

export function createLayerGeometry(result, layer) {
  const spec = result.printSpec
  const polygons = result.printContours?.[layer] || (result.printRectangles?.[layer] || []).map(rect => ({
    outer: [[rect.x, rect.y], [rect.x + rect.width, rect.y], [rect.x + rect.width, rect.y + rect.height], [rect.x, rect.y + rect.height]].map(([x, y]) => [x * spec.pitch, y * spec.pitch]), holes: []
  }))
  if (!polygons.length) return null
  const vector = ([x, y]) => new THREE.Vector2(x - spec.widthMm / 2, spec.heightMm - y)
  const shapes = polygons.map(polygon => {
    const shape = new THREE.Shape(polygon.outer.map(vector))
    shape.holes = polygon.holes.map(hole => new THREE.Path(hole.map(vector)))
    return shape
  })
  const { bottomMm, topMm } = getPartHeightRange(result, layer)
  const geometry = new THREE.ExtrudeGeometry(shapes, {
    depth: topMm - bottomMm,
    bevelEnabled: false, steps: 1, curveSegments: 1
  })
  geometry.translate(0, 0, bottomMm)
  if (spec.orientation === 'flat') {
    geometry.rotateX(-Math.PI / 2)
    geometry.translate(0, 0, spec.heightMm / 2)
  }
  return geometry
}

export function exportLayerStl(result, layer) {
  const geometry = createLayerGeometry(result, layer)
  if (!geometry) return null
  // STL and Bambu Studio use Z-up; the preview uses Three.js Y-up.
  geometry.rotateX(Math.PI / 2)
  const material = new THREE.MeshBasicMaterial()
  const mesh = new THREE.Mesh(geometry, material)
  mesh.updateMatrixWorld(true)
  const output = new STLExporter().parse(mesh, { binary: true })
  geometry.dispose(); material.dispose()
  return output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength)
}

export function exportContourSvg(result, palette, onlyLayer = -1) {
  if (!result.printContours) return null
  const spec = result.printSpec
  const ring = points => points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(5)},${y.toFixed(5)}`).join(' ') + ' Z'
  const paths = result.printContours.flatMap((polygons, layer) => {
    if (onlyLayer >= 0 && onlyLayer !== layer) return []
    const color = /^#[0-9A-Fa-f]{6}$/.test(palette[layer]?.hex) ? palette[layer].hex : '#000000'
    return polygons.map(polygon => `<path fill="${color}" fill-rule="evenodd" d="${[polygon.outer, ...polygon.holes].map(ring).join(' ')}"/>`)
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.widthMm}mm" height="${spec.heightMm}mm" viewBox="0 0 ${spec.widthMm} ${spec.heightMm}">${paths.join('')}</svg>`
}
