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
    $('#login-form').reset(); saveSession({...data,admin:data.user.roles?.some(r=>['admin','moderator'].includes(r))}); await loadMine(); if(session.admin) await loadReviews(); notice(register ? 'Account created. Create your first project.' : 'Signed in.');
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
  const {invitations}=await call('/me/invitations');
  $('#invitations').innerHTML=invitations.map(i=>`<article><p>${esc(i.title)} · ${esc(i.role)}</p><button data-accept="${esc(i.projectId)}">Accept invitation</button></article>`).join('')||'<p>No pending invitations.</p>';
  $('#project-select').innerHTML = projects.filter(p=>p.teamRole!=='contributor').map(p => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join('');
  const details = await Promise.all(projects.map(async p => ({ p, versions: (await call('/projects/' + p.id + '/versions')).versions,revisions:(await call('/projects/'+p.id+'/revisions')).revisions,members:(await call('/projects/'+p.id+'/members')).members })));
  $('#my-projects').innerHTML = details.map(({ p, versions,revisions,members }) => `<article><h3>${esc(p.title)}</h3><p>Project ID: ${esc(p.id)} · License: ${esc(p.license)} · ${esc(p.teamRole)}</p>${versions.map(v => `<p><strong>${esc(v.name)}</strong><span class="badge">${esc(v.status)}</span>${v.reviewNote ? `<br>${esc(v.reviewNote)}` : ''}${p.teamRole!=='contributor'&&['pending','published'].includes(v.status)?` <button class="secondary" data-withdraw="${esc(v.id)}">Withdraw release</button>`:''}</p>`).join('') || '<p>No releases yet.</p>'}${p.teamRole!=='contributor'?`<details><summary>Edit project · submit for review</summary><form data-edit="${esc(p.id)}"><label>Title<input name="title" value="${esc(p.title)}" required maxlength="120"></label><label>Description<textarea name="description" required maxlength="4000">${esc(p.description)}</textarea></label><label>Mod license<input name="license" value="${esc(p.license)}" required maxlength="500"></label><label>Source website<input name="sourceUrl" value="${esc(p.sourceUrl)}" type="url"></label><label>New icon (optional, 5 MB)<input name="icon" type="file" accept="image/png,image/jpeg,image/webp"></label><label>Replace gallery (optional, up to ten images)<input name="gallery" type="file" multiple accept="image/png,image/jpeg,image/webp"></label><button>Submit revision</button><p class="hint">Approved content stays public until this revision is approved. Images are re-encoded; descriptions are plain text.</p></form></details>`:''}<details><summary>Revision history</summary>${revisions.map(r=>`<p>${esc(r.content.title)} · ${esc(r.status)}${r.decisions.map(d=>`<br>${esc(d.reason)}`).join('')}${r.status==='pending'&&p.teamRole!=='contributor'?` <button data-withdraw-revision="${esc(r.id)}" data-project="${esc(p.id)}" class="secondary">Withdraw revision</button>`:''}</p>`).join('')||'<p>No project revisions yet.</p>'}</details><details><summary>Project team</summary>${members.map(m=>`<p>${esc(m.username)} · ${esc(m.role)} · ${esc(m.status)}${p.teamRole==='owner'?` <button data-remove-member="${esc(m.id)}" data-project="${esc(p.id)}" class="secondary">Remove member</button>`:''}</p>`).join('')||'<p>No team members yet.</p>'}${p.teamRole==='owner'?`<form data-invite="${esc(p.id)}"><label>Username<input name="username" required maxlength="40"></label><label>Role<select name="role"><option value="contributor">Contributor</option><option value="maintainer">Maintainer</option></select></label><button>Invite member</button></form>${members.some(m=>m.status==='accepted')?`<form data-transfer="${esc(p.id)}"><label>New owner<select name="userId">${members.filter(m=>m.status==='accepted').map(m=>`<option value="${esc(m.id)}">${esc(m.username)}</option>`).join('')}</select></label><label class="check"><input type="checkbox" required>I understand that ownership and team management will pass to this member.</label><button class="danger">Transfer ownership</button></form>`:''}`:''}</details></article>`).join('') || '<p>Create a project to get started.</p>';
}
$('#invitations').addEventListener('click',e=>{const b=e.target.closest('[data-accept]');if(b)perform(b.closest('article'),async()=>{await call('/projects/'+b.dataset.accept+'/members/accept',{method:'POST'});await loadMine();notice('Invitation accepted.');});});
$('#my-projects').addEventListener('submit',e=>{
  const form=e.target.closest('form');if(!form)return;e.preventDefault();perform(form,async()=>{
    const fields=new FormData(form);let path,body;
    if(form.dataset.edit){
      path='/projects/'+form.dataset.edit+'/revisions';body={title:fields.get('title'),description:fields.get('description'),license:fields.get('license'),sourceUrl:fields.get('sourceUrl')};
      const upload=async file=>{if(file.size>5*1048576)throw Error('Image exceeds 5 MB.');return (await call('/projects/'+form.dataset.edit+'/images',{method:'POST',headers:{'Content-Type':file.type},body:file})).id;};
      const icon=fields.get('icon');if(icon?.size)body.iconId=await upload(icon);
      const gallery=fields.getAll('gallery').filter(f=>f.size);if(gallery.length>10)throw Error('Use at most ten gallery images.');if(gallery.length){body.gallery=[];for(const f of gallery)body.gallery.push(await upload(f));}
    }else if(form.dataset.invite){path='/projects/'+form.dataset.invite+'/members';body={username:fields.get('username'),role:fields.get('role')};}
    else if(form.dataset.transfer){path='/projects/'+form.dataset.transfer+'/transfer';body={userId:fields.get('userId')};}
    await call(path,{method:'POST',body:JSON.stringify(body)});await loadMine();notice(form.dataset.edit?'Revision submitted for review.':'Team updated.');
  });
});
$('#my-projects').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;let path,method='POST',body;
  if(b.dataset.withdraw)path='/versions/'+b.dataset.withdraw+'/withdraw';
  if(b.dataset.withdrawRevision)path='/projects/'+b.dataset.project+'/revisions/'+b.dataset.withdrawRevision+'/withdraw';
  if(b.dataset.removeMember){path='/projects/'+b.dataset.project+'/members';method='DELETE';body=JSON.stringify({userId:b.dataset.removeMember});}
  if(path)perform(b.closest('article'),async()=>{await call(path,{method,body});await loadMine();notice('Project updated.');});
});
async function downloadReview(id, filename) {
  const response = await fetch('/v1/versions/' + id + '/download', { headers: session.token ? { Authorization: 'Bearer ' + session.token } : {} });
  if (!response.ok) throw new Error('Unable to download the review file.');
  const url = URL.createObjectURL(await response.blob()); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function loadReviews() {
  const { versions } = await call('/admin/reviews?status=' + $('#review-status').value);
  $('#reviews').innerHTML = versions.map(v => `<article><h3>${esc(v.project.title)} · ${esc(v.name)}<span class="badge">${esc(v.status)}</span></h3><p>By ${esc(v.project.author)} · License: ${esc(v.project.license)}<br>Minecraft ${esc(v.gameVersions.join(', '))} · ${esc(v.loaders.join(', '))}<br>Distribution rights confirmed: ${v.rightsConfirmed ? 'Yes' : 'No'}</p><p>${esc(v.project.description)}</p>${v.project.sourceUrl ? `<p><a href="${esc(v.project.sourceUrl)}" target="_blank" rel="noreferrer">Source / author website ↗</a></p>` : ''}<p>File: ${esc(v.file.name)} · ${(v.file.size / 1048576).toFixed(2)} MB</p><label>Review note / rejection reason<textarea data-note="${esc(v.id)}" maxlength="2000">${esc(v.reviewNote)}</textarea></label><div class="actions"><button data-download="${esc(v.id)}" data-filename="${esc(v.file.name)}" class="secondary">Download for inspection</button><button data-review="approve" data-id="${esc(v.id)}">Approve & publish</button><button data-review="reject" data-id="${esc(v.id)}" class="danger">Reject / unpublish</button></div></article>`).join('') || '<p>No releases in this queue.</p>';
  const revisions=await call('/admin/revisions');$('#revision-reviews').innerHTML=revisions.revisions.map(r=>`<article><h3>${esc(r.projectTitle)} → ${esc(r.content.title)}</h3><p>${esc(r.content.description)}</p><p>License: ${esc(r.content.license)}</p>${[r.content.iconId,...r.content.gallery].filter(Boolean).map(id=>`<img src="/media/${esc(id)}" alt="Revision image" width="120">`).join('')}<label>Review reason<textarea data-reason="${esc(r.id)}" required maxlength="2000"></textarea></label><button data-revision="${esc(r.id)}" data-action="approve">Approve revision</button> <button data-revision="${esc(r.id)}" data-action="reject" class="danger">Reject revision</button></article>`).join('')||'<p>No pending project revisions.</p>';
  const reports=await call('/admin/reports');$('#report-reviews').innerHTML=reports.reports.map(r=>`<article><h3>Report for ${esc(r.projectId)}</h3><p>${esc(r.reason)}</p><label>Resolution<textarea data-resolution="${esc(r.id)}" required maxlength="2000"></textarea></label><button data-report="${esc(r.id)}">Resolve report</button></article>`).join('')||'<p>No open reports.</p>';
}
$('#revision-reviews').addEventListener('click',e=>{const b=e.target.closest('[data-revision]');if(b)perform(b.closest('article'),async()=>{const reason=document.querySelector(`[data-reason="${b.dataset.revision}"]`).value;await call('/admin/revisions/'+b.dataset.revision+'/review',{method:'POST',body:JSON.stringify({action:b.dataset.action,reason})});await loadReviews();notice('Revision reviewed.');});});
$('#report-reviews').addEventListener('click',e=>{const b=e.target.closest('[data-report]');if(b)perform(b.closest('article'),async()=>{const resolution=document.querySelector(`[data-resolution="${b.dataset.report}"]`).value;await call('/admin/reports/'+b.dataset.report,{method:'POST',body:JSON.stringify({resolution})});await loadReviews();notice('Report resolved.');});});
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
  try { if (session) { if (!session.token) await loadMine(); if (session.admin) await loadReviews(); } } catch { saveSession(null); notice('Your session has expired. Sign in again.', true); }
  try { await search(); } catch (error) { notice(error.message, true); }
})();
fetch('/v1/game/versions').then(r=>r.json()).then(data=>{ document.querySelector('#game-versions').innerHTML=(data.versions||[]).map(v=>'<option value=' + JSON.stringify(v.id).replaceAll('<','&lt;') + '></option>').join(''); }).catch(()=>{});
