const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const LOADERS = ['fabric', 'forge', 'neoforge'];
function safeFilename(name) {
  if (typeof name !== 'string' || !name.endsWith('.jar') || name.length > 200 || /[\\/:*?"<>|\x00-\x1f]/.test(name) || name.startsWith('.') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(name)) throw new Error('Nom de fichier de mod invalide.');
  return name;
}
async function atomicJSON(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temporary, JSON.stringify(data, null, 2)); await fs.rename(temporary, file); }
  finally { await fs.rm(temporary, { force: true }); }
}
class Store {
  constructor(root) { this.root = root; this.data = { profiles: [], settings: { memory: 4096, javaPath: '', microsoftClientId: '' } }; }
  async load() {
    try { this.data = JSON.parse(await fs.readFile(path.join(this.root, 'state.json'), 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw new Error('Le fichier de profils est illisible. Conserve-le avant toute réparation.'); }
  }
  save() { return atomicJSON(path.join(this.root, 'state.json'), this.data); }
  profile(id) { const p = this.data.profiles.find(p => p.id === id); if (!p) throw new Error('Profil introuvable.'); return p; }
  directory(id) { this.profile(id); if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Identifiant invalide.'); return path.join(this.root, 'instances', id); }
  async create({ name, version, loader }) {
    name = String(name || '').trim();
    if (!name || name.length > 60 || !/^\d+\.\d+(\.\d+)?$/.test(version) || !LOADERS.includes(loader)) throw new Error('Nom, version Minecraft ou chargeur invalide.');
    const p = { id: randomUUID(), name, version, loader, mods: [], createdAt: new Date().toISOString() };
    this.data.profiles.push(p);
    try {
      await fs.mkdir(path.join(this.directory(p.id), 'mods'), { recursive: true });
      await this.save();
    } catch (e) { this.data.profiles = this.data.profiles.filter(existing => existing.id !== p.id); throw e; }
    return p;
  }
}
module.exports = { Store, safeFilename, atomicJSON };
