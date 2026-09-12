import { BAMBU_FILAMENTS } from './bambu-filaments.js'

export function createRaisedLogo(result, palette, { baseThicknessMm = 2, raiseLayers = 1, selectedLayers, baseColor = '#FFFFFF', baseFilament } = {}) {
  const spec = result.printSpec
  if (spec.orientation !== 'flat' || spec.algorithm !== 'bigchx-k' || !result.printContours) throw new Error('Raised logos require flat printable contours')
  if (!Number.isFinite(baseThicknessMm) || baseThicknessMm <= 0 || baseThicknessMm > 100) throw new Error('Base thickness must be greater than 0 and at most 100 mm')
  if (!Number.isInteger(raiseLayers) || raiseLayers < 1 || raiseLayers > 100) throw new Error('Raised layer count must be an integer from 1 to 100')
  const layerHeight = spec.layerHeight
  if (!Number.isFinite(layerHeight) || layerHeight <= 0) throw new Error('Invalid slicer layer height')
  const aligned = baseThicknessMm / layerHeight
  if (Math.abs(aligned - Math.round(aligned)) > 1e-5) throw new Error('Base thickness must be a whole multiple of the slicer layer height')
  const indices = selectedLayers ?? palette.map((_, index) => index)
  if (!Array.isArray(indices) || !indices.length || new Set(indices).size !== indices.length || indices.some(index => !Number.isInteger(index) || index < 0 || index >= palette.length || !result.printContours[index]?.length)) throw new Error('Select non-empty, distinct logo layer indices')
  if (indices.length > 35) throw new Error('At most 35 logo layers plus one base are supported')
  const filament = baseFilament ? BAMBU_FILAMENTS.find(item => item.id === baseFilament) : null
  if (baseFilament && !filament) throw new Error('Unknown base filament component ID')
  const hex = filament?.hex || baseColor
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error('Base color must be a six-digit HEX')
  const top = Number((baseThicknessMm + raiseLayers * layerHeight).toFixed(6))
  const heightPlan = { baseThicknessMm, layerHeightMm: layerHeight, raisedLayerCount: raiseLayers, raisedHeightMm: Number((raiseLayers * layerHeight).toFixed(6)), totalHeightMm: top, baseShape: 'rectangle', selectedLayers: indices.map(i => i + 1) }
  const partHeightRanges = [{ bottomMm: 0, topMm: baseThicknessMm }, ...indices.map(() => ({ bottomMm: baseThicknessMm, topMm: top }))]
  const base = { outer: [[0,0], [spec.widthMm,0], [spec.widthMm,spec.heightMm], [0,spec.heightMm]], holes: [] }
  return {
    result: { ...result, printSpec: { ...spec, thicknessMm: top }, printContours: [[base], ...indices.map(i => result.printContours[i])], printRectangles: [], partHeightRanges, heightPlan, partNames: ['Base plate', ...indices.map(i => `Raised logo · layer ${i + 1}`)] },
    palette: [{ hex: hex.toUpperCase(), filament }, ...indices.map(i => palette[i])],
    heightPlan,
  }
}
