const path = require('node:path');
const { Store, atomicJSON } = require('../src/store.cjs');
const { Catalog } = require('../src/catalog.cjs');
const { installMods } = require('../src/mods.cjs');
const { prepareGame } = require('../src/game.cjs');
const { generateArguments } = require('@xmcl/core');
(async () => {
  const store = new Store(path.resolve(__dirname, '../artifacts/integration'));
  await store.load();
  const catalog = new Catalog(() => process.env.CURSEFORGE_API_KEY);
  const report = [];
  for (const loader of ['fabric', 'forge', 'neoforge']) {
    const profile = store.data.profiles.find(p => p.loader === loader) || await store.create({ name: `Vérification ${loader}`, version: '1.21.1', loader });
    try {
      if (loader === 'fabric') await installMods(store, catalog, profile.id, 'modrinth', 'iris', console.log);
      const result = await prepareGame(store, profile.id, console.log);
      const args = await generateArguments({ gamePath: result.directory, resourcePath: result.resources, javaPath: result.javaPath, version: result.version, gameProfile: { name: 'Test', id: '00000000000000000000000000000000' }, accessToken: 'test-only', userType: 'msa', features: { petal_session: { clientid: 'test-client', auth_xuid: '0' } }, maxMemory: 4096 });
      if (!args.includes('--gameDir') || !args.includes(result.directory) || !args.includes('--accessToken') || args.some(a => /\$\{/.test(a))) throw new Error('Arguments de lancement incomplets.');
      report.push({ loader, success: true, runtime: result.version, java: result.javaPath, mods: profile.mods.map(m => m.title) });
      console.log('OK', loader, result.version);
    } catch (e) { report.push({ loader, success: false, error: e.message.slice(0, 600) }); console.error('FAILED', loader, e.message.slice(0, 600)); }
    await atomicJSON(path.join(store.root, 'report.json'), report);
  }
  if (report.some(r => !r.success)) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
