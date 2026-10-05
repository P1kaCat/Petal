const fs = require('node:fs/promises');
const path = require('node:path');
const installer = require('@xmcl/installer');
const { Version, launch } = require('@xmcl/core');
const { json } = require('./catalog.cjs');
const { retryDownload } = require('./retry.cjs');
const { Agent } = require('undici');
const { resolveAgent } = require('@xmcl/file-transfer');
const { validateManifest } = require('./minecraft-metadata.cjs');
const { getLoader } = require('./loaders/index.cjs');
// Each origin gets a bounded connection pool, including asset and range requests.
const agent = resolveAgent({ dispatcher: new Agent({ connections: 6, pipelining: 1, connect: { timeout: 30000 }, headersTimeout: 60000, bodyTimeout: 60000 }) });
async function text(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`Mod loader metadata unavailable (HTTP ${r.status}).`);
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
  const meta = validateManifest(manifest.versions).find(v => v.id === profile.version);
  if (!meta) throw new Error('This Minecraft version is missing from the official manifest.');
  const details = await json(meta.url);
  let javaPath = store.data.settings.javaPath;
  const requiredMajor = details.javaVersion?.majorVersion || 8;
  if (javaPath) {
    const java = await installer.resolveJava(javaPath);
    if (!java || java.majorVersion !== requiredMajor) throw new Error(`This profile requires Java ${requiredMajor}. Clear the Java path in settings to install it automatically.`);
  } else {
    const component = details.javaVersion?.component || 'jre-legacy';
    if (!/^[a-z0-9-]+$/.test(component)) throw new Error('Invalid Java component.');
    const destination = path.join(store.root, 'java', component);
    javaPath = path.join(destination, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    const localJava = await installer.resolveJava(javaPath).catch(() => undefined);
    if (!localJava || localJava.majorVersion !== requiredMajor) {
      notify(`Installing Java ${requiredMajor}…`);
      const manifest = await installer.fetchJavaRuntimeManifest({ target: component });
      await retryDownload(() => installer.installJavaRuntimeTask({ manifest, destination, lzma: false, agent }).startAndWait(), notify);
    }
  }
  notify(`Installing Minecraft ${profile.version}…`);
  await retryDownload(() => installer.install(meta, resources, { agent }), notify);
  let version = profile.runtimeVersion;
  if (!version) {
    notify(`Installing ${profile.loader}…`);
    const installed = await getLoader(profile.loader).install({profile,resources,javaPath,agent,notify});
    version = installed.runtimeVersion;
    profile.loaderVersion = installed.loaderVersion;
    profile.runtimeVersion = version;
    await store.save();
  }
  notify('Checking libraries and assets…');
  const resolved = await Version.parse(resources, version);
  await retryDownload(() => installer.installDependencies(resolved, { agent }), notify);
  return { version, javaPath, resources, directory: store.directory(profileId) };
}
async function launchGame(store, profileId, account, notify) {
  if (!account?.profile || account.isDemo()) throw new Error('Sign in with a Microsoft account that owns Minecraft Java.');
  const game = await prepareGame(store, profileId, notify);
  notify('Starting Minecraft…');
  return launch({ gamePath: game.directory, resourcePath: game.resources, javaPath: game.javaPath, version: game.version, gameProfile: { id: account.profile.id, name: account.profile.name }, accessToken: account.mcToken, userType: 'msa', features: { petal_session: { clientid: store.data.settings.microsoftClientId, auth_xuid: account.xuid || '0' } }, maxMemory: store.data.settings.memory, minMemory: 512, launcherName: 'Petal', launcherBrand: '0.2.0', extraExecOption: { windowsHide: true } });
}
module.exports = { prepareGame, launchGame, selectNeoForge };
