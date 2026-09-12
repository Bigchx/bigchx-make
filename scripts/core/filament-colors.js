import { BAMBU_FILAMENTS } from './bambu-filaments.js'

export function normalizeHex(value) {
  const text = String(value).trim().replace(/^#/, '')
  return /^[\da-f]{6}$/i.test(text) ? `#${text.toUpperCase()}` : null
}

function oklab(hex) {
  const [r, g, b] = normalizeHex(hex).slice(1).match(/../g).map(value => {
    const channel = parseInt(value, 16) / 255
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
  })
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b)
  const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b)
  const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b)
  return [.2104542553 * l + .793617785 * m - .0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + .4505937099 * s,
    .0259040371 * l + .7827717662 * m - .808675766 * s]
}

const catalogLab = new Map(BAMBU_FILAMENTS.map(item => [item.id, oklab(item.hex)]))

const RECOMMENDATION_TYPES = ['PLA Basic', 'PLA Lite', 'PLA Matte', 'PLA Silk', 'PLA Silk+']

function isMultiColor(item) {
  return item.kind !== '单色' || (item.colors && item.colors.length > 1)
}

function materialRank(item) {
  const index = RECOMMENDATION_TYPES.indexOf(item.type)
  return index >= 0 ? index : RECOMMENDATION_TYPES.length
}

function compareRecommendations(a, b) {
  const multi = Number(isMultiColor(a.item)) - Number(isMultiColor(b.item))
  return multi || a.distance - b.distance || materialRank(a.item) - materialRank(b.item) || a.item.id.localeCompare(b.item.id)
}

export function recommendFilaments(hex, type = '', limit = 9, sortBy = 'material') {
  const normalized = normalizeHex(hex)
  if (!normalized) return []
  const reference = oklab(normalized)
  const candidates = BAMBU_FILAMENTS.filter(item => (!type || item.type === type) && item.alpha > 0).map(item => ({
    item, distance: catalogLab.get(item.id).reduce((sum, channel, axis) => sum + (channel - reference[axis]) ** 2, 0)
  }))
  if (sortBy === 'distance') {
    return candidates.sort((a, b) => a.distance - b.distance || a.item.id.localeCompare(b.item.id))
      .slice(0, limit).map(entry => entry.item)
  }
  if (!type) {
    // Keep the requested material order visible in the small recommendation list.
    // One best solid color from each PLA family prevents a white match from being
    // filled with near-identical Basic entries before Lite, Matte, or Silk appear.
    const preferred = []
    for (const preferredType of RECOMMENDATION_TYPES) {
      const match = candidates
        .filter(entry => entry.item.type === preferredType && !isMultiColor(entry.item))
        .sort((a, b) => a.distance - b.distance || a.item.id.localeCompare(b.item.id))[0]
      if (match) preferred.push(match)
    }
    const selected = new Set(preferred.map(entry => entry.item.id))
    return preferred.concat(candidates.filter(entry => !selected.has(entry.item.id)).sort(compareRecommendations))
      .slice(0, limit).map(entry => entry.item)
  }
  return candidates.sort(compareRecommendations).slice(0, limit).map(entry => entry.item)
}

export function filterFilaments(query = '', type = '') {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return BAMBU_FILAMENTS.filter(item => (!type || item.type === type) && words.every(word =>
    `${item.type} ${item.name} ${item.nameEn} ${item.colorCode} ${item.hex}`.toLowerCase().includes(word)))
}
