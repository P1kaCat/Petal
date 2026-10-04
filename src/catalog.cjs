const MR = 'https://api.modrinth.com/v2';
const CF = 'https://api.curseforge.com/v1';
const loaders = { forge: 1, fabric: 4, neoforge: 6 };
async function json(url, key, fetcher = fetch) {
  const response = await fetcher(url, { headers: { 'User-Agent': 'PetalLauncher/0.1.2', Accept: 'application/json', ...(key ? { 'x-api-key': key } : {}) }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`API: HTTP ${response.status}${response.status === 403 ? ' — check your key and permissions.' : ''}`);
  return response.json();
}
class Catalog {
  constructor(getKey, fetcher = fetch) { this.getKey = getKey; this.fetcher = fetcher; }
  mr(path) { return json(`${MR}${path}`, null, this.fetcher); }
  cf(path) {
    const key = this.getKey();
    if (!key) throw new Error('Add your CurseForge API key in settings to enable this catalog.');
    return json(`${CF}${path}`, key, this.fetcher);
  }
  async search({ query = '', source = 'all', version, loader, offset = 0 }) {
    if (!['all', 'modrinth', 'curseforge'].includes(source)) throw new Error('Invalid catalog.');
    offset = Math.max(0, Math.floor(Number(offset) || 0));
    const providers = source === 'all' ? ['modrinth', 'curseforge'] : [source];
    const results = await Promise.allSettled(providers.map(async provider => {
      if (provider === 'modrinth') {
        const facets = [['project_type:mod'], ...(version ? [[`versions:${version}`]] : []), ...(loader ? [[`categories:${loader}`]] : [])];
        const data = await this.mr(`/search?${new URLSearchParams({ query: String(query).slice(0, 200), facets: JSON.stringify(facets), limit: '20', offset: String(offset), index: query ? 'relevance' : 'downloads' })}`);
        return { total: data.total_hits, mods: data.hits.map(m => ({ source: provider, id: m.project_id, title: m.title, description: m.description, author: m.author, icon: m.icon_url, downloads: m.downloads, url: `https://modrinth.com/mod/${m.slug}` })) };
      }
      const params = new URLSearchParams({ gameId: '432', classId: '6', searchFilter: String(query).slice(0, 200), pageSize: '20', index: String(offset), sortField: query ? '1' : '6', sortOrder: 'desc' });
      if (version) params.set('gameVersion', version);
      if (loader) params.set('modLoaderType', String(loaders[loader]));
      const data = await this.cf(`/mods/search?${params}`);
      return { total: data.pagination.totalCount, mods: data.data.map(m => ({ source: provider, id: String(m.id), title: m.name, description: m.summary, author: m.authors.map(a => a.name).join(', '), icon: m.logo?.thumbnailUrl, downloads: m.downloadCount, url: m.links.websiteUrl })) };
    }));
    const mods = [], warnings = [], totals = {};
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') { mods.push(...r.value.mods); totals[providers[i]] = r.value.total; }
      else warnings.push(`${providers[i]} : ${r.reason.message}`);
    });
    // Preserve each provider's ranking while interleaving sources.
    if (source === 'all') {
      const a = mods.filter(m => m.source === 'modrinth'), b = mods.filter(m => m.source === 'curseforge');
      mods.length = 0;
      for (let i = 0; i < Math.max(a.length, b.length); i++) { if (a[i]) mods.push(a[i]); if (b[i]) mods.push(b[i]); }
    }
    return { mods, warnings, totals, hasMore: Object.values(totals).some(t => t > offset + 20) };
  }
  async resolve(source, id, profile, versionId) {
    if (source === 'modrinth') {
      const versions = versionId ? [await this.mr(`/version/${encodeURIComponent(versionId)}`)] : await this.mr(`/project/${encodeURIComponent(id)}/version?${new URLSearchParams({ game_versions: JSON.stringify([profile.version]), loaders: JSON.stringify([profile.loader]) })}`);
      const v = versions.find(v => v.game_versions.includes(profile.version) && v.loaders.includes(profile.loader));
      if (!v) throw new Error(`No compatible version of ${id} for ${profile.version} / ${profile.loader}.`);
      const project = await this.mr(`/project/${encodeURIComponent(v.project_id)}`);
      const f = v.files.find(f => f.primary) || v.files[0];
      if (!f) throw new Error('This version contains no files.');
      return { source, id: v.project_id, title: project.title, versionId: v.id, versionName: v.version_number, file: { name: f.filename, url: f.url, hash: f.hashes.sha512 || f.hashes.sha1, algorithm: f.hashes.sha512 ? 'sha512' : 'sha1' }, dependencies: v.dependencies.filter(d => d.dependency_type === 'required').map(d => ({ source, id: d.project_id, versionId: d.version_id })), incompatible: v.dependencies.filter(d => d.dependency_type === 'incompatible').map(d => ({ source, id: d.project_id, versionId: d.version_id })) };
    }
    if (source !== 'curseforge') throw new Error('Unknown source.');
    const project = (await this.cf(`/mods/${encodeURIComponent(id)}`)).data;
    const params = new URLSearchParams({ gameVersion: profile.version, modLoaderType: String(loaders[profile.loader]), pageSize: '50' });
    const files = versionId ? [(await this.cf(`/mods/${id}/files/${versionId}`)).data] : (await this.cf(`/mods/${id}/files?${params}`)).data;
    const label = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge' }[profile.loader];
    const f = files.filter(f => f.gameVersions.includes(profile.version) && f.gameVersions.includes(label) && f.isAvailable).sort((a, b) => Date.parse(b.fileDate) - Date.parse(a.fileDate))[0];
    if (!f) throw new Error(`No compatible file for ${project.name}.`);
    if (!f.downloadUrl) throw new Error(`${project.name} does not provide an API download. Open its project page to download the file manually.`);
    const hash = f.hashes.find(h => h.algo === 1);
    if (!hash) throw new Error('Missing SHA-1 checksum: installation refused.');
    return { source, id: String(project.id), title: project.name, versionId: String(f.id), versionName: f.displayName, file: { name: f.fileName, url: f.downloadUrl, hash: hash.value, algorithm: 'sha1' }, dependencies: f.dependencies.filter(d => d.relationType === 3).map(d => ({ source, id: String(d.modId) })), incompatible: f.dependencies.filter(d => d.relationType === 5).map(d => ({ source, id: String(d.modId) })) };
  }
}
module.exports = { Catalog, json };
