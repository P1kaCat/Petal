const api = window.petal;
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const numbers = new Intl.NumberFormat('fr', { notation: 'compact', maximumFractionDigits: 1 });
let state = { profiles: [], settings: {}, running: [] }, view = 'discover', selected = localStorage.getItem('petal-profile'), source = 'all', query = '', offset = 0, searchGeneration = 0, busy = false, searchPending = false;
let results = { mods: [], warnings: [], totals: {}, hasMore: false };
const profile = () => state.profiles.find(p => p.id === selected);
function notice(text, error = false) { $('#notice-text').textContent = text; $('#notice').hidden = false; $('#notice').classList.toggle('error', error); }
async function refresh() {
  state = await api.call('state');
  if (!profile()) selected = state.profiles[0]?.id;
  localStorage.setItem('petal-profile', selected || '');
  $('#profile-count').textContent = state.profiles.length;
  $('#account-name').textContent = state.account?.name || 'Connecter Microsoft';
  $('#cf-status').textContent = state.curseforgeEnabled ? 'CURSEFORGE · configuré' : 'CURSEFORGE · clé requise';
  $('#sidebar-profiles').innerHTML = state.profiles.length ? state.profiles.map(p => `<button class="side-profile ${p.id === selected ? 'active' : ''}" data-profile="${esc(p.id)}"><span class="mini-cube">▧</span><span><strong>${esc(p.name)}</strong><small>${esc(p.version)} · ${esc(p.loader)}</small></span></button>`).join('') : '<div class="side-empty">Ton prochain monde commence par un profil.</div>';
  document.querySelectorAll('.nav').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('#breadcrumb').textContent = { discover: 'Découvrir', profiles: 'Mes profils', settings: 'Réglages' }[view];
}
function empty(title, description, action = '') { return `<div class="empty"><div class="empty-symbol">✿</div><h2>${title}</h2><p>${description}</p>${action}</div>`; }
function render() {
  if (view === 'discover') renderDiscover();
  if (view === 'profiles') renderProfiles();
  if (view === 'settings') renderSettings();
  syncBusy();
}
function renderDiscover() {
  $('#content').innerHTML = `<div class="title-row"><div><h1>Un monde de possibilités.</h1><p>Tous tes mods préférés, au même endroit.</p></div><button class="outline" data-action="create">＋ Nouveau profil</button></div>
    <section class="hero"><div class="hero-copy"><span class="eyebrow">MOINS DE LIMITES. PLUS D’AVENTURES.</span><h2>Compose ton Minecraft.</h2><p>Explore Modrinth et CurseForge. Trouve les mods qui rendent ton aventure unique.</p><div class="source-pills"><span class="source-pill mr">● Modrinth</span><span class="subtle">＋</span><span class="source-pill cf">◈ CurseForge</span></div></div></section>
    <form id="search-form" class="toolbar"><div class="search"><span>⌕</span><input id="search-input" type="search" value="${esc(query)}" placeholder="Chercher un mod, une nouvelle aventure…" aria-label="Rechercher des mods"></div><select id="filter-profile" aria-label="Filtrer par profil"><option value="">Toutes les versions</option>${state.profiles.map(p => `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)} · ${esc(p.version)}</option>`).join('')}</select><button class="outline" type="submit">Rechercher</button></form>
    <div class="tabs" role="tablist" aria-label="Catalogue"><button class="tab ${source === 'all' ? 'active' : ''}" role="tab" aria-selected="${source === 'all'}" data-source="all">Tous les mods</button><button class="tab ${source === 'modrinth' ? 'active' : ''}" role="tab" aria-selected="${source === 'modrinth'}" data-source="modrinth">Modrinth</button><button class="tab ${source === 'curseforge' ? 'active' : ''}" role="tab" aria-selected="${source === 'curseforge'}" data-source="curseforge">CurseForge</button></div><div id="search-results"></div>`;
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
  if (searchPending && !offset) { container.innerHTML = '<div class="loading">Exploration des catalogues…</div>'; return; }
  const count = Object.values(results.totals).reduce((a, b) => a + b, 0);
  container.innerHTML = `${results.warnings.length ? `<div class="warnings">${results.warnings.map(esc).join('<br>')}</div>` : ''}<div class="results-header"><strong>${query ? 'Résultats de recherche' : 'À découvrir'}</strong><span>${numbers.format(count)} résultats ${profile() ? `· ${esc(profile().version)} / ${esc(profile().loader)}` : '· toutes les versions'}</span></div>
    ${results.mods.length ? `<div class="mod-grid">${results.mods.map(m => {
      const installed = profile()?.mods.some(mod => mod.source === m.source && mod.id === m.id);
      return `<article class="mod-card"><div class="mod-top">${icon(m)}<div><div class="mod-name">${esc(m.title)}</div><div class="author">par ${esc(m.author)}</div></div></div><p class="mod-desc">${esc(m.description)}</p><div class="mod-meta"><span>↓ ${numbers.format(m.downloads)}</span><span class="badge ${esc(m.source)}">${m.source === 'modrinth' ? 'Modrinth' : 'CurseForge'}</span></div><div class="card-actions"><button class="install-button" data-action="install" data-id="${esc(m.id)}" data-provider="${esc(m.source)}" ${installed ? 'disabled' : ''}>${installed ? '✓ Dans ce profil' : '＋ Installer'}</button><button class="icon-button" data-action="project" data-id="${esc(m.id)}" data-provider="${esc(m.source)}" aria-label="Ouvrir la page de ${esc(m.title)}">↗</button></div></article>`;
    }).join('')}</div>` : empty('Aucun mod à afficher.', 'Essaie une autre recherche ou vérifie les messages des catalogues ci-dessus.')}
    ${results.hasMore ? `<button class="outline load-more" data-action="more" ${searchPending ? 'disabled' : ''}>${searchPending ? 'Chargement…' : 'Afficher plus de mods'}</button>` : ''}`;
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
  $('#content').innerHTML = `<div class="title-row"><div><h1>Mes univers.</h1><p>Chaque aventure a son propre espace.</p></div><button class="primary" data-action="create">Nouveau profil ＋</button></div>
    ${state.profiles.length ? `<div class="profile-grid">${state.profiles.map(p => `<button class="profile-card ${p.id === selected ? 'selected' : ''}" data-profile="${esc(p.id)}"><span class="mini-cube">▧</span>${p.id === selected ? '<span class="tag">PROFIL ACTIF</span>' : ''}<h2>${esc(p.name)}</h2><p>Minecraft ${esc(p.version)} · ${esc(p.loader)} · ${p.mods.length} mods</p></button>`).join('')}</div>` : empty('Ton premier monde t’attend.', 'Crée un profil pour choisir ta version Minecraft, installer tes mods et lancer le jeu.', '<button class="primary" data-action="create">Créer mon premier profil</button>')}
    ${p ? `<section class="profile-detail"><div class="detail-heading"><div><h2>${esc(p.name)}</h2><p>${esc(p.version)} · ${esc(p.loader)} ${p.loaderVersion ? esc(p.loaderVersion) : ''}</p></div><div class="detail-actions"><button class="outline" data-action="folder">Dossier ↗</button><button class="outline" data-action="prepare" data-mutation>Installer le jeu</button><button class="primary" data-action="launch" data-mutation ${state.running.includes(p.id) ? 'disabled' : ''}>${state.running.includes(p.id) ? 'Minecraft en cours' : '▶ Jouer'}</button></div></div>
    <div class="results-header"><strong>Mods installés <span class="subtle">${p.mods.length}</span></strong><div><button class="outline" data-action="import" data-mutation>Importer un .jar</button> <button class="outline" data-action="browse">＋ Ajouter des mods</button></div></div>
    ${p.mods.length ? p.mods.map(m => `<div class="installed-row ${m.enabled === false ? 'disabled' : ''}"><span class="mini-cube">▧</span><div class="installed-info"><strong>${esc(m.title)}</strong><small>${esc(m.versionName)}${m.enabled === false ? ' · désactivé' : ''}</small></div><span class="badge ${esc(m.source)}">${esc(m.source)}</span>${m.source !== 'local' ? `<button class="icon-button" data-action="update" data-provider="${esc(m.source)}" data-id="${esc(m.id)}" data-mutation title="Vérifier et installer la dernière version compatible">↻</button>` : ''}<button class="outline" data-action="toggle" data-provider="${esc(m.source)}" data-id="${esc(m.id)}" data-mutation>${m.enabled === false ? 'Activer' : 'Désactiver'}</button><button class="icon-button danger" data-action="remove" data-provider="${esc(m.source)}" data-id="${esc(m.id)}" data-mutation aria-label="Retirer ${esc(m.title)}">×</button></div>`).join('') : empty('Un profil plein de potentiel.', 'Ajoute des mods depuis les catalogues. Leurs dépendances requises seront installées avec eux.')}</section>` : ''}`;
}
function renderSettings() {
  const s = state.settings;
  $('#content').innerHTML = `<div class="title-row"><div><h1>À ta façon.</h1><p>Les connexions et réglages de ton launcher.</p></div></div><form id="settings-form"><div class="settings-grid">
    <section class="panel"><span class="eyebrow">TON IDENTITÉ</span><h2>Compte Microsoft</h2><p>${state.account ? `Connecté avec ${esc(state.account.name)}.` : 'Connecte le compte qui possède Minecraft Java pour jouer.'}</p><label>Identifiant d’application Microsoft<input id="client-id" value="${esc(s.microsoftClientId)}" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"></label><small>Application personnelle Microsoft avec le retour OAuth https://login.live.com/oauth20_desktop.srf. Le README explique la configuration. Enregistre avant de te connecter.</small><div class="settings-actions"><button type="button" class="primary" data-action="login">Se connecter</button>${state.account ? '<button type="button" class="outline" data-action="logout">Déconnexion</button>' : ''}</div></section>
    <section class="panel"><span class="eyebrow">DEUX CATALOGUES</span><h2>CurseForge</h2><p>${state.curseforgeEnabled ? 'Une clé API est enregistrée. Le catalogue est activé.' : 'Ajoute une clé API CurseForge pour réunir les deux catalogues.'}</p><label>Clé API<input id="cf-key" type="password" autocomplete="off" placeholder="${state.curseforgeEnabled ? 'Clé enregistrée — laisser vide pour conserver' : 'Ta clé CurseForge'}"></label><small>La clé reste chiffrée sur cet ordinateur. Les téléchargements indisponibles via l’API peuvent être importés manuellement au format .jar.</small><label><input id="clear-key" type="checkbox"> Retirer la clé enregistrée</label></section>
    <section class="panel"><span class="eyebrow">PERFORMANCES</span><h2>Mémoire vive</h2><p>La mémoire maximale allouée à Minecraft.</p><label>Allocation<select id="memory">${[1024, 2048, 4096, 6144, 8192, 12288, 16384, 24576, 32768].map(n => `<option value="${n}" ${n === s.memory ? 'selected' : ''}>${n / 1024} Go</option>`).join('')}</select></label><small>4 Go constituent un point de départ. Ajuste selon tes mods et la mémoire disponible sur ton ordinateur.</small></section>
    <section class="panel"><span class="eyebrow">ENVIRONNEMENT</span><h2>Java</h2><p>Petal installe automatiquement le Java demandé par Minecraft.</p><label>Exécutable personnalisé (facultatif)<input id="java-path" value="${esc(s.javaPath)}" placeholder="Automatique"></label><div class="settings-actions"><button type="button" class="outline" data-action="java">Choisir java.exe…</button></div><small>Données des profils : ${esc(state.root)}</small></section></div><div class="settings-actions"><button class="primary" type="submit" data-mutation>Enregistrer les réglages</button></div></form>`;
  $('#settings-form').addEventListener('submit', async e => {
    e.preventDefault();
    const options = { memory: Number($('#memory').value), javaPath: $('#java-path').value, microsoftClientId: $('#client-id').value };
    if ($('#clear-key').checked) options.curseforgeKey = ''; else if ($('#cf-key').value.trim()) options.curseforgeKey = $('#cf-key').value;
    await perform(() => api.call('saveSettings', options), 'Réglages enregistrés.');
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
  try { await operation(); await refresh(); render(); if (message) notice(message); $('#status-text').textContent = 'Prêt.'; }
  catch (e) { notice(e.message, true); $('#status-text').textContent = 'L’opération a échoué.'; }
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
  if (action === 'login' || action === 'logout') return perform(() => api.call(action), action === 'login' ? 'Compte connecté.' : 'Compte déconnecté.');
  if (action === 'install' && !profile()) { notice('Crée ou sélectionne un profil pour installer ce mod.'); return createDialog(); }
  if (!profile()) return;
  const args = { profileId: selected, source: b.dataset.provider, id: b.dataset.id };
  if (action === 'install' || action === 'update') return perform(() => api.call('install', args), 'Mod et dépendances requis installés.');
  if (action === 'toggle' || action === 'remove') return perform(() => api.call('changeMod', { ...args, action }), action === 'remove' ? 'Mod retiré. Le fichier reste récupérable dans le dossier removed du profil.' : 'État du mod modifié.');
  if (action === 'folder') return perform(() => api.call('openFolder', args));
  if (action === 'import') return perform(() => api.call('importJar', args), 'Import terminé. Vérifie la compatibilité du fichier et ses dépendances.');
  if (action === 'prepare') return perform(() => api.call('prepare', args), 'Minecraft et son chargeur sont installés.');
  if (action === 'launch') return perform(() => api.call('launch', args), 'Minecraft démarre.');
});
$('#sidebar-create').addEventListener('click', createDialog);
$('#account-button').addEventListener('click', () => changeView('settings'));
$('#dismiss-notice').addEventListener('click', () => { $('#notice').hidden = true; });
$('#close-dialog').addEventListener('click', () => $('#create-dialog').close());
$('#create-form').addEventListener('submit', async e => {
  e.preventDefault(); const submit = $('#create-form button[type="submit"]'); submit.disabled = true;
  try { const p = await api.call('createProfile', { name: $('#profile-name').value, version: $('#profile-version').value, loader: $('#profile-loader').value }); selected = p.id; $('#create-dialog').close(); await changeView('profiles'); notice('Profil créé. Ajoute des mods ou installe le jeu.'); }
  catch (e) { $('#dialog-error').textContent = e.message; }
  finally { submit.disabled = false; }
});
api.onEvent(async event => {
  if (event.type === 'progress') $('#status-text').textContent = event.message;
  if (event.type === 'gameExit') { await refresh(); render(); notice(event.code ? `Minecraft s’est arrêté avec le code ${event.code}. Consulte le dossier logs du profil.` : 'Minecraft est fermé.', !!event.code); }
});
(async () => {
  try { await refresh(); render(); search(); const versions = await api.call('versions'); $('#minecraft-versions').innerHTML = versions.map(v => `<option value="${esc(v)}"></option>`).join(''); }
  catch (e) { notice(e.message, true); }
})();
