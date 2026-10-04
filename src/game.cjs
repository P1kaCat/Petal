const fs = require('node:fs/promises');
const path = require('node:path');
const installer = require('@xmcl/installer');
const { Version, launch } = require('@xmcl/core');
const { json } = require('./catalog.cjs');
const { retryDownload } = require('./retry.cjs');
const { Agent } = require('undici');
const { resolveAgent } = require('@xmcl/file-transfer');
// Each origin gets a bounded connection pool, including asset and range requests.
const agent = resolveAgent({ dispatcher: new Agent({ connections: 6, pipelining: 1, connect: { timeout: 30000 }, headersTimeout: 60000, bodyTimeout: 60000 }) });
async function text(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`Métadonnées du chargeur indisponibles (HTTP ${r.status}).`);
  return r.text();
}
function selectNeoForge(versions, minecraft) {
  const parts = minecraft.split('.').map(Number);
  const prefix = `${parts[1]}.${parts[2] || 0}.`;
  return versions.filter(v => v.startsWith(prefix) && !v.includes('beta')).sort((a, b) => Number(b.split('.')[2]) - Number(a.split('.')[2]))[0];
}
async function prepareGame(store, profileId, notify = () => {}) {
  const profile = store.profile(profileId);
  const resources = path.join(store.root, 'minecraft');
  const manifest = await installer.getVersionList();
  const meta = manifest.versions.find(v => v.id === profile.version);
  if (!meta) throw new Error('Cette version de Minecraft n’existe pas dans le manifeste officiel.');
  const details = await json(meta.url);
  let javaPath = store.data.settings.javaPath;
  const requiredMajor = details.javaVersion?.majorVersion || 8;
  if (javaPath) {
    const java = await installer.resolveJava(javaPath);
    if (!java || java.majorVersion !== requiredMajor) throw new Error(`Ce profil requiert Java ${requiredMajor}. Efface le chemin Java dans les réglages pour l’installer automatiquement.`);
  } else {
    const component = details.javaVersion?.component || 'jre-legacy';
    if (!/^[a-z0-9-]+$/.test(component)) throw new Error('Composant Java invalide.');
    const destination = path.join(store.root, 'java', component);
    javaPath = path.join(destination, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    const localJava = await installer.resolveJava(javaPath).catch(() => undefined);
    if (!localJava || localJava.majorVersion !== requiredMajor) {
      notify(`Installation de Java ${requiredMajor}…`);
      const manifest = await installer.fetchJavaRuntimeManifest({ target: component });
      await retryDownload(() => installer.installJavaRuntimeTask({ manifest, destination, lzma: false, agent }).startAndWait(), notify);
    }
  }
  notify(`Installation de Minecraft ${profile.version}…`);
  await retryDownload(() => installer.install(meta, resources, { agent }), notify);
  let version = profile.runtimeVersion;
  if (!version) {
    notify(`Installation de ${profile.loader}…`);
    if (profile.loader === 'fabric') {
      const artifacts = await installer.getLoaderArtifactListFor(profile.version);
      const artifact = artifacts.find(a => a.loader.stable) || artifacts[0];
      if (!artifact) throw new Error('Fabric ne propose pas de chargeur pour cette version.');
      version = await installer.installFabric(artifact, resources);
      profile.loaderVersion = artifact.loader.version;
    } else if (profile.loader === 'forge') {
      const promotions = await json('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
      const forge = promotions.promos[`${profile.version}-recommended`] || promotions.promos[`${profile.version}-latest`];
      if (!forge) throw new Error('Forge ne propose pas de chargeur pour cette version.');
      const artifact = `${profile.version}-${forge}`;
      const url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${artifact}/forge-${artifact}-installer.jar`;
      const sha1 = (await text(`${url}.sha1`)).trim().split(/\s/)[0];
      version = await retryDownload(() => installer.installForge({ mcversion: profile.version, version: forge, installer: { path: url, sha1 } }, resources, { java: javaPath, mavenHost: 'https://maven.minecraftforge.net/', agent }), notify);
      profile.loaderVersion = forge;
    } else {
      const xml = await text('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml');
      const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1]);
      const neo = selectNeoForge(versions, profile.version);
      if (!neo) throw new Error('NeoForge ne propose pas de version stable compatible.');
      version = await retryDownload(() => installer.installNeoForged('neoforge', neo, resources, { java: javaPath, agent }), notify);
      profile.loaderVersion = neo;
    }
    profile.runtimeVersion = version;
    await store.save();
  }
  notify('Vérification des bibliothèques et des ressources…');
  const resolved = await Version.parse(resources, version);
  await retryDownload(() => installer.installDependencies(resolved, { agent }), notify);
  return { version, javaPath, resources, directory: store.directory(profileId) };
}
async function launchGame(store, profileId, account, notify) {
  if (!account?.profile || account.isDemo()) throw new Error('Connecte un compte Microsoft possédant Minecraft Java.');
  const game = await prepareGame(store, profileId, notify);
  notify('Démarrage de Minecraft…');
  return launch({ gamePath: game.directory, resourcePath: game.resources, javaPath: game.javaPath, version: game.version, gameProfile: { id: account.profile.id, name: account.profile.name }, accessToken: account.mcToken, userType: 'msa', features: { petal_session: { clientid: store.data.settings.microsoftClientId, auth_xuid: account.xuid || '0' } }, maxMemory: store.data.settings.memory, minMemory: 512, launcherName: 'Petal', launcherBrand: '0.1.1', extraExecOption: { windowsHide: true } });
}
module.exports = { prepareGame, launchGame, selectNeoForge };
