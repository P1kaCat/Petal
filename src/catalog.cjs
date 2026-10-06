const MR = 'https://api.modrinth.com/v2';
const CF = 'https://api.curseforge.com/v1';
const { petalOrigin, isPetalDownload } = require('./petal-url.cjs');
const loaders = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
async function json(url, key, fetcher = fetch) {
  const response = await fetcher(url, { headers: { 'User-Agent': 'PetalLauncher/0.2.0', Accept: 'application/json', ...(key ? { 'x-api-key': key } : {}) }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`API: HTTP ${response.status}${response.status === 403 ? ' — check your key and permissions.' : ''}`);
  return response.json();
}
class Catalog {
  constructor(getKey, fetcher = fetch, getPetalUrl = () => '') { this.getKey = getKey; this.fetcher = fetcher; this.getPetalUrl = getPetalUrl; }
  get petalUrl() { return petalOrigin(this.getPetalUrl()); }
  async petal(route) {
    if (!this.petalUrl) throw new Error('Add the Petal API URL in settings to enable this catalog.');
    const response = await this.fetcher(`${this.petalUrl}/v1${route}`, { redirect: 'error', headers: { Accept: 'application/json', 'User-Agent': 'PetalLauncher/0.2.0' }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Petal API: HTTP ${response.status}.`);
    return response.json();
  }
  mr(path) { return json(`${MR}${path}`, null, this.fetcher); }
  cf(path) {
    const key = this.getKey();
    if (!key) throw new Error('Add your CurseForge API key in settings to enable this catalog.');
    return json(`${CF}${path}`, key, this.fetcher);
  }
  async search({ query = '', source = 'all', version, loader, offset = 0 }) {
    if (!['all', 'modrinth', 'curseforge', 'petal'].includes(source)) throw new Error('Invalid catalog.');
    offset = Math.max(0, Math.floor(Number(offset) || 0));
    const providers = source === 'all' ? ['modrinth', 'curseforge', ...(this.petalUrl ? ['petal'] : [])] : [source];
    const results = await Promise.allSettled(providers.map(async provider => {
      if (provider === 'petal') {
        const params = new URLSearchParams({ q: String(query).slice(0, 200), offset: String(offset), limit: '20' });
        if (version) params.set('version', version); if (loader) params.set('loader', loader);
        const data = await this.petal(`/search?${params}`);
        return { total: data.total, mods: data.projects.map(p => ({ source: 'petal', id: p.id, title: p.title, description: p.description, author: p.author, downloads: p.downloads, url: `${this.petalUrl}/projects/${encodeURIComponent(p.id)}` })) };
      }
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
      const groups = providers.map(provider => mods.filter(m => m.source === provider));
      mods.length = 0;
      for (let i = 0; i < Math.max(...groups.map(g => g.length)); i++) for (const group of groups) if (group[i]) mods.push(group[i]);
    }
    return { mods, warnings, totals, hasMore: Object.values(totals).some(t => t > offset + 20) };
  }
  async resolve(source, id, profile, versionId) {
    if (source === 'petal') {
      const project = await this.petal(`/projects/${encodeURIComponent(id)}`);
      if(project.type&&project.type!=='mod')throw Error('Use the profile content installer for this project type.');
      const versions = versionId ? [await this.petal(`/versions/${encodeURIComponent(versionId)}`)] : (await this.petal(`/projects/${encodeURIComponent(id)}/versions?version=${encodeURIComponent(profile.version)}&loader=${encodeURIComponent(profile.loader)}&limit=100`)).versions;
      const v = versions.find(v => v.projectId === id && v.status === 'published' && v.gameVersions.includes(profile.version) && v.loaders.includes(profile.loader));
      if (!v) throw new Error(`No published compatible Petal version for ${project.title}.`);
      if (!v.file || v.file.algorithm !== 'sha512' || !/^[a-f0-9]{128}$/i.test(v.file.hash) || !isPetalDownload(new URL(v.file.url), this.petalUrl) || new URL(v.file.url).pathname !== `/v1/versions/${v.id}/download`) throw new Error('Invalid Petal download metadata.');
      return { source: 'petal', id: project.id, title: project.title, versionId: v.id, versionName: v.name, file: v.file, dependencies: v.dependencies.map(d => ({ ...d, source: 'petal' })), incompatible: [] };
    }
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
    const label = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt' }[profile.loader];
    const f = files.filter(f => f.gameVersions.includes(profile.version) && f.gameVersions.includes(label) && f.isAvailable).sort((a, b) => Date.parse(b.fileDate) - Date.parse(a.fileDate))[0];
    if (!f) throw new Error(`No compatible file for ${project.name}.`);
    if (!f.downloadUrl) throw new Error(`${project.name} does not provide an API download. Open its project page to download the file manually.`);
    const hash = f.hashes.find(h => h.algo === 1);
    if (!hash) throw new Error('Missing SHA-1 checksum: installation refused.');
    return { source, id: String(project.id), title: project.name, versionId: String(f.id), versionName: f.displayName, file: { name: f.fileName, url: f.downloadUrl, hash: hash.value, algorithm: 'sha1' }, dependencies: f.dependencies.filter(d => d.relationType === 3).map(d => ({ source, id: String(d.modId) })), incompatible: f.dependencies.filter(d => d.relationType === 5).map(d => ({ source, id: String(d.modId) })) };
  }
  async resolveContent(source,id,profile,versionId,type='mod'){
    if(type==='mod')return this.resolve(source,id,profile,versionId);
    if(!['resourcepack','shader','datapack','modpack'].includes(type))throw Error('Unknown content type.');
    if(type==='modpack'&&source!=='petal')throw Error('Use a Petal formatVersion=1 modpack. Native mrpack/CurseForge pack imports are not supported yet.');
    let project,version,file;
    if(source==='petal'){
      project=await this.petal(`/projects/${encodeURIComponent(id)}`);if(project.type!==type)throw Error('Project content type mismatch.');
      const versions=versionId?[await this.petal(`/versions/${encodeURIComponent(versionId)}`)]:(await this.petal(`/projects/${encodeURIComponent(id)}/versions?version=${encodeURIComponent(profile.version)}&limit=100`)).versions;
      version=versions.find(v=>v.projectId===id&&v.status==='published'&&v.type===type&&v.gameVersions.includes(profile.version));
      if(!version?.file||version.file.algorithm!=='sha512'||!/^[a-f0-9]{128}$/i.test(version.file.hash)||!isPetalDownload(new URL(version.file.url),this.petalUrl)||new URL(version.file.url).pathname!==`/v1/versions/${version.id}/download`)throw Error('No compatible authorized Petal pack download.');file=version.file;
    }else if(source==='modrinth'){
      project=await this.mr(`/project/${encodeURIComponent(id)}`);
      const versions=versionId?[await this.mr(`/version/${encodeURIComponent(versionId)}`)]:await this.mr(`/project/${encodeURIComponent(id)}/version?${new URLSearchParams({game_versions:JSON.stringify([profile.version])})}`);
      version=versions.find(v=>v.project_id===project.id&&v.game_versions.includes(profile.version)&&v.loaders.includes(type==='datapack'?'datapack':type==='resourcepack'?'minecraft':'iris'));
      if(type!=='datapack'&&project.project_type!==type||!version)throw Error('No compatible provider pack version.');
      const f=version.files.find(f=>f.primary)||version.files[0];if(!f)throw Error('No provider file.');file={name:f.filename,url:f.url,hash:f.hashes.sha512||f.hashes.sha1,algorithm:f.hashes.sha512?'sha512':'sha1'};
    }else if(source==='curseforge'){
      project=(await this.cf(`/mods/${encodeURIComponent(id)}`)).data;
      const classes=(await this.cf('/categories?gameId=432&classesOnly=true')).data;
      const pattern={resourcepack:/resource.?packs|texture.?packs/i,shader:/shader/i,datapack:/data.?packs/i}[type];
      if(!classes.some(c=>c.id===project.classId&&pattern.test(c.name)))throw Error('Provider project type mismatch.');
      const versions=versionId?[(await this.cf(`/mods/${encodeURIComponent(id)}/files/${encodeURIComponent(versionId)}`)).data]:(await this.cf(`/mods/${encodeURIComponent(id)}/files?${new URLSearchParams({gameVersion:profile.version,pageSize:'50'})}`)).data;
      version=versions.find(v=>v.modId===project.id&&v.isAvailable&&v.gameVersions.includes(profile.version));
      if(!version?.downloadUrl)throw Error('The author has not authorized this API download. Download manually from the project page.');
      const hash=version.hashes.find(h=>h.algo===1);if(!hash)throw Error('Provider checksum is required.');file={name:version.fileName,url:version.downloadUrl,hash:hash.value,algorithm:'sha1'};
    }else throw Error('Unknown content source.');
    return {source,id:String(project.id),title:project.title||project.name,versionId:String(version.id),type,file,dependencies:[],incompatible:[]};
  }
}
module.exports = { Catalog, json };
