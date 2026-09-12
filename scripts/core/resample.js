// Area averaging for reduction and linear interpolation for enlargement.
// Premultiplied alpha keeps transparent backgrounds out of edge colors.
function weights(sourceSize, targetSize) {
  const scale = sourceSize / targetSize
  return Array.from({ length: targetSize }, (_, index) => {
    if (scale <= 1) {
      const point = Math.max(0, Math.min(sourceSize - 1, (index + .5) * scale - .5))
      const start = Math.floor(point), fraction = point - start
      return [[start, 1 - fraction], [Math.min(sourceSize - 1, start + 1), fraction]]
    }
    const start = index * scale, end = (index + 1) * scale, items = []
    for (let pixel = Math.floor(start); pixel < Math.min(sourceSize, Math.ceil(end)); pixel++) {
      items.push([pixel, (Math.min(end, pixel + 1) - Math.max(start, pixel)) / scale])
    }
    return items
  })
}

export function resampleImage(source, width, height) {
  if (source.width === width && source.height === height) return { ...source, data: new Uint8ClampedArray(source.data) }
  const horizontal = weights(source.width, width), vertical = weights(source.height, height)
  const intermediate = new Float32Array(width * source.height * 4)
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < width; x++) {
      const target = (y * width + x) * 4
      for (const [sx, weight] of horizontal[x]) {
        const index = (y * source.width + sx) * 4, alpha = source.data[index + 3] / 255
        for (let c = 0; c < 3; c++) intermediate[target + c] += source.data[index + c] * alpha * weight
        intermediate[target + 3] += alpha * weight
      }
    }
  }
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const target = (y * width + x) * 4, sums = [0, 0, 0, 0]
      for (const [sy, weight] of vertical[y]) {
        const index = (sy * width + x) * 4
        for (let c = 0; c < 4; c++) sums[c] += intermediate[index + c] * weight
      }
      if (sums[3] > 0) for (let c = 0; c < 3; c++) data[target + c] = sums[c] / sums[3]
      data[target + 3] = sums[3] * 255
    }
  }
  return { data, width, height }
}
