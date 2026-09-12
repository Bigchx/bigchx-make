export function formatPercent(percent) {
  if (percent > 0 && percent < .01) return '<0.01%'
  return `${percent.toFixed(percent > 0 && percent < .1 ? 2 : 1)}%`
}

export function layerColorStats(result, palette, limit = 16) {
  if (!result) return []
  const total = result.width * result.height || 1
  return palette.map((item, layer) => ({
    hex: item.hex, layer, count: result.area[layer] || 0,
    percent: (result.area[layer] || 0) / total * 100
  })).filter(item => item.count > 0).sort((a, b) => b.count - a.count || a.layer - b.layer).slice(0, limit)
}

function originalHistogram(source) {
  const counts = new Map()
  if (!source?.data) return counts
  for (let i = 0; i < source.data.length; i += 4) {
    if (!source.data[i + 3]) continue
    const key = source.data[i] << 16 | source.data[i + 1] << 8 | source.data[i + 2]
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return counts
}

function exactColors(counts, total, limit) {
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, limit).map(([rgb, count]) => ({
    hex: `#${rgb.toString(16).padStart(6, '0').toUpperCase()}`, count, percent: count / total * 100
  }))
}

export function originalColorStats(source, limit = 16) {
  const counts = originalHistogram(source)
  const total = source?.width * source?.height || 1
  return {
    uniqueCount: counts.size,
    colors: exactColors(counts, total, limit)
  }
}

// OKLab measures perceptual distance. Lower lightness weight groups the shading
// of the same material while retaining differences in hue and chroma.
function perceptualColor(r, g, b) {
  const linear = v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4 }
  r = linear(r); g = linear(g); b = linear(b)
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b)
  const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b)
  const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b)
  return [(.2104542553 * l + .793617785 * m - .0040720468 * s) * .45,
    1.9779984951 * l - 2.428592205 * m + .4505937099 * s,
    .0259040371 * l + .7827717662 * m - .808675766 * s]
}

const distance = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2

export function originalDominantColorStats(source, limit = 16) {
  const histogram = originalHistogram(source)
  const total = source?.width * source?.height || 1
  const exact = exactColors(histogram, total, limit)
  // Bounded 5-bit RGB bins retain full-image pixel weights, not a pixel sample.
  // This bounds clustering cost even when a photograph has millions of RGBs.
  const bins = new Map()
  for (const [rgb, count] of histogram) {
    const r = rgb >> 16, g = rgb >> 8 & 255, b = rgb & 255
    const key = (r >> 3) << 10 | (g >> 3) << 5 | b >> 3
    let bin = bins.get(key)
    if (!bin) { bin = { count: 0, rgb: [0, 0, 0], representative: rgb, peak: 0 }; bins.set(key, bin) }
    if (count > bin.peak || (count === bin.peak && rgb < bin.representative)) {
      bin.representative = rgb; bin.peak = count
    }
    bin.count += count
    bin.rgb[0] += r * count; bin.rgb[1] += g * count; bin.rgb[2] += b * count
  }
  const points = [...bins].sort((a, b) => a[0] - b[0]).map(([, bin]) => ({
    ...bin, color: perceptualColor(...bin.rgb.map(sum => sum / bin.count))
  }))
  const centers = []
  const nearest = new Float64Array(points.length).fill(Infinity)
  const maxColors = Math.max(0, Math.min(16, Math.floor(limit)))
  for (let i = 0; i < maxColors; i++) {
    let best = -1, bestScore = -1
    points.forEach((point, index) => {
      if (i) nearest[index] = Math.min(nearest[index], distance(point.color, centers[i - 1]))
      // Do not force 16 cards by splitting a few dominant colors into tiny shades.
      const score = i ? nearest[index] > .03 ** 2 ? point.count * nearest[index] : -1 : point.count
      if (score > bestScore) { best = index; bestScore = score }
    })
    if (best < 0) break
    centers.push([...points[best].color])
  }
  const assign = () => {
    const groups = centers.map(() => ({ count: 0, color: [0, 0, 0], members: [] }))
    for (const point of points) {
      let closest = 0, nearestDistance = Infinity
      centers.forEach((center, index) => {
        const d = distance(point.color, center)
        if (d < nearestDistance) { closest = index; nearestDistance = d }
      })
      const group = groups[closest]
      if (!group) continue
      group.count += point.count
      group.members.push(point)
      for (let axis = 0; axis < 3; axis++) {
        group.color[axis] += point.color[axis] * point.count
      }
    }
    return groups
  }
  for (let iteration = 0; iteration < 12 && centers.length; iteration++) {
    let movement = 0
    assign().forEach((group, index) => {
      if (!group.count) return
      const next = group.color.map(sum => sum / group.count)
      movement = Math.max(movement, distance(next, centers[index]))
      centers[index] = next
    })
    if (movement < 1e-8) break
  }
  const groups = assign().filter(group => group.count > 0)
  // Only merge very close centers. A wider threshold can erase meaningful
  // material regions, especially dark green and teal areas with soft shading.
  for (;;) {
    let pair, best = .035 ** 2
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      const d = distance(groups[i].color.map(sum => sum / groups[i].count), groups[j].color.map(sum => sum / groups[j].count))
      if (d < best) { best = d; pair = [i, j] }
    }
    if (!pair) break
    const [first, second] = pair, a = groups[first], b = groups[second]
    a.count += b.count
    for (let axis = 0; axis < 3; axis++) a.color[axis] += b.color[axis]
    a.members.push(...b.members)
    groups.splice(second, 1)
  }
  const colors = groups.map(group => {
    const center = group.color.map(sum => sum / group.count)
    // Pick a real source color near the weighted center, rather than inventing
    // an averaged RGB that can obscure the hue of textured material.
    const representative = group.members.reduce((best, point) =>
      distance(point.color, center) < distance(best.color, center) ? point : best)
    return {
      hex: `#${representative.representative.toString(16).padStart(6, '0').toUpperCase()}`,
      count: group.count, percent: group.count / total * 100
    }
  }).sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex))
  return { uniqueCount: histogram.size, colors, exactColors: exact }
}
