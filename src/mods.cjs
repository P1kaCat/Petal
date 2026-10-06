const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { safeFilename } = require('./store.cjs');
const { isPetalDownload } = require('./petal-url.cjs');
async function download(file, fetcher = fetch, petalBaseUrl = '', curseforgeKey = '',type='mod') {
  const url = new URL(file.url);
  const trustedCDN = url.protocol === 'https:' && ['cdn.modrinth.com', 'mediafilez.forgecdn.net', 'edge.forgecdn.net', 'media.forgecdn.net'].includes(url.hostname);
  if (!trustedCDN && !isPetalDownload(url, petalBaseUrl)) throw new Error('Download URL not allowed.');
  require('./content-format.cjs').safeContentFilename(file.name,type);
  if (!file.hash || !['sha1', 'sha512'].includes(file.algorithm)) throw new Error('Missing file checksum.');
  const headers = url.protocol === 'https:' && url.hostname === 'edge.forgecdn.net' && curseforgeKey ? {'x-api-key':curseforgeKey} : {};
  const response = await fetcher(url, { redirect: 'error', headers, signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}.`);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > 256 * 1024 * 1024) throw new Error('File too large (256 MB limit).'); chunks.push(chunk); }
  const buffer = Buffer.concat(chunks);
  if (createHash(file.algorithm).update(buffer).digest('hex') !== file.hash.toLowerCase()) throw new Error('Checksum mismatch: download rejected.');
  return buffer;
}
async function planInstall(catalog, profile, source, id, roots) {
  const resolved = new Map(); const visited = new Set();
  async function visit(dep) {
    const visitKey = `${dep.source}:${dep.id || ''}:${dep.versionId || ''}`;
    if (visited.has(visitKey)) return;
    visited.add(visitKey);
    if (visited.size > 100) throw new Error('Too many dependencies (100 limit).');
    const mod = await catalog.resolve(dep.source, dep.id, profile, dep.versionId);
    const key = `${mod.source}:${mod.id}`;
    const previous = resolved.get(key);
    if (previous && previous.versionId !== mod.versionId) throw new Error(`Two different versions of ${mod.title} are required.`);
    resolved.set(key, mod);
    for (const dependency of mod.dependencies) {
      if (!dependency.id && !dependency.versionId) throw new Error('External dependency: manual installation required.');
      const installed = profile.mods.find(m => m.source === dependency.source && m.id === dependency.id && m.enabled !== false && (!dependency.versionId || m.versionId === dependency.versionId));
      if (!installed) await visit(dependency);
    }
  }
  for(const root of roots||[{source,id}])await visit(root);
  const installed = profile.mods.filter(m => m.enabled !== false && !resolved.has(`${m.source}:${m.id}`));
  const all = [...installed, ...resolved.values()];
  for (const mod of all) for (const dependency of mod.dependencies || []) {
    if (!all.some(m => m.source === dependency.source && (dependency.id ? m.id === dependency.id : m.versionId === dependency.versionId) && (!dependency.versionId || m.versionId === dependency.versionId))) throw new Error(`The version required by ${mod.title} is missing. Installation cancelled.`);
  }
  for (const mod of all) for (const conflict of mod.incompatible || []) {
    if (all.some(m => m.source === conflict.source && (conflict.id ? m.id === conflict.id : m.versionId === conflict.versionId) && (!conflict.versionId || m.versionId === conflict.versionId))) throw new Error(`Conflict declared by ${mod.title}.`);
  }
  // Reject file collisions before writing anything, including manually imported jars.
  const filenames = new Map();
  for (const m of [...profile.mods.filter(m => !resolved.has(`${m.source}:${m.id}`)), ...resolved.values()]) {
    const name = safeFilename(m.file.name).toLowerCase();
    if (filenames.has(name)) throw new Error(`Two mods use the same filename: ${name}.`);
    filenames.set(name, true);
  }
  return [...resolved.values()];
}
async function installMods(store, catalog, profileId, source, id, notify = () => {}, fetcher = fetch) {
  const profile = store.profile(profileId);
  if(profile.loader === 'vanilla') throw new Error('Vanilla cannot load mods. Create a profile with a compatible mod loader.');
  const plan = await planInstall(catalog, profile, source, id);
  const modsDir = path.join(store.directory(profileId), 'mods');
  const stage = path.join(store.directory(profileId), `.install-${randomUUID()}`);
  await fs.mkdir(stage, { recursive: true });
  const original = structuredClone(profile.mods); const backups = [], written = [];
  try {
    for (const mod of plan) {
      notify(`Downloading: ${mod.title}`);
      const target = path.join(modsDir, safeFilename(mod.file.name));
      const owner = original.find(m => m.file.name.toLowerCase() === mod.file.name.toLowerCase());
      try { await fs.access(target); if (!owner || owner.source !== mod.source || owner.id !== mod.id) throw new Error(`The file ${mod.file.name} already exists and belongs to another mod.`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      await fs.writeFile(path.join(stage, mod.file.name), await download(mod.file, fetcher, mod.source === 'petal' ? catalog.petalUrl : '', mod.source === 'curseforge' ? catalog.getKey?.() : ''));
    }
    for (const mod of plan) {
      const old = original.find(m => m.source === mod.source && m.id === mod.id);
      if (old) {
        const name = safeFilename(old.file.name) + (old.enabled === false ? '.disabled' : '');
        const from = path.join(modsDir, name), to = path.join(stage, `backup-${backups.length}`);
        try { await fs.rename(from, to); backups.push({ from, to }); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      }
      const target = path.join(modsDir, mod.file.name);
      await fs.rename(path.join(stage, mod.file.name), target); written.push(target);
      profile.mods = profile.mods.filter(m => !(m.source === mod.source && m.id === mod.id));
      profile.mods.push({ ...mod, enabled: true, installedAt: new Date().toISOString() });
    }
    await store.save();
    return { count: plan.length };
  } catch (error) {
    for (const file of written) await fs.rm(file, { force: true });
    for (const b of backups.reverse()) await fs.rename(b.to, b.from);
    profile.mods = original;
    throw error;
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
}
function assertNotRequired(profile, mod) {
  const parent = profile.mods.find(m => m.enabled !== false && !(m.source === mod.source && m.id === mod.id) && m.dependencies?.some(d => d.source === mod.source && (d.id === mod.id || d.versionId === mod.versionId)));
  if (parent) throw new Error(`${mod.title} is required by ${parent.title}. Disable or remove that mod first.`);
}
module.exports = { download, planInstall, installMods, assertNotRequired };
