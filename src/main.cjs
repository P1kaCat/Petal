const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, Menu } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const { Auth } = require('msmc');
const { Store, safeFilename, atomicJSON } = require('./store.cjs');
const { Catalog } = require('./catalog.cjs');
const { installMods, assertNotRequired } = require('./mods.cjs');
const { launchGame, prepareGame } = require('./game.cjs');
app.commandLine.appendSwitch('lang', 'en-US');
let win, store, catalog, account, busy = false, loginBusy = false;
let secrets = {};
const running = new Map();
const page = pathToFileURL(path.join(__dirname, 'index.html')).href;
const emit = (type, payload) => { if (win && !win.isDestroyed()) win.webContents.send('petal:event', { type, ...payload }); };
const notify = message => emit('progress', { message });
function auth() {
  const id = store.data.settings.microsoftClientId;
  if (!id) throw new Error('Add your Microsoft application client ID in settings (see the setup guide).');
  return new Auth({ client_id: id, redirect: 'https://login.live.com/oauth20_desktop.srf', prompt: 'select_account' });
}
async function saveSecrets() {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable.');
  await atomicJSON(path.join(store.root, 'credentials.json'), { encrypted: safeStorage.encryptString(JSON.stringify(secrets)).toString('base64') });
}
function snapshot() {
  return { ...structuredClone(store.data), account: account?.profile ? { name: account.profile.name, id: account.profile.id } : null, curseforgeEnabled: !!secrets.curseforgeKey, root: store.root, running: [...running.keys()], busy };
}
async function exclusive(operation) {
  if (busy) throw new Error('An operation is already in progress.');
  busy = true; emit('busy', { value: true });
  try { return await operation(); }
  finally { busy = false; emit('busy', { value: false }); }
}
function editable(id) { if (running.has(id)) throw new Error('Close Minecraft before modifying this profile.'); return store.profile(id); }
const handlers = {
  state: () => snapshot(),
  versions: async () => (await catalog.mr('/tag/game_version')).filter(v => v.version_type === 'release').map(v => v.version),
  search: options => {
    const p = options.profileId ? store.profile(options.profileId) : null;
    return catalog.search({ ...options, version: p?.version, loader: p?.loader });
  },
  createProfile: options => exclusive(() => store.create(options)),
  install: ({ profileId, source, id }) => exclusive(() => { editable(profileId); return installMods(store, catalog, profileId, source, id, notify); }),
  changeMod: ({ profileId, source, id, action }) => exclusive(async () => {
    const p = editable(profileId), mod = p.mods.find(m => m.source === source && m.id === id);
    if (!mod) throw new Error('Mod not found.');
    if (!['remove', 'toggle'].includes(action)) throw new Error('Unknown action.');
    const directory = path.join(store.directory(profileId), 'mods');
    const name = safeFilename(mod.file.name);
    const old = path.join(directory, name + (mod.enabled === false ? '.disabled' : ''));
    if (action === 'remove' || mod.enabled !== false) assertNotRequired(p, mod);
    if (action === 'toggle' && mod.enabled === false) {
      for (const dep of mod.dependencies || []) if (!p.mods.some(m => m.enabled !== false && m.source === dep.source && (dep.id ? m.id === dep.id : m.versionId === dep.versionId) && (!dep.versionId || m.versionId === dep.versionId))) throw new Error('Enable this mod’s dependencies before enabling it.');
      const enabled = [...p.mods.filter(m => m.enabled !== false), mod];
      for (const m of enabled) for (const c of m.incompatible || []) if (enabled.some(other => other.source === c.source && (c.id ? other.id === c.id : other.versionId === c.versionId) && (!c.versionId || other.versionId === c.versionId))) throw new Error(`Conflict declared by ${m.title}.`);
    }
    const before = structuredClone(p.mods);
    // Keep removed jars recoverable outside the mods directory.
    const next = action === 'remove' ? path.join(store.directory(profileId), 'removed', `${Date.now()}-${name}`) : path.join(directory, name + (mod.enabled === false ? '' : '.disabled'));
    await fs.mkdir(path.dirname(next), { recursive: true });
    try { await fs.access(next); throw new Error('The destination file already exists.'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    await fs.rename(old, next);
    if (action === 'remove') p.mods = p.mods.filter(m => m !== mod); else mod.enabled = mod.enabled === false;
    try { await store.save(); } catch (e) { p.mods = before; await fs.rename(next, old); throw e; }
    return snapshot();
  }),
  importJar: ({ profileId }) => exclusive(async () => {
    const p = editable(profileId);
    const result = await dialog.showOpenDialog(win, { title: 'Import a manually downloaded mod', filters: [{ name: 'Minecraft mod', extensions: ['jar'] }], properties: ['openFile'] });
    if (result.canceled) return;
    const sourcePath = result.filePaths[0], name = safeFilename(path.basename(sourcePath));
    const dest = path.join(store.directory(profileId), 'mods', name);
    if (p.mods.some(m => m.file.name.toLowerCase() === name.toLowerCase())) throw new Error('A mod with this filename already exists.');
    const buffer = await fs.readFile(sourcePath);
    const hash = createHash('sha512').update(buffer).digest('hex');
    await fs.copyFile(sourcePath, dest, require('node:fs').constants.COPYFILE_EXCL);
    const mod = { source: 'local', id: hash, title: name.replace(/\.jar$/, ''), versionName: 'Manual import — compatibility not verified', versionId: hash, enabled: true, file: { name, hash, algorithm: 'sha512' }, dependencies: [], incompatible: [] };
    p.mods.push(mod);
    try { await store.save(); } catch (e) { p.mods.pop(); await fs.rm(dest, { force: true }); throw e; }
  }),
  saveSettings: options => exclusive(async () => {
    const memory = Number(options.memory);
    if (!Number.isInteger(memory) || memory < 1024 || memory > 32768) throw new Error('Memory must be between 1 and 32 GB.');
    const clientId = String(options.microsoftClientId || '').trim();
    if (clientId && !/^[0-9a-f-]{36}$/i.test(clientId)) throw new Error('Invalid Microsoft client ID.');
    if (options.curseforgeKey !== undefined) secrets.curseforgeKey = String(options.curseforgeKey).trim();
    if (clientId !== store.data.settings.microsoftClientId) { account = null; delete secrets.refreshToken; }
    await saveSecrets();
    store.data.settings = { memory, javaPath: String(options.javaPath || '').trim(), microsoftClientId: clientId };
    await store.save();
    return snapshot();
  }),
  chooseJava: async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose java.exe', filters: [{ name: 'Java', extensions: ['exe'] }], properties: ['openFile'] });
    return r.canceled ? null : r.filePaths[0];
  },
  login: () => exclusive(async () => {
    if (loginBusy) throw new Error('Sign-in is already in progress.');
    loginBusy = true;
    try {
      const xbox = await auth().launch('electron', { width: 520, height: 720, autoHideMenuBar: true, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
      const token = await xbox.getMinecraft();
      if (!token.profile || token.isDemo()) throw new Error('This account does not own Minecraft Java.');
      account = token; secrets.refreshToken = token.getToken(true).refresh;
      await saveSecrets();
      return snapshot();
    } catch (e) { throw new Error(`Microsoft sign-in: ${e.message || e}`); }
    finally { loginBusy = false; }
  }),
  logout: () => exclusive(async () => { account = null; delete secrets.refreshToken; await saveSecrets(); return snapshot(); }),
  prepare: ({ profileId }) => exclusive(async () => { editable(profileId); await prepareGame(store, profileId, notify); return snapshot(); }),
  launch: ({ profileId }) => exclusive(async () => {
    editable(profileId);
    if (!account && !secrets.refreshToken) throw new Error('Sign in with your Microsoft account in settings.');
    if (secrets.refreshToken) {
      notify('Checking Microsoft account…');
      const xbox = await auth().refresh(secrets.refreshToken);
      account = await xbox.getMinecraft(); secrets.refreshToken = account.getToken(true).refresh; await saveSecrets();
    }
    const child = await launchGame(store, profileId, account, notify);
    running.set(profileId, child);
    child.on('error', () => { running.delete(profileId); emit('gameExit', { profileId, code: -1 }); });
    child.on('exit', code => { running.delete(profileId); emit('gameExit', { profileId, code }); });
    // Game output can contain chat and tokens; keep it on disk under Minecraft's own logs.
    child.stdout?.resume(); child.stderr?.resume();
    return snapshot();
  }),
  openFolder: ({ profileId }) => shell.openPath(store.directory(profileId)),
  openProject: async ({ source, id }) => {
    let url;
    if (source === 'modrinth') url = `https://modrinth.com/mod/${encodeURIComponent(id)}`;
    else if (source === 'curseforge') url = (await catalog.cf(`/mods/${encodeURIComponent(id)}`)).data.links.websiteUrl;
    else throw new Error('Unknown source.');
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !['modrinth.com', 'www.curseforge.com', 'curseforge.com'].includes(parsed.hostname)) throw new Error('Invalid project link.');
    return shell.openExternal(parsed.href);
  }
};
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { win?.show(); win?.focus(); });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    const root = process.env.PETAL_DATA_DIR || path.join(app.getPath('userData'), 'data');
    await fs.mkdir(root, { recursive: true });
    store = new Store(root); await store.load();
    try {
      const file = JSON.parse(await fs.readFile(path.join(root, 'credentials.json'), 'utf8'));
      secrets = JSON.parse(safeStorage.decryptString(Buffer.from(file.encrypted, 'base64')));
    } catch (e) { if (e.code !== 'ENOENT') dialog.showErrorBox('Petal', 'Unable to decrypt saved credentials. Sign in again and enter your CurseForge key.'); }
    catalog = new Catalog(() => secrets.curseforgeKey);
    ipcMain.handle('petal:call', async (event, method, args) => {
      if (event.sender !== win.webContents || event.senderFrame.url !== page || !Object.hasOwn(handlers, method)) return { error: 'Action not allowed.' };
      try { return { data: await handlers[method](args || {}) }; }
      catch (e) {
        if (/Download|Aggregate/i.test(e.name)) return { error: 'Some game files could not be downloaded. Check your connection and try again: verified files will be kept.' };
        return { error: String(e.message || e).slice(0, 1000) };
      }
    });
    win = new BrowserWindow({ width: 1320, height: 900, minWidth: 1000, minHeight: 700, show: !process.env.PETAL_SMOKE_TEST, backgroundColor: '#11141b', title: 'Petal', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: !!process.env.PETAL_SMOKE_TEST } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    let preview;
    if (process.env.PETAL_SMOKE_TEST) win.webContents.on('paint', (_event, _dirty, image) => { if (!image.isEmpty()) preview = image; });
    await win.loadFile(path.join(__dirname, 'index.html'));
    if (process.env.PETAL_SMOKE_TEST) {
      for (let attempt = 0; attempt < 120; attempt++) {
        if (await win.webContents.executeJavaScript("!!document.querySelector('.mod-card') || !!document.querySelector('.warnings')")) break;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      const info = await win.webContents.executeJavaScript("({title: document.title, text: document.body.innerText, bridge: typeof window.petal.call})");
      await fs.writeFile(path.join(root, 'smoke.json'), JSON.stringify(info));
      if (preview) await fs.writeFile(path.join(root, 'preview.png'), preview.toPNG());
      const checks = [];
      async function until(expression) {
        for (let attempt = 0; attempt < 200; attempt++) {
          if (await win.webContents.executeJavaScript(expression)) return;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        const detail = await win.webContents.executeJavaScript('document.body.innerText');
        await atomicJSON(path.join(root, 'failure.json'), { expression, detail });
        throw new Error(`UI test timed out: ${expression}`);
      }
      if (!store.data.profiles.length) {
        await win.webContents.executeJavaScript("document.querySelector('[data-action=create]').click(); document.querySelector('#profile-name').value='Cherry adventure'; document.querySelector('#create-form').requestSubmit()");
        await until("!!document.querySelector('.profile-detail')");
      } else {
        await win.webContents.executeJavaScript("document.querySelector('[data-view=profiles]').click()");
        await until("!!document.querySelector('.profile-detail')");
      }
      checks.push({ name: 'Profile created and rendered through IPC', success: !!store.data.profiles.length });
      const testProfile = store.data.profiles[0];
      if (!testProfile.mods.length) {
        await win.webContents.executeJavaScript("document.querySelector('[data-action=browse]').click()");
        await until("!!document.querySelector('#search-input')");
        await win.webContents.executeJavaScript("document.querySelector('#search-input').value='sodium'; document.querySelector('#search-form').requestSubmit()");
        await until("!!document.querySelector('[data-action=install]')");
        await win.webContents.executeJavaScript("document.querySelector('[data-action=install]').click()");
        await until("document.querySelector('[data-action=install]')?.textContent.includes('In this profile')");
      }
      checks.push({ name: 'Real installation through the UI', success: testProfile.mods.length > 0 });
      async function captureUI(filename) {
        // Offscreen painting can lag behind DOM updates; allow the next frame to render.
        await new Promise(resolve => setTimeout(resolve, 300));
        await fs.writeFile(path.join(root, filename), (await win.webContents.capturePage()).toPNG());
      }
      await win.webContents.executeJavaScript("document.querySelector('[data-view=profiles]').click()");
      await until("!!document.querySelector('.installed-row')");
      await win.webContents.executeJavaScript("document.querySelector('#dismiss-notice').click()");
      await captureUI('profiles.png');
      await win.webContents.executeJavaScript("document.querySelector('[data-view=settings]').click()");
      await until("!!document.querySelector('#settings-form')");
      await win.webContents.executeJavaScript("document.querySelector('#memory').value='6144'; document.querySelector('#settings-form').requestSubmit()");
      await until("document.querySelector('#notice-text').textContent === 'Settings saved.'");
      checks.push({ name: 'Persistent settings and encryption available', success: store.data.settings.memory === 6144 });
      checks.push({ name: 'Unknown IPC method rejected', success: await win.webContents.executeJavaScript("window.petal.call('unknown').then(()=>false).catch(()=>true)") });
      await win.webContents.executeJavaScript("document.querySelector('#dismiss-notice').click()");
      await captureUI('settings.png');
      await win.webContents.executeJavaScript("document.querySelector('[data-view=discover]').click()");
      await until("!!document.querySelector('.mod-card') && !document.querySelector('.loading')");
      await captureUI('preview.png');
      await atomicJSON(path.join(root, 'checks.json'), checks);
      app.quit();
    }
  }).catch(error => {
    if (process.env.PETAL_SMOKE_TEST) console.error(error.stack);
    else dialog.showErrorBox('Petal — unable to start', error.message);
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
}
