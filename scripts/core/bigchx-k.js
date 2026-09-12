import ClipperLib from 'clipper-lib'

const { Clipper, ClipType, PolyType, PolyFillType, PolyTree } = ClipperLib

function union(paths, tree = false) {
  const clipper = new Clipper(), result = tree ? new PolyTree() : []
  clipper.StrictlySimple = true
  clipper.AddPaths(paths, PolyType.ptSubject, true)
  clipper.Execute(ClipType.ctUnion, result, PolyFillType.pftNonZero, PolyFillType.pftNonZero)
  return result
}

function featureKernel(spec) {
  const columns = Math.max(1, Math.ceil(spec.minFeatureX / spec.samplePitchX - 1e-6))
  const rows = Math.max(1, Math.ceil(spec.minFeatureY / spec.samplePitchY - 1e-6))
  const left = Math.floor((columns - 1) / 2), top = Math.floor((rows - 1) / 2)
  const kernel = []
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const dx = (x - (columns - 1) / 2) / columns, dy = (y - (rows - 1) / 2) / rows
    if (dx * dx + dy * dy <= .25) kernel.push([x - left, y - top])
  }
  return kernel
}

// Discrete elliptical opening on shared labels. Every color uses the same
// physical kernel; no polygon offsets or per-color full-image buffers are needed.
function openLabels(labels, width, height, kernel) {
  const eroded = new Int16Array(labels.length).fill(-1)
  const retained = new Int16Array(labels.length).fill(-1)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = y * width + x, layer = labels[p]
    if (layer < 0) continue
    let fits = true
    for (const [dx, dy] of kernel) {
      const xx = x + dx, yy = y + dy
      if (xx < 0 || yy < 0 || xx >= width || yy >= height || labels[yy * width + xx] !== layer) { fits = false; break }
    }
    if (fits) eroded[p] = layer
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = y * width + x, layer = labels[p]
    if (layer < 0) continue
    for (const [dx, dy] of kernel) {
      const xx = x - dx, yy = y - dy
      if (xx >= 0 && yy >= 0 && xx < width && yy < height && eroded[yy * width + xx] === layer) { retained[p] = layer; break }
    }
  }
  return retained
}

// Walk exposed cell edges directly. Boolean-unioning thousands of adjacent
// rectangles spent most of the photo workload canceling interior edges.
export function traceLabelPaths(labels, width, height, count) {
  const stride = width + 1, edges = new Uint8Array(stride * (height + 1))
  const steps = [1, stride, -1, -stride], pathsByLayer = []
  let totalCorners = 0
  for (let layer = 0; layer < count; layer++) {
    edges.fill(0)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const p = y * width + x
      if (labels[p] !== layer) continue
      const vertex = y * stride + x
      if (!y || labels[p - width] !== layer) edges[vertex] |= 1
      if (x + 1 === width || labels[p + 1] !== layer) edges[vertex + 1] |= 2
      if (y + 1 === height || labels[p + width] !== layer) edges[vertex + stride + 1] |= 4
      if (!x || labels[p - 1] !== layer) edges[vertex + stride] |= 8
    }
    const paths = []
    for (let start = 0; start < edges.length; start++) while (edges[start]) {
      let vertex = start, direction = 0
      while (!(edges[start] & (1 << direction))) direction++
      const firstDirection = direction, path = []
      do {
        edges[vertex] &= ~(1 << direction)
        const point = { X: vertex % stride, Y: Math.floor(vertex / stride) }
        if (path.length >= 2) {
          const a = path[path.length - 2], b = path[path.length - 1]
          if ((a.X === b.X && b.X === point.X) || (a.Y === b.Y && b.Y === point.Y)) path.pop()
        }
        path.push(point)
        vertex += steps[direction]
        if (vertex === start) break
        // At a diagonal contact keep the occupied region to the right. This
        // produces separate rings instead of crossing them at a shared point.
        const order = [(direction + 1) % 4, direction, (direction + 3) % 4, (direction + 2) % 4]
        direction = order.find(next => edges[vertex] & (1 << next))
        if (direction === undefined) throw new Error('轮廓追踪遇到未闭合边界')
      } while (true)
      if (direction === firstDirection) path.shift()
      totalCorners += path.length
      if (totalCorners > 1500000) throw new Error('图案边界过于复杂，请提高边界平滑后重算')
      paths.push(path)
    }
    pathsByLayer.push(paths)
  }
  return pathsByLayer
}

function fillRemovedRegions(original, retained, width, height, stepX, stepY) {
  const nearest = Int16Array.from(retained), distances = new Float32Array(original.length)
  for (let i = 0; i < distances.length; i++) distances[i] = retained[i] < 0 ? Infinity : 0
  const diagonal = Math.hypot(stepX, stepY)
  const relax = (to, from, cost) => {
    if (nearest[from] < 0) return
    const distance = distances[from] + cost
    if (distance < distances[to]) { distances[to] = distance; nearest[to] = nearest[from] }
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = y * width + x
    if (x) relax(p, p - 1, stepX)
    if (y) {
      relax(p, p - width, stepY)
      if (x) relax(p, p - width - 1, diagonal)
      if (x + 1 < width) relax(p, p - width + 1, diagonal)
    }
  }
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const p = y * width + x
    if (x + 1 < width) relax(p, p + 1, stepX)
    if (y + 1 < height) {
      relax(p, p + width, stepY)
      if (x) relax(p, p + width - 1, diagonal)
      if (x + 1 < width) relax(p, p + width + 1, diagonal)
    }
  }
  for (let i = 0; i < nearest.length; i++) if (original[i] < 0) nearest[i] = -1
  return nearest
}

function softenSharedEdges(paths, labels, width, height) {
  const at = (x, y) => x < 0 || y < 0 || x >= width || y >= height ? -1 : labels[y * width + x]
  const position = (x, y) => {
    const a = at(x - 1, y - 1), b = at(x, y - 1), c = at(x - 1, y), d = at(x, y)
    const protectedEdge = a < 0 || b < 0 || c < 0 || d < 0
    const pin = new Set([a, b, c, d]).size > 2 || ((x === 0 || x === width) && (y === 0 || y === height))
    if (protectedEdge) return { X: x * 4, Y: y * 4, pin, protectedEdge }
    const left = a !== c ? 1 : 0, right = b !== d ? 1 : 0, up = a !== b ? 1 : 0, down = c !== d ? 1 : 0
    // Shared vertices move once for all colors; pin junctions. This replaces
    // staircase turns with diagonal edges without independently shrinking layers.
    return left + right + up + down === 2
      ? { X: x * 4 + right - left, Y: y * 4 + down - up, pin }
      : { X: x * 4, Y: y * 4, pin }
  }
  return paths.map(path => {
    const result = []
    const push = point => {
      while (result.length >= 2) {
        const a = result[result.length - 2], b = result[result.length - 1]
        if (b.pin) break
        if ((b.X - a.X) * (point.Y - b.Y) !== (b.Y - a.Y) * (point.X - b.X)) break
        result.pop()
      }
      result.push(point)
    }
    for (let i = 0; i < path.length; i++) {
      const a = path[i], b = path[(i + 1) % path.length]
      const dx = Math.sign(b.X - a.X), dy = Math.sign(b.Y - a.Y)
      const length = Math.max(Math.abs(b.X - a.X), Math.abs(b.Y - a.Y))
      for (let step = 0; step < length; step++) push(position(a.X + dx * step, a.Y + dy * step))
    }
    return simplifySharedRing(result)
  })
}

const pointOrder = (a, b) => a.X - b.X || a.Y - b.Y

function simplifyChain(chain) {
  if (chain.length <= 2 || chain.slice(1, -1).some(point => point.protectedEdge)) return chain
  // Canonical traversal makes neighboring colors choose exactly the same
  // vertices even though they traverse their shared boundary in reverse.
  const reverse = pointOrder(chain[0], chain[chain.length - 1]) > 0
  const points = reverse ? chain.slice().reverse() : chain
  const keep = new Uint8Array(points.length), stack = [[0, points.length - 1]]
  keep[0] = keep[points.length - 1] = 1
  while (stack.length) {
    const [start, end] = stack.pop(), a = points[start], b = points[end]
    const dx = b.X - a.X, dy = b.Y - a.Y, length = dx * dx + dy * dy
    // Coordinates are in quarter samples: one unit is at most 1/8 of the
    // minimum physical feature under the sampling budget.
    let maximum = 1, selected = -1
    for (let i = start + 1; i < end; i++) {
      const p = points[i]
      const t = length ? Math.max(0, Math.min(1, ((p.X - a.X) * dx + (p.Y - a.Y) * dy) / length)) : 0
      const distance = (p.X - a.X - t * dx) ** 2 + (p.Y - a.Y - t * dy) ** 2
      if (distance > maximum) { maximum = distance; selected = i }
    }
    if (selected >= 0) {
      keep[selected] = 1
      stack.push([start, selected], [selected, end])
    }
  }
  const reduced = points.filter((_, i) => keep[i])
  return reverse ? reduced.reverse() : reduced
}

function simplifySharedRing(points) {
  if (points.length < 4) return points
  const anchors = points.flatMap((point, i) => point.pin ? [i] : [])
  if (!anchors.length) {
    let first = 0
    for (let i = 1; i < points.length; i++) if (pointOrder(points[i], points[first]) < 0) first = i
    anchors.push(first)
  }
  if (anchors.length === 1) {
    const a = points[anchors[0]]
    let farthest = anchors[0], distance = -1
    for (let i = 0; i < points.length; i++) {
      const d = (points[i].X - a.X) ** 2 + (points[i].Y - a.Y) ** 2
      if (d > distance || (d === distance && pointOrder(points[i], points[farthest]) < 0)) { farthest = i; distance = d }
    }
    anchors.push(farthest)
  }
  anchors.sort((a, b) => a - b)
  const output = []
  for (let i = 0; i < anchors.length; i++) {
    const start = anchors[i], end = anchors[(i + 1) % anchors.length]
    const chain = start < end ? points.slice(start, end + 1) : [...points.slice(start), ...points.slice(0, end + 1)]
    const simplified = simplifyChain(chain)
    for (let p = 0; p < simplified.length - 1; p++) output.push(simplified[p])
  }
  return output.length >= 3 ? output : points
}

function resolvePointContacts(labels, width, height, spec) {
  // Extruding two regions that touch only at a grid vertex creates a
  // four-face vertical edge. Resolve the whole bead-sized neighborhood,
  // including a sampling margin, instead of adding an unprintable pixel bridge.
  const stepX = spec.samplePitchX / spec.minFeatureX, stepY = spec.samplePitchY / spec.minFeatureY
  const radius = .5 + Math.hypot(stepX, stepY) / 2
  const extentX = Math.ceil(radius / stepX), extentY = Math.ceil(radius / stepY)
  const patch = (x, y, color) => {
    for (let yy = Math.max(0, y - extentY); yy < Math.min(height, y + extentY); yy++) {
      for (let xx = Math.max(0, x - extentX); xx < Math.min(width, x + extentX); xx++) {
        const p = yy * width + xx
        if (labels[p] >= 0 && ((xx + .5 - x) * stepX) ** 2 + ((yy + .5 - y) * stepY) ** 2 <= radius ** 2) labels[p] = color
      }
    }
  }
  for (let pass = 0; pass < 8; pass++) {
    let changed = false
    for (let y = 1; y < height; y++) for (let x = 1; x < width; x++) {
      const p = y * width + x
      const a = labels[p - width - 1], b = labels[p - width], c = labels[p - 1], d = labels[p]
      if (a >= 0 && a === d && a !== b && a !== c) {
        patch(x, y, b < 0 || c < 0 ? -1 : b)
        changed = true
      } else if (b >= 0 && b === c && b !== a && b !== d) {
        patch(x, y, a < 0 || d < 0 ? -1 : b)
        changed = true
      }
    }
    if (!changed) return
  }
  throw new Error('轮廓存在过多对角接点，请提高边界平滑后重算')
}

export function makePrintContours(labels, width, height, count, spec, soften = true) {
  const pathsByLayer = traceLabelPaths(labels, width, height, count)
  let vertices = 0
  return pathsByLayer.map(paths => {
    const scaled = soften ? softenSharedEdges(paths, labels, width, height) : paths.map(path => path.map(p => ({ X: p.X * 4, Y: p.Y * 4 })))
    const polygons = ClipperLib.JS.PolyTreeToExPolygons(union(scaled, true))
    for (const poly of polygons) for (const ring of [poly.outer, ...poly.holes]) vertices += ring.length
    if (vertices > 120000) throw new Error('轮廓节点过多，请提高边界平滑或减少颜色数量后重算')
    const coordinates = path => path.map(p => [p.X / 4 * spec.samplePitchX, p.Y / 4 * spec.samplePitchY])
    return polygons.map(poly => ({ outer: coordinates(poly.outer), holes: poly.holes.map(coordinates) }))
  })
}

export function refinePrintableLabels(labels, width, height, count, spec) {
  const kernel = featureKernel(spec)
  const retained = openLabels(labels, width, height, kernel)
  const normalizedX = spec.samplePitchX / spec.minFeatureX
  const normalizedY = spec.samplePitchY / spec.minFeatureY
  const removedLayers = []
  const seededLayers = new Uint8Array(count)
  for (const label of retained) if (label >= 0) seededLayers[label] = 1
  const seeds = seededLayers.some(value => value)
  for (let layer = 0; layer < count; layer++) if (!seededLayers[layer]) removedLayers.push(layer)
  const opaque = labels.some(label => label >= 0)
  if (!seeds && opaque) throw new Error('所有颜色区域都小于当前最小线宽，请增大图案尺寸或降低线宽约束')
  const output = seeds ? fillRemovedRegions(labels, retained, width, height, normalizedX, normalizedY) : Int16Array.from(labels)
  // Do not restore an unprintable thin exterior tab through nearest-color fill.
  // The footprint opening only removes material; excluded holes never fill.
  let trimmedExteriorPixels = 0
  if (seeds && labels.some(label => label < 0)) {
    const footprint = Int16Array.from(labels, label => label < 0 ? -1 : 0)
    const supported = openLabels(footprint, width, height, kernel)
    for (let i = 0; i < output.length; i++) if (output[i] >= 0 && supported[i] < 0) { output[i] = -1; trimmedExteriorPixels++ }
  }
  resolvePointContacts(output, width, height, spec)
  let reassignedPixels = 0
  trimmedExteriorPixels = 0
  for (let i = 0; i < output.length; i++) {
    if (output[i] !== labels[i]) reassignedPixels++
    if (labels[i] >= 0 && output[i] < 0) trimmedExteriorPixels++
  }
  return { labels: output, report: { algorithm: 'bigchx-K', reassignedPixels, trimmedExteriorPixels, removedLayers, minFeatureX: spec.minFeatureX, minFeatureY: spec.minFeatureY } }
}
