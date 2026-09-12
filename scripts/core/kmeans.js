const squaredDistance = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2

function randomSequence(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

function samplePixels(pixels, excluded) {
  const limit = 18000, indices = new Int32Array(limit), random = randomSequence(42)
  let seen = 0
  // Reservoir sampling avoids favoring the top of an image or a periodic grid.
  for (let p = 0; p < pixels.length / 4; p++) {
    if (excluded[p]) continue
    const slot = seen < limit ? seen : Math.floor(random() * (seen + 1))
    if (slot < limit) indices[slot] = p
    seen++
  }
  const count = Math.min(seen, limit), samples = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const offset = indices[i] * 4
    samples[i * 3] = pixels[offset]
    samples[i * 3 + 1] = pixels[offset + 1]
    samples[i * 3 + 2] = pixels[offset + 2]
  }
  return samples
}

function seedCenters(samples, count, fixed, previous, random) {
  const centers = fixed.slice(0, count).map(color => [...color])
  for (const color of previous) {
    if (centers.length >= count) break
    if (centers.every(center => squaredDistance(center, color) > .01)) centers.push([...color])
  }
  const sampleCount = samples.length / 3
  const sampleAt = index => Array.from(samples.subarray(index * 3, index * 3 + 3))
  if (!centers.length) centers.push(sampleAt(Math.floor(random() * sampleCount)))
  const nearest = new Float64Array(sampleCount).fill(Infinity)
  let included = 0
  while (centers.length < count) {
    for (; included < centers.length; included++) {
      const center = centers[included]
      for (let i = 0; i < sampleCount; i++) {
        const p = i * 3
        const distance = (samples[p] - center[0]) ** 2 + (samples[p + 1] - center[1]) ** 2 + (samples[p + 2] - center[2]) ** 2
        nearest[i] = Math.min(nearest[i], distance)
      }
    }
    let total = 0
    for (const value of nearest) total += value
    if (!total) {
      while (centers.length < count) centers.push([...centers[0]])
      break
    }
    let target = random() * total, selected = sampleCount - 1
    for (let i = 0; i < sampleCount; i++) {
      target -= nearest[i]
      if (target <= 0 && nearest[i] > 0) { selected = i; break }
    }
    centers.push(sampleAt(selected))
  }
  return centers
}

function assign(pixels, stride, centers, excluded, labels, sums) {
  let error = 0
  for (let offset = 0, p = 0; offset < pixels.length; offset += stride, p++) {
    if (excluded?.[p]) { if (labels) labels[p] = -1; continue }
    const r = pixels[offset], g = pixels[offset + 1], b = pixels[offset + 2]
    let closest = 0, best = Infinity
    for (let c = 0; c < centers.length; c++) {
      const center = centers[c]
      const distance = (r - center[0]) ** 2 + (g - center[1]) ** 2 + (b - center[2]) ** 2
      if (distance < best) { best = distance; closest = c }
    }
    error += best
    if (labels) labels[p] = closest
    if (sums) {
      const sum = closest * 4
      sums[sum] += r; sums[sum + 1] += g; sums[sum + 2] += b; sums[sum + 3]++
    }
  }
  return error
}

// Browser port of pixel_3d-demo's RGB KMeans: k-means++ seeds, up to 50
// iterations and 10 deterministic starts. Fit a bounded sample, label every pixel.
export function clusterPixels(pixels, excluded, count, fixed = [], previous = []) {
  let centers
  if (fixed.length >= count) centers = fixed.slice(0, count).map(color => [...color])
  else {
    const samples = samplePixels(pixels, excluded)
    if (!samples.length) centers = Array.from({ length: count }, (_, i) => [...(fixed[i] || [0, 0, 0])])
    else {
      let bestError = Infinity
      const starts = previous.length ? 1 : 10
      for (let start = 0; start < starts; start++) {
        let candidate = seedCenters(samples, count, fixed, previous, randomSequence(42 + start * 997))
        for (let iteration = 0; iteration < 50; iteration++) {
          const sums = new Float64Array(count * 4)
          assign(samples, 3, candidate, null, null, sums)
          let movement = 0
          candidate = candidate.map((center, i) => {
            if (i < fixed.length || !sums[i * 4 + 3]) return center
            const next = [0, 1, 2].map(channel => sums[i * 4 + channel] / sums[i * 4 + 3])
            movement = Math.max(movement, squaredDistance(center, next))
            return next
          })
          if (movement < .01) break
        }
        const error = assign(samples, 3, candidate)
        if (error < bestError) { bestError = error; centers = candidate }
      }
    }
  }
  const labels = new Int16Array(pixels.length / 4)
  assign(pixels, 4, centers, excluded, labels)
  return { centers, labels }
}
