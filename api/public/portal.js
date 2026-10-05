const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let session = null;
sessionStorage.removeItem('petal-author-session');
function notice(message, error = false) { $('#notice').hidden = false; $('#notice').textContent = message; $('#notice').classList.toggle('error', error); }
async function call(route, options = {}) {
  const response = await fetch('/v1' + route, { ...options, headers: { ...(options.body && !(options.body instanceof File) ? { 'Content-Type': 'application/json' } : {}), ...(session?.token ? { Authorization: 'Bearer ' + session.token } : {}), ...(session?.csrf ? { 'X-Petal-CSRF': session.csrf } : {}), ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
async function perform(form, action) {
  const buttons = form.querySelectorAll('button'); buttons.forEach(b => { b.disabled = true; });
  try { await action(); } catch (error) { notice(error.message, true); }
  finally { buttons.forEach(b => { b.disabled = false; }); }
}
function saveSession(value) {
  session = value;
  sessionStorage.removeItem('petal-author-session');
  $('#auth').hidden = !!session; $('#account-actions').hidden = !session;
  $('#author').hidden = !session || !!session.token; $('#admin').hidden = !session?.admin;
  $('#session-label').textContent = session ? (session.admin ? 'Administrator' : session.user.username) : 'Not signed in';
}
async function authenticate(register = false) {
  await perform($('#login-form'), async () => {
    if (!$('#login-form').reportValidity()) return;
    const fields = new FormData($('#login-form'));
    const data = await call(register ? '/auth/register' : '/auth/login', { method: 'POST', body: JSON.stringify({ username: fields.get('username'), password: fields.get('password'), email: fields.get('email') || undefined, code: fields.get('code'), sessionType: 'cookie' }) });
    $('#login-form').reset(); saveSession({...data,admin:data.user.roles?.some(r=>['admin','moderator'].includes(r))}); if(session.admin) await loadReviews(); else await loadMine(); notice(register ? 'Account created. Create your first project.' : 'Signed in.');
  });
}
$('#login-form').addEventListener('submit', e => { e.preventDefault(); authenticate(); });
$('#register').addEventListener('click', () => authenticate(true));
$('#admin-form').addEventListener('submit', async e => {
  e.preventDefault(); const token = new FormData(e.target).get('token');
  await perform(e.target, async () => { saveSession({ token, admin: true }); try { await loadReviews(); $('#admin-form').reset(); notice('Review desk ready.'); } catch (error) { saveSession(null); throw error; } });
});
$('#logout').addEventListener('click', async () => { if (session && !session.token) { try { await call('/auth/logout', { method: 'POST' }); } catch {} } saveSession(null); notice('Signed out.'); });
$('#project-form').addEventListener('submit', e => {
  e.preventDefault(); perform(e.target, async () => {
    const fields = Object.fromEntries(new FormData(e.target));
    await call('/projects', { method: 'POST', body: JSON.stringify(fields) }); e.target.reset(); await loadMine(); notice('Project created. Submit a release for review.');
  });
});
$('#version-form').addEventListener('submit', e => {
  e.preventDefault(); perform(e.target, async () => {
    const fields = new FormData(e.target), file = fields.get('file');
    if (file.size > 64 * 1024 * 1024) throw new Error('File exceeds the 64 MB upload limit.');
    const version = await call('/projects/' + fields.get('projectId') + '/versions', { method: 'POST', body: JSON.stringify({ name: fields.get('name'), gameVersions: fields.get('gameVersions').split(',').map(v => v.trim()).filter(Boolean), loaders: [fields.get('loader')], filename: file.name, rightsConfirmed: fields.has('rights'), dependencies: fields.get('dependencies').split(',').map(id => id.trim()).filter(Boolean).map(id => ({ id })) }) });
    notice('Uploading and checking the archive…');
    await call('/versions/' + version.id + '/file', { method: 'PUT', headers: { 'Content-Type': 'application/java-archive' }, body: file });
    e.target.reset(); await loadMine(); notice('Release submitted. It stays private until an administrator approves it.');
  });
});
async function loadMine() {
  const { projects } = await call('/me/projects');
  $('#project-select').innerHTML = projects.map(p => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join('');
  const details = await Promise.all(projects.map(async p => ({ p, versions: (await call('/projects/' + p.id + '/versions')).versions })));
  $('#my-projects').innerHTML = details.map(({ p, versions }) => `<article><h3>${esc(p.title)}</h3><p>Project ID: ${esc(p.id)} · License: ${esc(p.license)}</p>${versions.map(v => `<p><strong>${esc(v.name)}</strong><span class="badge">${esc(v.status)}</span>${v.reviewNote ? `<br>${esc(v.reviewNote)}` : ''}</p>`).join('') || '<p>No releases yet.</p>'}</article>`).join('') || '<p>Create a project to get started.</p>';
}
async function downloadReview(id, filename) {
  const response = await fetch('/v1/versions/' + id + '/download', { headers: session.token ? { Authorization: 'Bearer ' + session.token } : {} });
  if (!response.ok) throw new Error('Unable to download the review file.');
  const url = URL.createObjectURL(await response.blob()); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function loadReviews() {
  const { versions } = await call('/admin/reviews?status=' + $('#review-status').value);
  $('#reviews').innerHTML = versions.map(v => `<article><h3>${esc(v.project.title)} · ${esc(v.name)}<span class="badge">${esc(v.status)}</span></h3><p>By ${esc(v.project.author)} · License: ${esc(v.project.license)}<br>Minecraft ${esc(v.gameVersions.join(', '))} · ${esc(v.loaders.join(', '))}<br>Distribution rights confirmed: ${v.rightsConfirmed ? 'Yes' : 'No'}</p><p>${esc(v.project.description)}</p>${v.project.sourceUrl ? `<p><a href="${esc(v.project.sourceUrl)}" target="_blank" rel="noreferrer">Source / author website ↗</a></p>` : ''}<p>File: ${esc(v.file.name)} · ${(v.file.size / 1048576).toFixed(2)} MB</p><label>Review note / rejection reason<textarea data-note="${esc(v.id)}" maxlength="2000">${esc(v.reviewNote)}</textarea></label><div class="actions"><button data-download="${esc(v.id)}" data-filename="${esc(v.file.name)}" class="secondary">Download for inspection</button><button data-review="approve" data-id="${esc(v.id)}">Approve & publish</button><button data-review="reject" data-id="${esc(v.id)}" class="danger">Reject / unpublish</button></div></article>`).join('') || '<p>No releases in this queue.</p>';
}
$('#reviews').addEventListener('click', e => {
  const button = e.target.closest('button'); if (!button) return;
  perform(button.closest('article'), async () => {
    if (button.dataset.download) return downloadReview(button.dataset.download, button.dataset.filename);
    if (button.dataset.review) {
      const note = document.querySelector(`[data-note="${button.dataset.id}"]`).value;
      await call('/admin/versions/' + button.dataset.id + '/review', { method: 'POST', body: JSON.stringify({ action: button.dataset.review, note }) });
      await loadReviews(); await search(); notice('Review saved.');
    }
  });
});
$('#refresh-reviews').addEventListener('click', () => perform($('#admin'), loadReviews));
$('#review-status').addEventListener('change', () => perform($('#admin'), loadReviews));
async function search() {
  const q = new FormData($('#search-form')).get('q');
  const { projects, hasMore } = await call('/search?q=' + encodeURIComponent(q));
  $('#catalog').innerHTML = projects.map(p => `<article><h3><a href="/projects/${esc(p.id)}">${esc(p.title)}</a></h3><p>By ${esc(p.author)} · ${esc(p.downloads)} downloads</p><p>${esc(p.description)}</p></article>`).join('') || '<p>No published mods yet. Approved releases will appear here.</p>';
  if (hasMore) $('#catalog').insertAdjacentHTML('beforeend', '<p>Showing the first 20 results. Refine your search to find more.</p>');
}
$('#search-form').addEventListener('submit', e => { e.preventDefault(); perform(e.target, search); });
(async () => {
  try { const capabilities=await call('/auth/capabilities'); $('#admin-form').hidden=!capabilities.localOperator; } catch { $('#admin-form').hidden=true; }
  try { const me=await call('/me'); session={...me,admin:me.user.roles.some(r=>['admin','moderator'].includes(r))}; } catch {}
  saveSession(session);
  try { if (session) { if (session.admin) await loadReviews(); else await loadMine(); } } catch { saveSession(null); notice('Your session has expired. Sign in again.', true); }
  try { await search(); } catch (error) { notice(error.message, true); }
})();
fetch('/v1/game/versions').then(r=>r.json()).then(data=>{ document.querySelector('#game-versions').innerHTML=(data.versions||[]).map(v=>'<option value=' + JSON.stringify(v.id).replaceAll('<','&lt;') + '></option>').join(''); }).catch(()=>{});
