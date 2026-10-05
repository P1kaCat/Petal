const api = window.petal;
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const numbers = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
let state = { profiles: [], settings: {}, running: [] }, view = 'discover', selected = localStorage.getItem('petal-profile'), source = 'all', query = '', offset = 0, searchGeneration = 0, busy = false, searchPending = false;
let results = { mods: [], warnings: [], totals: {}, hasMore: false };
const profile = () => state.profiles.find(p => p.id === selected);
function notice(text, error = false) { $('#notice-text').textContent = text; $('#notice').hidden = false; $('#notice').classList.toggle('error', error); }
async function refresh() {
  state = await api.call('state');
  if (!profile()) selected = state.profiles[0]?.id;
  localStorage.setItem('petal-profile', selected || '');
  $('#profile-count').textContent = state.profiles.length;
  $('#account-name').textContent = state.account?.name || 'Connect Microsoft';
  $('#cf-status').textContent = state.curseforgeEnabled ? 'CURSEFORGE · configured' : 'CURSEFORGE · key required';
  $('#sidebar-profiles').innerHTML = state.profiles.length ? state.profiles.map(p => `<button class="side-profile ${p.id === selected ? 'active' : ''}" data-profile="${esc(p.id)}"><span class="mini-cube">▧</span><span><strong>${esc(p.name)}</strong><small>${esc(p.version)} · ${esc(p.loader)}</small></span></button>`).join('') : '<div class="side-empty">Your next world starts with a profile.</div>';
  document.querySelectorAll('.nav').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('#breadcrumb').textContent = { discover: 'Discover', profiles: 'My profiles', settings: 'Settings' }[view];
}
function empty(title, description, action = '') { return `<div class="empty"><div class="empty-symbol">✿</div><h2>${title}</h2><p>${description}</p>${action}</div>`; }
function render() {
  if (view === 'discover') renderDiscover();
  if (view === 'profiles') renderProfiles();
  if (view === 'settings') renderSettings();
  syncBusy();
}
function renderDiscover() {
  $('#content').innerHTML = `<div class="title-row"><div><h1>A world of possibilities.</h1><p>All your favorite mods, in one place.</p></div><button class="outline" data-action="create">＋ New profile</button></div>
    <section class="hero"><div class="hero-copy"><span class="eyebrow">FEWER LIMITS. MORE ADVENTURES.</span><h2>Make Minecraft yours.</h2><p>Explore Modrinth, CurseForge, and Petal. Find the mods that make your adventure unique.</p><div class="source-pills"><span class="source-pill mr">● Modrinth</span><span class="subtle">＋</span><span class="source-pill cf">◈ CurseForge</span><span class="source-pill petal">✿ Petal</span></div></div></section>
    <form id="search-form" class="toolbar"><div class="search"><span>⌕</span><input id="search-input" type="search" value="${esc(query)}" placeholder="Search for a mod, a new adventure…" aria-label="Search for mods"></div><select id="filter-profile" aria-label="Filter by profile"><option value="">All versions</option>${state.profiles.map(p => `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)} · ${esc(p.version)}</option>`).join('')}</select><button class="outline" type="submit">Search</button></form>
    <div class="tabs" role="tablist" aria-label="Catalog"><button class="tab ${source === 'all' ? 'active' : ''}" role="tab" aria-selected="${source === 'all'}" data-source="all">All mods</button><button class="tab ${source === 'modrinth' ? 'active' : ''}" role="tab" aria-selected="${source === 'modrinth'}" data-source="modrinth">Modrinth</button><button class="tab ${source === 'curseforge' ? 'active' : ''}" role="tab" aria-selected="${source === 'curseforge'}" data-source="curseforge">CurseForge</button><button class="tab ${source === 'petal' ? 'active' : ''}" role="tab" aria-selected="${source === 'petal'}" data-source="petal">Petal</button></div><div id="search-results"></div>`;
  $('#search-form').addEventListener('submit', e => { e.preventDefault(); query = $('#search-input').value; search(); });
  $('#filter-profile').addEventListener('change', e => { selected = e.target.value; localStorage.setItem('petal-profile', selected); search(); });
  renderResults();
}
function icon(mod) {
  try { const url = new URL(mod.icon); if (url.protocol === 'https:' && ['cdn.modrinth.com', 'media.forgecdn.net', 'mediafilez.forgecdn.net', 'edge.forgecdn.net'].includes(url.hostname)) return `<img class="mod-icon" src="${esc(url.href)}" alt="" loading="lazy">`; } catch {}
  return `<span class="mod-icon icon-fallback">${esc(mod.title.slice(0, 1))}</span>`;
}
function renderResults() {
  const container = $('#search-results'); if (!container) return;
  if (searchPending && !offset) { container.innerHTML = '<div class="loading">Exploring the catalogs…</div>'; return; }
  const count = Object.values(results.totals).reduce((a, b) => a + b, 0);
  container.innerHTML = `${results.warnings.length ? `<div class="warnings">${results.warnings.map(esc).join('<br>')}</div>` : ''}<div class="results-header"><strong>${query ? 'Search results' : 'Discover'}</strong><span>${numbers.format(count)} results ${profile() ? `· ${esc(profile().version)} / ${esc(profile().loader)}` : '· all versions'}</span></div>
    ${results.mods.length ? `<div class="mod-grid">${results.mods.map(m => {
      const installed = profile()?.mods.some(mod => mod.source === m.source && mod.id === m.id);
      return `<article class="mod-card"><div class="mod-top">${icon(m)}<div><div class="mod-name">${esc(m.title)}</div><div class="author">by ${esc(m.author)}</div></div></div><p class="mod-desc">${esc(m.description)}</p><div class="mod-meta"><span>↓ ${numbers.format(m.downloads)}</span><span class="badge ${esc(m.source)}">${({ modrinth: 'Modrinth', curseforge: 'CurseForge', petal: 'Petal' })[m.source]}</span></div><div class="card-actions"><button class="install-button" data-action="install" data-id="${esc(m.id)}" data-provider="${esc(m.source)}" ${installed ? 'disabled' : ''}>${installed ? '✓ In this profile' : '＋ Install'}</button><button class="icon-button" data-action="project" data-id="${esc(m.id)}" data-provider="${esc(m.source)}" aria-label="Open the project page for ${esc(m.title)}">↗</button></div></article>`;
    }).join('')}</div>` : empty('No mods to display.', 'Try another search or check the catalog messages above.')}
    ${results.hasMore ? `<button class="outline load-more" data-action="more" ${searchPending ? 'disabled' : ''}>${searchPending ? 'Loading…' : 'Show more mods'}</button>` : ''}`;
  syncBusy();
}
async function search(more = false) {
  const generation = ++searchGeneration;
  searchPending = true; offset = more ? offset + 20 : 0;
  if (!more) results = { mods: [], warnings: [], totals: {}, hasMore: false };
  renderResults();
  try {
    const r = await api.call('search', { query, source, offset, profileId: selected || undefined });
    if (generation !== searchGeneration) return;
    const previous = more ? results.mods : [];
    const seen = new Set(previous.map(m => `${m.source}:${m.id}`));
    results = { ...r, mods: [...previous, ...r.mods.filter(m => !seen.has(`${m.source}:${m.id}`))] };
  } catch (e) { if (generation === searchGeneration) { results.warnings = [e.message]; if (more) offset -= 20; } }
  finally { if (generation === searchGeneration) { searchPending = false; renderResults(); } }
}
function renderProfiles() {
  const p = profile();
  $('#content').innerHTML = `<div class="title-row"><div><h1>My worlds.</h1><p>Every adventure has its own space.</p></div><button class="primary" data-action="create">New profile ＋</button></div>
    ${state.profiles.length ? `<div class="profile-grid">${state.profiles.map(p => `<button class="profile-card ${p.id === selected ? 'selected' : ''}" data-profile="${esc(p.id)}"><span class="mini-cube">▧</span>${p.id === selected ? '<span class="tag">ACTIVE PROFILE</span>' : ''}<h2>${esc(p.name)}</h2><p>Minecraft ${esc(p.version)} · ${esc(p.loader)} · ${p.mods.length} ${p.mods.length === 1 ? 'mod' : 'mods'}</p></button>`).join('')}</div>` : empty('Your first world awaits.', 'Create a profile to choose your Minecraft version, install mods, and launch the game.', '<button class="primary" data-action="create">Create my first profile</button>')}
    ${p ? `<section class="profile-detail"><div class="detail-heading"><div><h2>${esc(p.name)}</h2><p>${esc(p.version)} · ${esc(p.loader)} ${p.loaderVersion ? esc(p.loaderVersion) : ''}</p></div><div class="detail-actions"><button class="outline" data-action="folder">Folder ↗</button><button class="outline" data-action="prepare" data-mutation>Install game</button><button class="primary" data-action="launch" data-mutation ${state.running.includes(p.id) ? 'disabled' : ''}>${state.running.includes(p.id) ? 'Minecraft running' : '▶ Play'}</button></div></div>
    <div class="results-header"><strong>Installed mods <span class="subtle">${p.mods.length}</span></strong><div><button class="outline" data-action="import" data-mutation>Import a .jar</button> <button class="outline" data-action="browse">＋ Add mods</button></div></div>
    ${p.mods.length ? p.mods.map(m => `<div class="installed-row ${m.enabled === false ? 'disabled' : ''}"><span class="mini-cube">▧</span><div class="installed-info"><strong>${esc(m.title)}</strong><small>${esc(m.source === 'local' ? 'Manual import — compatibility not verified' : m.versionName)}${m.enabled === false ? ' · disabled' : ''}</small></div><span class="badge ${esc(m.source)}">${esc(m.source)}</span>${m.source !== 'local' ? `<button class="icon-button" data-action="update" data-provider="${esc(m.source)}" data-id="${esc(m.id)}" data-mutation title="Check for and install the latest compatible version">↻</button>` : ''}<button class="outline" data-action="toggle" data-provider="${esc(m.source)}" data-id="${esc(m.id)}" data-mutation>${m.enabled === false ? 'Enable' : 'Disable'}</button><button class="icon-button danger" data-action="remove" data-provider="${esc(m.source)}" data-id="${esc(m.id)}" data-mutation aria-label="Remove ${esc(m.title)}">×</button></div>`).join('') : empty('A profile full of possibilities.', 'Add mods from the catalogs. Required dependencies will be installed with them.')}</section>` : ''}`;
}
function renderSettings() {
  const s = state.settings;
  $('#content').innerHTML = `<div class="title-row"><div><h1>Your way.</h1><p>Connections and preferences for your launcher.</p></div></div><form id="settings-form"><div class="settings-grid">
    <section class="panel"><span class="eyebrow">YOUR IDENTITY</span><h2>Microsoft account</h2><p>${state.account ? `Signed in as ${esc(state.account.name)}.` : 'Sign in with the account that owns Minecraft Java to play.'}</p><label>Microsoft application client ID<input id="client-id" value="${esc(s.microsoftClientId)}" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"></label><small>Use your own authorized Microsoft app with the OAuth redirect https://login.live.com/oauth20_desktop.srf. See the setup guide. Save before signing in.</small><div class="settings-actions"><button type="button" class="primary" data-action="login">Sign in</button>${state.account ? '<button type="button" class="outline" data-action="logout">Sign out</button>' : ''}</div></section>
    <section class="panel"><span class="eyebrow">TWO CATALOGS</span><h2>CurseForge</h2><p>${state.curseforgeEnabled ? 'An API key is saved. The catalog is enabled.' : 'Add a CurseForge API key to bring both catalogs together.'}</p><label>API key<input id="cf-key" type="password" autocomplete="off" placeholder="${state.curseforgeEnabled ? 'Key saved — leave blank to keep it' : 'Your CurseForge key'}"></label><small>The key stays encrypted on this computer. Files unavailable through the API can be imported manually as .jar files.</small><label><input id="clear-key" type="checkbox"> Remove the saved key</label></section>
    <section class="panel"><span class="eyebrow">OUR MOD HOSTING</span><h2>Petal API</h2><p>${state.petalEnabled ? 'The Petal catalog is connected.' : 'Connect your Petal server to discover approved community mods.'}</p><label>API server URL<input id="petal-api-url" type="url" value="${esc(s.petalApiUrl)}" placeholder="http://127.0.0.1:4318"></label><small>Use HTTPS for a deployed server. Local HTTP is allowed on localhost. Leave blank to disable. Author uploads and reviews happen in the server’s creator portal.</small></section><section class="panel"><span class="eyebrow">PERFORMANCE</span><h2>Memory</h2><p>The maximum memory allocated to Minecraft.</p><label>Allocation<select id="memory">${[1024, 2048, 4096, 6144, 8192, 12288, 16384, 24576, 32768].map(n => `<option value="${n}" ${n === s.memory ? 'selected' : ''}>${n / 1024} GB</option>`).join('')}</select></label><small>4 GB is a starting point. Adjust for your mods and the memory available on your computer.</small></section>
    <section class="panel"><span class="eyebrow">ENVIRONMENT</span><h2>Java</h2><p>Petal automatically installs the Java runtime required by Minecraft.</p><label>Custom executable (optional)<input id="java-path" value="${esc(s.javaPath)}" placeholder="Automatic"></label><div class="settings-actions"><button type="button" class="outline" data-action="java">Choose java.exe…</button></div><small>Profile data: ${esc(state.root)}</small></section></div><div class="settings-actions"><button class="primary" type="submit" data-mutation>Save settings</button></div></form>`;
  $('#settings-form').addEventListener('submit', async e => {
    e.preventDefault();
    const options = { memory: Number($('#memory').value), javaPath: $('#java-path').value, microsoftClientId: $('#client-id').value, petalApiUrl: $('#petal-api-url').value };
    if ($('#clear-key').checked) options.curseforgeKey = ''; else if ($('#cf-key').value.trim()) options.curseforgeKey = $('#cf-key').value;
    await perform(() => api.call('saveSettings', options), 'Settings saved.');
  });
}
function syncBusy() {
  document.querySelectorAll('[data-mutation], [data-action="install"]').forEach(b => {
    const p = profile(); const installed = b.dataset.action === 'install' && p?.mods.some(m => m.source === b.dataset.provider && m.id === b.dataset.id);
    b.disabled = busy || !!installed || (view === 'profiles' && !!p && state.running.includes(p.id));
  });
}
async function perform(operation, message) {
  if (busy) return;
  busy = true; syncBusy();
  try { await operation(); await refresh(); render(); if (message) notice(message); $('#status-text').textContent = 'Ready.'; }
  catch (e) { notice(e.message, true); $('#status-text').textContent = 'The operation failed.'; }
  finally { busy = false; syncBusy(); }
}
async function changeView(next) { view = next; await refresh(); render(); if (view === 'discover') search(); }
function createDialog() { $('#dialog-error').textContent = ''; $('#create-dialog').showModal(); $('#profile-name').focus(); }
document.addEventListener('click', async event => {
  const b = event.target.closest('button'); if (!b) return;
  if (b.dataset.view) return changeView(b.dataset.view);
  if (b.dataset.profile) { selected = b.dataset.profile; localStorage.setItem('petal-profile', selected); await refresh(); render(); if (view === 'discover') search(); return; }
  if (b.dataset.source) { source = b.dataset.source; query = $('#search-input').value; renderDiscover(); return search(); }
  const action = b.dataset.action;
  if (action === 'create') return createDialog();
  if (action === 'more') return search(true);
  if (action === 'browse') return changeView('discover');
  if (action === 'project') { try { await api.call('openProject', { source: b.dataset.provider, id: b.dataset.id }); } catch (e) { notice(e.message, true); } return; }
  if (action === 'java') { const chosen = await api.call('chooseJava'); if (chosen) $('#java-path').value = chosen; return; }
  if (action === 'login' || action === 'logout') return perform(() => api.call(action), action === 'login' ? 'Account connected.' : 'Account disconnected.');
  if (action === 'install' && !profile()) { notice('Create or select a profile to install this mod.'); return createDialog(); }
  if (!profile()) return;
  const args = { profileId: selected, source: b.dataset.provider, id: b.dataset.id };
  if (action === 'install' || action === 'update') return perform(() => api.call('install', args), 'Mod and required dependencies installed.');
  if (action === 'toggle' || action === 'remove') return perform(() => api.call('changeMod', { ...args, action }), action === 'remove' ? 'Mod removed. Its file can be recovered from the profile’s removed folder.' : 'Mod state changed.');
  if (action === 'folder') return perform(() => api.call('openFolder', args));
  if (action === 'import') return perform(() => api.call('importJar', args), 'Import complete. Check the file’s compatibility and dependencies.');
  if (action === 'prepare') return perform(() => api.call('prepare', args), 'Minecraft and its mod loader are installed.');
  if (action === 'launch') return perform(() => api.call('launch', args), 'Minecraft is starting.');
});
$('#sidebar-create').addEventListener('click', createDialog);
$('#account-button').addEventListener('click', () => changeView('settings'));
$('#dismiss-notice').addEventListener('click', () => { $('#notice').hidden = true; });
$('#close-dialog').addEventListener('click', () => $('#create-dialog').close());
$('#create-form').addEventListener('submit', async e => {
  e.preventDefault(); const submit = $('#create-form button[type="submit"]'); submit.disabled = true;
  try { const p = await api.call('createProfile', { name: $('#profile-name').value, version: $('#profile-version').value, loader: $('#profile-loader').value }); selected = p.id; $('#create-dialog').close(); await changeView('profiles'); notice('Profile created. Add mods or install the game.'); }
  catch (e) { $('#dialog-error').textContent = e.message; }
  finally { submit.disabled = false; }
});
api.onEvent(async event => {
  if (event.type === 'progress') $('#status-text').textContent = event.message;
  if (event.type === 'gameExit') { await refresh(); render(); notice(event.code ? `Minecraft exited with code ${event.code}. Check the profile’s logs folder.` : 'Minecraft has closed.', !!event.code); }
});
(async () => {
  try { await refresh(); render(); search(); const versions = await api.call('versions'); $('#minecraft-versions').innerHTML = versions.map(v => `<option value="${esc(v)}"></option>`).join(''); }
  catch (e) { notice(e.message, true); }
})();
