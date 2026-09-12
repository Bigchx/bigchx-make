#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { notifyUpdates } from './check-update.mjs';

// This accepts the inspectable, geometry-only SVGs authored by the assistant.
// It is a workflow preflight, not a sandbox for arbitrary untrusted SVGs.
export async function renderSvg({ input, out, size = 1600 }) {
  if (!input || !out) throw new Error('需要 --input artwork.svg 和 --out 输出目录');
  if (!Number.isInteger(size) || size < 64 || size > 4096) throw new Error('--size 必须为 64–4096 的整数（最长边像素数）');
  const svg = await fs.readFile(input, 'utf8');
  if (!/<svg\b/i.test(svg)) throw new Error('输入必须为 SVG');
  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[|\b(?:href|style|filter|mask|clip-path)\s*=|\bon\w+\s*=|url\s*\(/i.test(svg)) {
    throw new Error('请将样式、引用、滤镜及外部资源整理为自包含纯色路径');
  }
  const allowed = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'title', 'desc', 'metadata']);
  for (const match of svg.matchAll(/<\/?([A-Za-z][\w:.-]*)\b/g)) {
    if (!allowed.has(match[1])) throw new Error(`不支持 <${match[1]}>；请转换为纯色几何路径`);
  }
  const viewBox = svg.match(/\bviewBox\s*=\s*["']([^"']+)["']/)?.[1].trim().split(/[\s,]+/).map(Number);
  if (!viewBox || viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2] <= 0 || viewBox[3] <= 0) throw new Error('SVG 需要有效的 viewBox');
  const palette = new Set();
  for (const match of svg.matchAll(/\b(?:fill|stroke)\s*=\s*(["'])(.*?)\1/g)) {
    if (match[2] === 'none') continue;
    if (!/^#[0-9a-f]{6}$/i.test(match[2])) throw new Error('fill/stroke 仅支持六位 HEX 或 none');
    palette.add(match[2].toUpperCase());
  }
  for (const match of svg.matchAll(/\b(?:opacity|fill-opacity|stroke-opacity)\s*=\s*(["'])(.*?)\1/g)) {
    if (Number(match[2]) !== 1) throw new Error('平涂 SVG 请移除透明叠色，用明确的纯色填充');
  }
  if (!palette.size || palette.size > 36) throw new Error('请显式声明 1–36 种纯色，包括描边颜色');

  const png = await sharp(Buffer.from(svg), { limitInputPixels: 100000000 })
    .resize({ width: size, height: size, fit: 'inside' }).ensureAlpha().png().toBuffer();
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = -1, bottom = -1, transparentPixels = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const alpha = data[(y * info.width + x) * 4 + 3];
    if (alpha === 0) transparentPixels++;
    if (alpha >= 128) {
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  if (right < left) throw new Error('SVG 没有可见主体');
  const crop = { left, top, width: right - left + 1, height: bottom - top + 1 };
  const target = path.resolve(out);
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, 'artwork.svg'), svg);
  await fs.writeFile(path.join(target, 'transparent.png'), png);
  await sharp(png).flatten({ background: '#FFFFFF' }).png().toFile(path.join(target, 'preview.png'));
  // Trim by alpha, never by RGB: interior white highlights remain printable.
  const printData = Buffer.from(data);
  for (let i = 3; i < printData.length; i += 4) printData[i] = printData[i] >= 128 ? 255 : 0;
  await sharp(printData, { raw: { width: info.width, height: info.height, channels: 4 } })
    .extract(crop).png().toFile(path.join(target, 'subject-print.png'));
  const colors = [...palette];
  await fs.writeFile(path.join(target, 'palette.json'), JSON.stringify({ declaredColors: colors, meaning: 'SVG declared HEX values; not pixel statistics or guaranteed nonempty layers' }, null, 2) + '\n');
  const report = { input: path.resolve(input), output: target, widthPx: info.width, heightPx: info.height, crop, declaredColorCount: colors.length, transparentPixels, hasTransparentPixels: transparentPixels > 0, printInput: path.join(target, 'subject-print.png'), preview: path.join(target, 'preview.png') };
  await fs.writeFile(path.join(target, 'render.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

async function main(argv) {
  if (argv.length === 1 && ['--help', 'help'].includes(argv[0])) return { usage: 'node scripts/render-svg.mjs --input artwork.svg --out job/vector [--size 1600]', purpose: 'Render an existing flat-color SVG; does not redraw or trace images.' };
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!['input', 'out', 'size'].includes(key) || !argv[i].startsWith('--') || !argv[i + 1] || key in options) throw new Error('参数格式为 --input 文件 --out 目录 [--size 整数]');
    options[key] = key === 'size' ? Number(argv[i + 1]) : argv[i + 1];
  }
  await notifyUpdates(['vector-redraw']);
  return renderSvg(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(result => process.stdout.write(JSON.stringify(result, null, 2) + '\n')).catch(error => {
    process.stderr.write(JSON.stringify({ error: error.message }) + '\n');
    process.exitCode = 1;
  });
}
