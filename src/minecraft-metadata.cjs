const fs = require('node:fs/promises');
const { atomicJSON } = require('./store.cjs');
const { validVersionId } = require('./version-id.cjs');
const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const TYPES = new Set(['release', 'snapshot', 'old_beta', 'old_alpha']);
function validateManifest(versions) {
  if (!Array.isArray(versions) || !versions.length) throw new Error('Invalid Minecraft manifest.');
  const seen = new Set();
  return versions.map(v => {
    let url; try { url = new URL(v.url); } catch { throw new Error('Invalid Minecraft metadata URL.'); }
    if (!validVersionId(v.id) || !TYPES.has(v.type) || seen.has(v.id) || !Number.isFinite(Date.parse(v.releaseTime)) || url.protocol !== 'https:' || url.username || url.password || !['piston-meta.mojang.com', 'launchermeta.mojang.com'].includes(url.hostname)) throw new Error('Invalid Minecraft version manifest entry.');
    seen.add(v.id);
    return { id: v.id, type: v.type, releaseTime: v.releaseTime, url: url.href };
  });
}
class MinecraftMetadata {
  constructor({ fetcher = fetch, cacheFile, now = Date.now } = {}) { this.fetcher = fetcher; this.cacheFile = cacheFile; this.now = now; this.cached = null; this.pending = null; }
  async versions({ refresh = false } = {}) {
    if (!this.cached && this.cacheFile) {
      try {
        const disk = JSON.parse(await fs.readFile(this.cacheFile, 'utf8'));
        if (!Number.isFinite(disk.savedAt) || disk.savedAt > this.now()) throw new Error('Invalid cache timestamp.');
        this.cached = { savedAt: disk.savedAt, versions: validateManifest(disk.versions) };
      } catch { /* A cache cannot authorize unvalidated metadata. */ }
    }
    if (!refresh && this.cached && this.now() - this.cached.savedAt < 3_600_000) return { versions: structuredClone(this.cached.versions), stale: false };
    if (this.pending) return this.pending;
    this.pending = (async () => {
      try {
        const r = await this.fetcher(MANIFEST, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
        if (!r.ok) throw new Error(`Minecraft metadata unavailable (HTTP ${r.status}).`);
        const fresh = { savedAt: this.now(), versions: validateManifest((await r.json()).versions) };
        if (this.cacheFile) await atomicJSON(this.cacheFile, fresh);
        this.cached = fresh;
        return { versions: structuredClone(fresh.versions), stale: false };
      } catch (error) {
        if (this.cached) return { versions: structuredClone(this.cached.versions), stale: true };
        throw error;
      }
    })();
    try { return await this.pending; } finally { this.pending = null; }
  }
  async loaders(version, options = {}) {
    if (!(await this.versions()).versions.some(v => v.id === version)) throw new Error('Minecraft version is missing from the official manifest.');
    const { getLoader } = require('./loaders/index.cjs');
    const settled = await Promise.allSettled(['vanilla','fabric','forge','neoforge','quilt'].map(id => getLoader(id, { fetcher: this.fetcher }).list(version, options)));
    const choices = settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
    return choices;
  }
  async assertSelection({ version, loader, loaderVersion }) {
    if (!(await this.versions()).versions.some(v => v.id === version)) throw new Error('Minecraft version is missing from the official manifest.');
    if (!['vanilla','fabric','forge','neoforge','quilt'].includes(loader)) throw new Error('Unknown mod loader.');
    if (loader === 'vanilla') { if(loaderVersion && loaderVersion !== version) throw new Error('Invalid Vanilla version.'); return; }
    const { getLoader } = require('./loaders/index.cjs');
    const choices = await getLoader(loader, { fetcher: this.fetcher }).list(version, { includePrerelease: true });
    if (!choices.length || (loaderVersion && !choices.some(v => v.version === loaderVersion))) throw new Error('This loader version is incompatible with Minecraft.');
  }
}
module.exports = { MinecraftMetadata, validVersionId, validateManifest };
