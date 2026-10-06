const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let csrf,currentCollection=null;const cursors={};
async function call(route,{method='GET',body}={}){const response=await fetch('/v1'+route,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(csrf?{'X-Petal-CSRF':csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw Error(data.error||'Please try again.');return data;}
async function perform(action){try{await action();$('library-status').textContent='Saved.';}catch(error){$('library-status').textContent=error.message;}}
function link(item){return `<a href="/projects/${esc(item.projectId)}">${esc(item.title)}</a>`;}
async function list(kind,more=false){
  const route=kind==='items'?`/me/collections/${currentCollection}`:`/me/${kind}`,params=new URLSearchParams({limit:'20'});if(more&&cursors[kind])params.set('cursor',cursors[kind]);
  const data=await call(route+'?'+params);cursors[kind]=data.nextCursor;$(`${kind}-next`).hidden=!data.nextCursor;
  const target=$(kind==='items'?'collection-items':kind);
  const html=data.items.map(item=>kind==='collections'?`<article><button class="secondary" data-open="${esc(item.id)}">${esc(item.name)}</button><p class="hint">Private to your account</p></article>`:kind==='notifications'?`<article>${link(item)}<p>${item.versionId?'A release was approved.':'Project details were approved.'} · ${esc(item.createdAt.slice(0,10))}</p>${item.readAt?'<span class="badge">Read</span>':`<button class="secondary" data-read="${esc(item.id)}">Mark read</button>`}</article>`:kind==='follows'?`<article>${link(item)} <button class="secondary" data-unfollow="${esc(item.projectId)}">Unfollow</button></article>`:`<article>${link(item)} <button class="secondary" data-remove="${esc(item.projectId)}">Remove from collection</button></article>`).join('');
  if(more)target.insertAdjacentHTML('beforeend',html);else target.innerHTML=html||'<p>Nothing here yet.</p>';
  if(kind==='items'){$('delete-collection').disabled=data.items.length>0||more;$('delete-collection').title='Remove projects first to delete this collection.';}
}
for(const kind of ['notifications','follows','collections','items'])$(`${kind}-next`).addEventListener('click',()=>perform(()=>list(kind,true)));
$('preferences').addEventListener('submit',e=>{e.preventDefault();perform(()=>call('/me/notifications/preferences',{method:'POST',body:{releaseUpdates:e.target.elements.releaseUpdates.checked}}));});
$('new-collection').addEventListener('submit',e=>{e.preventDefault();perform(async()=>{await call('/me/collections',{method:'POST',body:{name:new FormData(e.target).get('name')}});e.target.reset();await list('collections');});});
$('add-item').addEventListener('submit',e=>{e.preventDefault();perform(async()=>{await call(`/me/collections/${currentCollection}/items/${new FormData(e.target).get('projectId')}`,{method:'POST'});e.target.reset();await list('items');});});
$('delete-collection').addEventListener('click',()=>perform(async()=>{await call(`/me/collections/${currentCollection}`,{method:'DELETE'});$('collection-detail').hidden=true;currentCollection=null;await list('collections');}));
document.addEventListener('click',e=>{const button=e.target.closest('button');if(!button)return;const d=button.dataset;
  if(d.open)perform(async()=>{currentCollection=d.open;const collection=await call('/me/collections/'+d.open);$('collection-title').textContent=collection.name;$('collection-detail').hidden=false;await list('items');});
  if(d.read)perform(async()=>{await call(`/me/notifications/${d.read}/read`,{method:'POST'});await list('notifications');});
  if(d.unfollow)perform(async()=>{await call(`/projects/${d.unfollow}/follow`,{method:'DELETE'});await list('follows');});
  if(d.remove)perform(async()=>{await call(`/me/collections/${currentCollection}/items/${d.remove}`,{method:'DELETE'});await list('items');});
});
(async()=>{try{const me=await call('/me');if(!me.user)throw Error('Sign in on the account page to open your library.');csrf=me.csrf;$('library-content').hidden=false;const preferences=await call('/me/notifications/preferences');$('preferences').elements.releaseUpdates.checked=preferences.releaseUpdates;for(const kind of ['notifications','follows','collections'])await list(kind);$('library-status').textContent='Your collections and notification history are private.';}catch(error){$('library-status').textContent=error.message;}})();
