import { getRasterPlan } from './print-settings.js'
import { resampleImage } from './resample.js'
import { clusterPixels } from './kmeans.js'
import { makePrintContours, refinePrintableLabels } from './bigchx-k.js'

const clamp = (value, min = 0, max = 255) => Math.max(min, Math.min(max, value))

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break
      case g: h = (b - r) / d + 2; break
      default: h = (r - g) / d + 4
    }
    h /= 6
  }
  return [h, s, l]
}

function hslToRgb(h, s, l) {
  if (s === 0) return [l * 255, l * 255, l * 255]
  const hue = (p, q, t) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255]
}

function adjustPixels(data, brightness, contrast, saturation) {
  const out = new Uint8ClampedArray(data.length)
  const factor = contrast
  for (let i = 0; i < data.length; i += 4) {
    const r = clamp(factor * (data[i] - 128) + 128 + brightness * 2.55)
    const g = clamp(factor * (data[i + 1] - 128) + 128 + brightness * 2.55)
    const b = clamp(factor * (data[i + 2] - 128) + 128 + brightness * 2.55)
    const [h, s, l] = rgbToHsl(r, g, b)
    const [nr, ng, nb] = hslToRgb(h, clamp(s * saturation, 0, 1), l)
    out[i] = nr; out[i + 1] = ng; out[i + 2] = nb; out[i + 3] = data[i + 3]
  }
  return out
}

function sharpenPixels(data, width, height, amount) {
  if (!amount) return data
  const source = new Uint8ClampedArray(data)
  const strength = Math.min(1, Math.abs(amount) / 100)
  const out = new Uint8ClampedArray(data.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4
      for (let channel = 0; channel < 3; channel++) {
        const center = source[index + channel]
        const top = source[(Math.max(0, y - 1) * width + x) * 4 + channel]
        const bottom = source[(Math.min(height - 1, y + 1) * width + x) * 4 + channel]
        const left = source[(y * width + Math.max(0, x - 1)) * 4 + channel]
        const right = source[(y * width + Math.min(width - 1, x + 1)) * 4 + channel]
        const average = (top + bottom + left + right) / 4
        out[index + channel] = clamp(amount > 0 ? center + strength * (4 * center - top - bottom - left - right) : center + strength * (average - center))
      }
      out[index + 3] = data[index + 3]
    }
  }
  return out
}

function blurPixels(data, width, height, radius) {
  const size = Math.min(6, Math.max(0, Math.round(radius || 0)))
  if (!size) return data
  const source = new Uint8ClampedArray(data)
  const out = new Uint8ClampedArray(data.length)
  const span = size * 2 + 1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const target = (y * width + x) * 4
      let red = 0, green = 0, blue = 0, count = 0
      for (let yy = Math.max(0, y - size); yy <= Math.min(height - 1, y + size); yy++) {
        for (let xx = Math.max(0, x - size); xx <= Math.min(width - 1, x + size); xx++) {
          const index = (yy * width + xx) * 4
          red += source[index]; green += source[index + 1]; blue += source[index + 2]; count++
        }
      }
      out[target] = red / count; out[target + 1] = green / count; out[target + 2] = blue / count; out[target + 3] = data[target + 3]
    }
  }
  return out
}

function preparePixels(scaled, settings) {
  const blurred = blurPixels(scaled.data, scaled.width, scaled.height, settings.blur)
  const adjusted = adjustPixels(blurred, settings.brightness, settings.contrast, settings.saturation)
  return sharpenPixels(adjusted, scaled.width, scaled.height, settings.sharpness)
}

function resizePixels(data, width, height, scale) {
  const nextWidth = Math.max(2, Math.round(width / scale))
  const nextHeight = Math.max(2, Math.round(height / scale))
  const out = new Uint8ClampedArray(nextWidth * nextHeight * 4)
  for (let y = 0; y < nextHeight; y++) {
    for (let x = 0; x < nextWidth; x++) {
      const sx = Math.min(width - 1, Math.floor(x * width / nextWidth))
      const sy = Math.min(height - 1, Math.floor(y * height / nextHeight))
      const si = (sy * width + sx) * 4, di = (y * nextWidth + x) * 4
      out[di] = data[si]; out[di + 1] = data[si + 1]; out[di + 2] = data[si + 2]; out[di + 3] = data[si + 3]
    }
  }
  return { data: out, width: nextWidth, height: nextHeight }
}

function resizeMask(mask, width, height, nextWidth, nextHeight) {
  if (!mask) return new Uint8Array(nextWidth * nextHeight)
  if (width === nextWidth && height === nextHeight) return mask
  const out = new Uint8Array(nextWidth * nextHeight)
  for (let y = 0; y < nextHeight; y++) {
    for (let x = 0; x < nextWidth; x++) {
      const sx = Math.min(width - 1, Math.floor(x * width / nextWidth))
      const sy = Math.min(height - 1, Math.floor(y * height / nextHeight))
      out[y * nextWidth + x] = mask[sy * width + sx]
    }
  }
  return out
}

function scaleImageNearest(data, width, height, nextWidth, nextHeight) {
  if (width === nextWidth && height === nextHeight) return data
  const out = new Uint8ClampedArray(nextWidth * nextHeight * 4)
  for (let y = 0; y < nextHeight; y++) {
    for (let x = 0; x < nextWidth; x++) {
      const sx = Math.min(width - 1, Math.floor(x * width / nextWidth))
      const sy = Math.min(height - 1, Math.floor(y * height / nextHeight))
      const sourceIndex = (sy * width + sx) * 4, targetIndex = (y * nextWidth + x) * 4
      out[targetIndex] = data[sourceIndex]
      out[targetIndex + 1] = data[sourceIndex + 1]
      out[targetIndex + 2] = data[sourceIndex + 2]
      out[targetIndex + 3] = data[sourceIndex + 3]
    }
  }
  return out
}

function scaleLabelsNearest(labels, width, height, nextWidth, nextHeight) {
  if (width === nextWidth && height === nextHeight) return Int16Array.from(labels)
  const out = new Int16Array(nextWidth * nextHeight)
  for (let y = 0; y < nextHeight; y++) {
    for (let x = 0; x < nextWidth; x++) {
      const sx = Math.min(width - 1, Math.floor(x * width / nextWidth))
      const sy = Math.min(height - 1, Math.floor(y * height / nextHeight))
      out[y * nextWidth + x] = labels[sy * width + sx]
    }
  }
  return out
}

const distance = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2

function sortByArea(labels, centers, preserveOrder = false) {
  const area = centers.map(() => 0)
  labels.forEach(i => { if (i >= 0) area[i]++ })
  if (preserveOrder) return { labels, palette: centers, area }
  const order = area.map((size, index) => ({ size, index })).sort((a, b) => b.size - a.size)
  const map = new Map(order.map((item, index) => [item.index, index]))
  return {
    labels: labels.map(i => i < 0 ? -1 : map.get(i)),
    palette: order.map(item => centers[item.index]),
    area: order.map(item => item.size)
  }
}

// Match pixel_3d-demo's rectangle pass: each contiguous run becomes one
// printable cuboid instead of rendering a sampled point cloud.
export function findPrintRectangles(labels, width, height, layerCount) {
  const layers = Array.from({ length: layerCount }, () => [])
  for (let layer = 0; layer < layerCount; layer++) {
    const visited = new Uint8Array(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const start = y * width + x
        if (visited[start] || labels[start] !== layer) continue
        let rectWidth = 0
        while (x + rectWidth < width) {
          const index = y * width + x + rectWidth
          if (visited[index] || labels[index] !== layer) break
          rectWidth++
        }
        if (!rectWidth) continue
        let rectHeight = 0
        while (y + rectHeight < height) {
          let valid = true
          for (let xx = x; xx < x + rectWidth; xx++) {
            const index = (y + rectHeight) * width + xx
            if (visited[index] || labels[index] !== layer) {
              valid = false
              break
            }
          }
          if (!valid) break
          rectHeight++
        }
        for (let yy = y; yy < y + rectHeight; yy++) {
          for (let xx = x; xx < x + rectWidth; xx++) visited[yy * width + xx] = 1
        }
        layers[layer].push({ x, y, width: rectWidth, height: rectHeight })
      }
    }
  }
  return layers
}

export function removeIsolatedPixels(labels, width, height, maxSize) {
  const threshold = Math.max(0, Math.min(20, Math.round(Number(maxSize) || 0)))
  if (!threshold) return labels
  const visited = new Uint8Array(labels.length)
  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]]
  const next = Int16Array.from(labels)
  for (let start = 0; start < labels.length; start++) {
    if (visited[start] || labels[start] < 0) continue
    const sourceLabel = labels[start]
    const component = []
    const queue = [start]
    visited[start] = 1
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor]
      component.push(index)
      const x = index % width, y = Math.floor(index / width)
      for (const [dx, dy] of directions) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
        const neighbor = ny * width + nx
        if (!visited[neighbor] && labels[neighbor] === sourceLabel) {
          visited[neighbor] = 1
          queue.push(neighbor)
        }
      }
    }
    if (component.length > threshold) continue
    const adjacent = new Map()
    for (const index of component) {
      const x = index % width, y = Math.floor(index / width)
      for (const [dx, dy] of directions) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
        const neighbor = ny * width + nx, label = labels[neighbor]
        if (label >= 0 && label !== sourceLabel && !component.includes(neighbor)) adjacent.set(label, (adjacent.get(label) || 0) + 1)
      }
    }
    let replacement = sourceLabel, bestCount = 0
    adjacent.forEach((count, label) => { if (count > bestCount) { replacement = label; bestCount = count } })
    if (replacement !== sourceLabel) component.forEach(index => { next[index] = replacement })
  }
  return next
}

export function smoothColorBoundaries(labels, width, height, radius) {
  const size = Math.max(0, Math.min(10, Math.round(Number(radius) || 0)))
  if (!size) return labels
  let colorCount = 0
  for (const label of labels) colorCount = Math.max(colorCount, label + 1)
  const output = Int16Array.from(labels), votes = new Int32Array(colorCount)
  // Apply the demo's neighborhood mode filter to shared labels. Independent
  // binary-layer filters could otherwise create overlaps or transparent seams.
  for (let y = 0; y < height; y++) {
    votes.fill(0)
    const top = Math.max(0, y - size), bottom = Math.min(height - 1, y + size)
    const addColumn = (x, delta) => {
      if (x < 0 || x >= width) return
      for (let row = top; row <= bottom; row++) {
        const label = labels[row * width + x]
        if (label >= 0) votes[label] += delta
      }
    }
    for (let x = 0; x <= Math.min(size, width - 1); x++) addColumn(x, 1)
    for (let x = 0; x < width; x++) {
      const index = y * width + x, current = labels[index]
      if (current >= 0) {
        let best = current
        for (let label = 0; label < colorCount; label++) {
          if (votes[label] > votes[best]) best = label
        }
        output[index] = best
      }
      addColumn(x - size, -1)
      addColumn(x + size + 1, 1)
    }
  }
  return output
}

export function separateImage(source, settings, previousPalette = [], onProgress = () => {}, includePixels = true) {
  const plan = getRasterPlan(source, settings)
  onProgress(`正在准备 ${plan.gridWidth} × ${plan.gridHeight} 采样…`)
  const scaled = plan.mode === 'print' ? resampleImage(source, plan.gridWidth, plan.gridHeight) : resizePixels(source.data, source.width, source.height, settings.blockSize || 1)
  const pixels = preparePixels(scaled, settings)
  const workingExcluded = new Uint8Array(scaled.width * scaled.height)
  for (let i = 0; i < workingExcluded.length; i++) workingExcluded[i] = scaled.data[i * 4 + 3] === 0 ? 1 : 0
  for (const item of settings.excludedMasks || []) {
    const mask = resizeMask(item.data, item.width, item.height, scaled.width, scaled.height)
    for (let i = 0; i < workingExcluded.length; i++) workingExcluded[i] = workingExcluded[i] || mask[i]
  }
  const count = Math.max(1, Math.min(36, Number(settings.colorCount)))
  const locked = settings.lockedColors || []
  const sourceLocked = (settings.lockedSourceColors || []).map(hexToRgb)
  // Source locks take priority and must not become persistent layer locks.
  // Otherwise unlocking the original swatch would still leave its center fixed.
  const fixedColors = [...sourceLocked, ...locked].filter((color, index, all) => all.findIndex(other => distance(other, color) < .01) === index)
  const seedPalette = settings.fresh ? [] : previousPalette
  const previousCenters = seedPalette.map(item => item.rgb || (item.hex ? hexToRgb(item.hex) : null)).filter(Boolean)
  const fixedCenters = settings.preservePalette && previousCenters.length >= count ? previousCenters.slice(0, count) : fixedColors
  onProgress(`正在进行 KMeans 分色（${count} 色）…`)
  const { centers, labels } = clusterPixels(pixels, workingExcluded, count, fixedCenters, settings.preservePalette ? [] : previousCenters)
  onProgress('正在平滑边界和清理孤立像素…')
  const smoothedLabels = smoothColorBoundaries(labels, scaled.width, scaled.height, settings.smooth)
  const cleanedLabels = removeIsolatedPixels(smoothedLabels, scaled.width, scaled.height, settings.isolatedPixels)
  onProgress('正在按毫米线宽合并过细色块…')
  const printable = plan.algorithm === 'bigchx-k' ? refinePrintableLabels(cleanedLabels, scaled.width, scaled.height, centers.length, plan) : { labels: cleanedLabels }
  onProgress('正在生成连续可打印轮廓…')
  const preserveOrder = Boolean(settings.preservePalette && fixedCenters.length >= count)
  const sorted = sortByArea(printable.labels, centers, preserveOrder)
  const finalPalette = sorted.palette.map((color, i) => {
    if (preserveOrder && previousPalette[i]?.hex) return previousPalette[i]
    return { hex: rgbToHex(color), locked: locked.some(item => distance(item, color) < .01) }
  })
  const remappedLocked = finalPalette.map((item, i) => ({ ...item, locked: Boolean(item.locked), rgb: sorted.palette[i] }))
  const outputLabels = scaleLabelsNearest(sorted.labels, scaled.width, scaled.height, plan.outputWidth, plan.outputHeight)
  const outputExcluded = new Uint8Array(plan.outputWidth * plan.outputHeight)
  for (let i = 0; i < outputLabels.length; i++) outputExcluded[i] = outputLabels[i] < 0 ? 1 : 0
  const outputArea = remappedLocked.map(() => 0)
  outputLabels.forEach(label => { if (label >= 0) outputArea[label]++ })
  return {
    width: plan.outputWidth,
    height: plan.outputHeight,
    printSpec: plan,
    gridWidth: scaled.width,
    gridHeight: scaled.height,
    pixels: includePixels ? scaleImageNearest(pixels, scaled.width, scaled.height, plan.outputWidth, plan.outputHeight) : undefined,
    labels: outputLabels,
    excludedMask: outputExcluded,
    printRectangles: plan.algorithm === 'bigchx-k' ? [] : findPrintRectangles(sorted.labels, scaled.width, scaled.height, sorted.palette.length),
    printContours: plan.algorithm === 'bigchx-k' ? makePrintContours(sorted.labels, scaled.width, scaled.height, sorted.palette.length, plan) : null,
    printReport: printable.report ? { ...printable.report, removedLayers: outputArea.flatMap((area, i) => area ? [] : [i]) } : undefined,
    palette: remappedLocked,
    area: outputArea
  }
}

export function refineEditedResult(result) {
  const { width, height, palette, printSpec } = result
  const refined = refinePrintableLabels(result.labels, width, height, palette.length, printSpec)
  const area = palette.map(() => 0)
  refined.labels.forEach(label => { if (label >= 0) area[label]++ })
  return {
    ...result, labels: refined.labels, area, excludedMask: Uint8Array.from(refined.labels, label => label < 0 ? 1 : 0),
    printReport: { ...refined.report, removedLayers: area.flatMap((value, i) => value ? [] : [i]) },
    printContours: makePrintContours(refined.labels, width, height, palette.length, printSpec)
  }
}

export function previewImage(source, settings) {
  const plan = getRasterPlan(source, settings)
  const scaled = plan.mode === 'print' ? resampleImage(source, plan.gridWidth, plan.gridHeight) : resizePixels(source.data, source.width, source.height, settings.blockSize || 1)
  const data = preparePixels(scaled, settings)
  return { width: plan.outputWidth, height: plan.outputHeight, data: scaleImageNearest(data, scaled.width, scaled.height, plan.outputWidth, plan.outputHeight) }
}

export function rgbToHex(rgb) {
  return '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()
}

export function hexToRgb(hex) {
  const value = hex.replace('#', '')
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)]
}
