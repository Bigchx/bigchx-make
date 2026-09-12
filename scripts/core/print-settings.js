export const NOZZLES = {
  '0.2 mm': { nozzle: .2, layerHeight: .1, lineWidth: .22, firstLayerLineWidth: .25 },
  '0.4 mm': { nozzle: .4, layerHeight: .2, lineWidth: .42, firstLayerLineWidth: .5 }
}

export const PRINT_DEFAULTS = {
  resolutionMode: 'print', printWidthCm: 10, printHeightCm: 10,
  keepAspect: true, nozzleKey: '0.4 mm', layerHeight: .2, lineWidth: .42,
  orientation: 'flat', algorithm: 'bigchx-k', syncFirstLayer: true, firstLayerLineWidth: .5,
  thicknessMm: null
}

const MAX_CONTINUOUS_SAMPLES = 4000000
const SAMPLES_ACROSS_FEATURE = 3

export function getModelThickness(spec) {
  // Null keeps the original one-layer / one-line default until explicitly edited.
  const thickness = Number(spec.thicknessMm ?? (spec.orientation === 'flat' ? spec.layerHeight : spec.lineWidth))
  if (!Number.isFinite(thickness) || thickness <= 0) throw new Error('模型厚度必须大于 0 mm')
  return thickness
}

export function sameSeparationPlan(a, b) {
  if (!a || !b) return false
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  // Thickness changes extrusion only; existing color regions and contours remain valid.
  return [...keys].every(key => key === 'thicknessMm' || a[key] === b[key])
}

export function getRasterPlan(source, settings) {
  const profile = NOZZLES[settings.nozzleKey] || NOZZLES['0.4 mm']
  const layerHeight = Number(settings.layerHeight ?? profile.layerHeight)
  const lineWidth = Number(settings.lineWidth ?? profile.lineWidth)
  const orientation = settings.orientation === 'vertical' ? 'vertical' : 'flat'
  const pitch = orientation === 'flat' ? lineWidth : layerHeight
  if (![pitch, lineWidth, layerHeight].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('层高和线宽必须大于 0')
  }
  const thicknessMm = getModelThickness({ thicknessMm: settings.thicknessMm, orientation, layerHeight, lineWidth })
  const isPrint = settings.resolutionMode === 'print'
  const continuous = isPrint && settings.algorithm === 'bigchx-k'
  const firstLayerLineWidth = settings.syncFirstLayer !== false ? lineWidth : Number(settings.firstLayerLineWidth ?? profile.firstLayerLineWidth)
  if (!Number.isFinite(firstLayerLineWidth) || firstLayerLineWidth <= 0) throw new Error('首层线宽必须大于 0')
  let width, height
  if (isPrint) {
    width = Number(settings.printWidthCm) * 10
    height = Number(settings.printHeightCm) * 10
    if (![width, height].every(value => Number.isFinite(value) && value > 0)) {
      throw new Error('成品宽高必须大于 0')
    }
    if (settings.keepAspect !== false) {
      const scale = Math.min(width / source.width, height / source.height)
      width = source.width * scale
      height = source.height * scale
    }
  }
  const minFeatureX = orientation === 'flat' ? Math.max(lineWidth, firstLayerLineWidth) : lineWidth
  const minFeatureY = orientation === 'flat' ? minFeatureX : layerHeight
  // Three samples across the minimum bead are enough for contour tracing while
  // keeping the 0.2 mm profile practical on ordinary browser hardware.
  const samplePitch = Math.min(minFeatureX, minFeatureY) / SAMPLES_ACROSS_FEATURE
  let gridWidth = isPrint ? Math.max(1, Math.round(width / pitch)) : Math.max(2, Math.round(source.width / (settings.blockSize || 1)))
  let gridHeight = isPrint ? Math.max(1, Math.round(height / pitch)) : Math.max(2, Math.round(source.height / (settings.blockSize || 1)))
  if (continuous) {
    // Round down so nominal samples do not become microscopically
    // narrower than a bead and disappear during the physical opening.
    gridWidth = Math.max(2, Math.floor(width / samplePitch))
    gridHeight = Math.max(2, Math.floor(height / samplePitch))
    const scale = Math.min(1, Math.sqrt(MAX_CONTINUOUS_SAMPLES / (gridWidth * gridHeight)))
    gridWidth = Math.max(2, Math.floor(gridWidth * scale))
    gridHeight = Math.max(2, Math.floor(gridHeight * scale))
    if (width / gridWidth > minFeatureX / 2 || height / gridHeight > minFeatureY / 2) {
      throw new Error('当前尺寸无法在 400 万采样点内分辨最小线宽，请减小成品尺寸')
    }
  }
  if (gridWidth * gridHeight > MAX_CONTINUOUS_SAMPLES) throw new Error('打印网格超过 400 万像素，请减小成品尺寸或增大像素间距')
  return {
    mode: isPrint ? 'print' : 'manual', gridWidth, gridHeight,
    outputWidth: isPrint ? gridWidth : source.width,
    outputHeight: isPrint ? gridHeight : source.height,
    widthMm: continuous ? width : gridWidth * pitch, heightMm: continuous ? height : gridHeight * pitch,
    pitch, orientation, nozzle: profile.nozzle, lineWidth, layerHeight,
    algorithm: continuous ? 'bigchx-k' : 'pixel-kmeans', firstLayerLineWidth,
    minFeatureX, minFeatureY,
    samplePitchX: continuous ? width / gridWidth : pitch,
    samplePitchY: continuous ? height / gridHeight : pitch,
    thicknessMm
  }
}

export function getModelSize(spec) {
  const thickness = getModelThickness(spec)
  return spec.orientation === 'flat'
    ? { width: spec.widthMm, depth: spec.heightMm, height: thickness }
    : { width: spec.widthMm, depth: thickness, height: spec.heightMm }
}
