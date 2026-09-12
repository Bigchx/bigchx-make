#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { loadState } from './run.mjs';
import { notifyUpdates } from './check-update.mjs';
import { createRaisedLogo } from './core/raised-logo.js';
import { createModelArchive } from './core/model-export.js';
import { getModelSize } from './core/print-settings.js';
import { PRINTERS } from './core/printers.js';

async function main() {
  const args = process.argv.slice(2), options = {};
  if (args.includes('--help')) return { usage: 'node scripts/raised-logo.mjs --state project.json.gz --layers 2 --base-thickness 2 --raise-layers 1 --base-color "#FFFFFF" --printer A1 --out job/raised', note: 'Layer numbers are 1-based. Omit --layers only for a transparent, background-free source. --base-filament accepts an official component ID.' };
  const allowed = ['state','layers','base-thickness','raise-layers','base-color','base-filament','printer','out'];
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    if (!args[i].startsWith('--') || !allowed.includes(key) || options[key] !== undefined || args[i + 1] === undefined) throw new Error('Invalid or duplicate argument');
    options[key] = args[i + 1];
  }
  for (const key of ['state','printer','out']) if (!options[key]) throw new Error(`Missing --${key}`);
  await notifyUpdates(['raised-logo','print-export']);
  const state = await loadState(options.state);
  const raised = createRaisedLogo(state.result, state.palette, {
    baseThicknessMm: Number(options['base-thickness'] ?? 2), raiseLayers: Number(options['raise-layers'] ?? 1),
    selectedLayers: options.layers === undefined ? undefined : options.layers.split(',').map(x => Number(x) - 1),
    baseColor: options['base-color'] ?? '#FFFFFF', baseFilament: options['base-filament'],
  });
  const bed = PRINTERS[options.printer], size = getModelSize(raised.result.printSpec);
  if (!bed) throw new Error('Unsupported printer');
  if (size.width > bed.x || size.depth > bed.y || size.height > bed.z) throw new Error('Raised model exceeds the printer build volume; recalculate at the intended dimensions');
  const archive = await createModelArchive(raised.result, raised.palette, { printerName: options.printer });
  const bytes = new Uint8Array(await archive.arrayBuffer());
  const zip = await JSZip.loadAsync(bytes), out = path.resolve(options.out);
  await fs.mkdir(out, { recursive: true });
  await fs.writeFile(path.join(out, 'bigchx-make-raised-logo.3mf'), await zip.file('bigchx-make-model.3mf').async('uint8array'));
  await fs.writeFile(path.join(out, 'bigchx-make-raised-logo.zip'), bytes);
  await fs.writeFile(path.join(out, 'height-plan.json'), JSON.stringify({ ...raised.heightPlan, sizeMm: size, printer: options.printer, sliced: false }, null, 2) + '\n');
  return { model: path.join(out, 'bigchx-make-raised-logo.3mf'), ...raised.heightPlan, sizeMm: size, printer: options.printer, sliced: false };
}
main().then(value => process.stdout.write(JSON.stringify(value, null, 2) + '\n')).catch(error => { process.stderr.write(JSON.stringify({ error: error.message }) + '\n'); process.exitCode = 1; });
