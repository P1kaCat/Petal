const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup,jar,admin}=require('./helpers/api.cjs');
async function published(s,token,p,fields={}){const v=await s.version(token,p,fields);await s.request(`/v1/versions/${v.id}/file`,{method:'PUT',token,body:jar(),binary:true});return v;}
test('follows are idempotent and notifications appear only after approval with preferences',async t=>{
  const s=await setup(t),author=await s.author('communityauthor'),follower=await s.author('follower'),p=await s.project(author),first=await published(s,author,p);
  await s.request(`/v1/admin/versions/${first.id}/review`,{method:'POST',token:admin,body:{action:'approve'}});
  for(let i=0;i<2;i++)assert.equal((await s.request(`/v1/projects/${p.id}/follow`,{method:'POST',token:follower})).status,200);
  assert.equal((await s.request('/v1/me/follows',{token:follower})).data.items.length,1);
  const second=await published(s,author,p,{name:'2.0'});assert.equal((await s.request('/v1/me/notifications',{token:follower})).data.items.length,0);
  await s.request(`/v1/admin/versions/${second.id}/review`,{method:'POST',token:admin,body:{action:'approve'}});
  const notifications=(await s.request('/v1/me/notifications?limit=1',{token:follower})).data;assert.equal(notifications.items.length,1);assert.equal(notifications.items[0].versionId,second.id);
  const id=notifications.items[0].id;assert.equal((await s.request(`/v1/me/notifications/${id}/read`,{method:'POST',token:author})).status,404);
  assert.equal((await s.request(`/v1/me/notifications/${id}/read`,{method:'POST',token:follower})).status,200);
  assert.equal((await s.request('/v1/me/notifications?limit=101',{token:follower})).status,400);
  assert.equal((await s.request('/v1/me/notifications/preferences',{method:'POST',token:follower,body:{releaseUpdates:false}})).status,200);
  const third=await published(s,author,p,{name:'3.0'});await s.request(`/v1/admin/versions/${third.id}/review`,{method:'POST',token:admin,body:{action:'approve'}});
  assert.equal((await s.request('/v1/me/notifications',{token:follower})).data.items.length,1);
  for(let i=0;i<2;i++)assert.equal((await s.request(`/v1/projects/${p.id}/follow`,{method:'DELETE',token:follower})).status,200);
  assert.equal((await s.request('/v1/me/follows',{token:follower})).data.items.length,0);
});
test('collections are account-private and cannot expose unpublished or withdrawn projects',async t=>{
  const s=await setup(t),author=await s.author('collectionauthor'),other=await s.author('outsider'),p=await s.project(author),v=await published(s,author,p);
  const created=await s.request('/v1/me/collections',{method:'POST',token:author,body:{name:'My favorites'}});assert.equal(created.status,201);const id=created.data.id;
  assert.equal((await s.request(`/v1/me/collections/${id}`,{token:other})).status,404);
  assert.equal((await s.request(`/v1/me/collections/${id}/items/${p.id}`,{method:'POST',token:author})).status,404);
  await s.request(`/v1/admin/versions/${v.id}/review`,{method:'POST',token:admin,body:{action:'approve'}});
  assert.equal((await s.request(`/v1/me/collections/${id}/items/${p.id}`,{method:'POST',token:author})).status,200);
  assert.equal((await s.request(`/v1/me/collections/${id}`,{token:author})).data.items.length,1);
  await s.request(`/v1/versions/${v.id}/withdraw`,{method:'POST',token:author});
  assert.equal((await s.request(`/v1/me/collections/${id}`,{token:author})).data.items.length,0);
  assert.equal((await s.request(`/v1/versions/${v.id}/download`)).status,401);
});
test('approved revisions notify once and community tokens cannot cross permission boundaries',async t=>{
  const s=await setup(t),author=await s.author('revisionauthor'),follower=await s.author('revisionfollower'),p=await s.project(author),v=await published(s,author,p);
  await s.request(`/v1/admin/versions/${v.id}/review`,{method:'POST',token:admin,body:{action:'approve'}});
  const issue=async scopes=>(await s.request('/v1/me/tokens',{method:'POST',token:follower,body:{name:'Community test',scopes,expiresAt:Date.now()+3600000}})).data.token;
  const projectToken=await issue(['project:write']),readOnly=await issue(['community:read']),write=await issue(['community:write']);
  assert.equal((await s.request(`/v1/projects/${p.id}/follow`,{method:'POST',token:projectToken})).status,403);
  assert.equal((await s.request(`/v1/projects/${p.id}/follow`,{method:'POST',token:readOnly})).status,403);
  assert.equal((await s.request(`/v1/projects/${p.id}/follow`,{method:'POST',token:write})).status,200);
  const revision=(await s.request(`/v1/projects/${p.id}/revisions`,{method:'POST',token:author,body:{title:'Approved revision'}})).data;
  assert.equal((await s.request('/v1/me/notifications',{token:follower})).data.items.length,0);
  assert.equal((await s.request(`/v1/admin/revisions/${revision.id}/review`,{method:'POST',token:admin,body:{action:'approve',reason:'Checked'}})).status,200);
  assert.equal((await s.request('/v1/me/notifications',{token:follower})).data.items.length,1);
  assert.equal((await s.request(`/v1/admin/revisions/${revision.id}/review`,{method:'POST',token:admin,body:{action:'approve',reason:'Checked'}})).status,409);
  assert.equal((await s.request('/v1/me/notifications',{token:readOnly})).data.items.length,1);
});
