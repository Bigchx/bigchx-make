#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const localPath = new URL('../manifest.json', import.meta.url);
const endpoint = 'https://skills.bigchx.com/skills/manifest.json';
const day = 24 * 60 * 60 * 1000;
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
function parseVersion(value) {
  const m = typeof value === 'string' && value.match(semver);
  if (!m || m[4]?.split('.').some(p => /^\d+$/.test(p) && p.length > 1 && p[0] === '0')) throw new Error('Invalid semantic version');
  return { numbers: m.slice(1, 4).map(BigInt), pre: m[4]?.split('.') || [] };
}
export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  for (let i = 0; i < 3; i++) if (x.numbers[i] !== y.numbers[i]) return x.numbers[i] > y.numbers[i] ? 1 : -1;
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const u = x.pre[i], v = y.pre[i];
    if (u === v) continue;
    if (u === undefined || v === undefined) return u === undefined ? -1 : 1;
    const un = /^\d+$/.test(u), vn = /^\d+$/.test(v);
    if (un && vn) return BigInt(u) > BigInt(v) ? 1 : -1;
    if (un !== vn) return un ? -1 : 1;
    return u > v ? 1 : -1;
  }
  return 0;
}
export function validateManifest(m) {
  if (!m || m.schemaVersion !== 1 || m.name !== 'bigchx-make' || !m.modules || typeof m.modules !== 'object' || Array.isArray(m.modules)) throw new Error('Invalid Bigchx Make manifest');
  parseVersion(m.version);
  for (const [id, module] of Object.entries(m.modules)) {
    if (!/^[a-z][a-z0-9-]*$/.test(id) || !module || module.status !== 'available') throw new Error('Invalid module');
    parseVersion(module.version);
  }
  if (!Object.keys(m.modules).length) throw new Error('No modules');
  // Return only comparison data; remote descriptions are never instructions.
  return { schemaVersion: 1, name: m.name, version: m.version, modules: Object.fromEntries(Object.entries(m.modules).map(([id, module]) => [id, { version: module.version, status: 'available' }])) };
}
export function compareManifests(local, remote, moduleIds = []) {
  const a = validateManifest(local), b = validateManifest(remote);
  const ids = [...new Set(['core', ...(moduleIds.length ? moduleIds : Object.keys(a.modules))])].sort();
  for (const id of ids) if (!a.modules[id]) throw new Error(`未知本地模块：${id}`);
  const packageOrder = compareVersions(b.version, a.version);
  const updates = packageOrder < 0 ? [] : ids.flatMap(id => b.modules[id] && compareVersions(b.modules[id].version, a.modules[id].version) > 0 ? [{ module: id, installed: a.modules[id].version, latest: b.modules[id].version }] : []);
  const packageUpdate = packageOrder > 0;
  return { status: packageUpdate || updates.length ? 'update-available' : 'up-to-date', installed: a.version, latest: b.version, modules: updates, updateStrategy: 'whole-package', download: 'https://oss.3dp.ing/skills/bigchx-make-skill.zip', changelog: 'https://skills.bigchx.com/#releases' };
}

export async function checkUpdates({ moduleIds = [], force = false, localFile = localPath, cacheFile = path.join(os.homedir(), '.cache', 'bigchx-make', 'update.json'), fetchImpl = fetch, now = Date.now() } = {}) {
  if (process.env.BIGCHX_MAKE_UPDATE_CHECK === '0' && !force) return { status: 'disabled', canContinue: true };
  const local = JSON.parse(await fs.readFile(localFile, 'utf8'));
  validateManifest(local);
  for (const id of moduleIds) if (!local.modules[id]) throw new Error(`未知本地模块：${id}`);
  let cache = {};
  try { cache = JSON.parse(await fs.readFile(cacheFile, 'utf8')); } catch {}
  const fresh = typeof cache.checkedAt === 'number' && now >= cache.checkedAt && now - cache.checkedAt < day;
  let remote, unavailable;
  if (fresh && !force) {
    try { if (cache.remote) remote = validateManifest(cache.remote); else unavailable = true; } catch {}
  }
  if (!remote && !unavailable) {
    try {
      const response = await fetchImpl(endpoint, { signal: AbortSignal.timeout(2500), redirect: 'error', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const reader = response.body.getReader();
      let size = 0, chunks = [];
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 256 * 1024) throw new Error('Manifest too large');
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      remote = validateManifest(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      cache = { ...cache, checkedAt: now, remote };
    } catch { cache = { ...cache, checkedAt: now, remote: null }; unavailable = true; }
  }
  let result = unavailable ? { status: 'unavailable', canContinue: true, message: '暂时无法检查新版本，继续使用本地技能。' } : compareManifests(local, remote, moduleIds);
  if (result.status === 'update-available') {
    const key = JSON.stringify([result.installed, result.latest, result.modules]);
    const seen = cache.notices?.[key];
    result.shouldNotify = force || typeof seen !== 'number' || now < seen || now - seen >= day;
    if (result.shouldNotify) {
      cache.notices = Object.fromEntries(Object.entries(cache.notices || {}).filter(([, seenAt]) => typeof seenAt === 'number' && now >= seenAt && now - seenAt < day));
      cache.notices[key] = now;
    }
  }
  try { await fs.mkdir(path.dirname(cacheFile), { recursive: true }); await fs.writeFile(cacheFile, JSON.stringify(cache) + '\n'); } catch {}
  return { ...result, checkedEndpoint: endpoint };
}

export async function notifyUpdates(moduleIds) {
  try {
    const result = await checkUpdates({ moduleIds });
    if (result.status === 'update-available' && result.shouldNotify) {
      process.stderr.write(JSON.stringify({ update: result, message: `Bigchx Make 有更新 ${result.installed} → ${result.latest}；当前任务继续，更新请下载完整技能包。` }) + '\n');
    }
  } catch { /* A version check must not break local computation. */ }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    process.stdout.write('node scripts/check-update.mjs [--module vector-redraw,print-export] [--force]\n');
  } else {
    let moduleIds = [], force = false;
    try {
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--force') force = true;
        else if (args[i] === '--module' && args[i + 1]) moduleIds = args[++i].split(',');
        else throw new Error('使用 --module 模块名 或 --force');
      }
      process.stdout.write(JSON.stringify(await checkUpdates({ moduleIds, force }), null, 2) + '\n');
    } catch (error) { process.stderr.write(JSON.stringify({ error: error.message }) + '\n'); process.exitCode = 1; }
  }
}
