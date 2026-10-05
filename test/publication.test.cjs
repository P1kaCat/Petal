const test=require('node:test'),assert=require('node:assert/strict');
const {setup,jar,admin}=require('./helpers/api.cjs');
async function published(s){const token=await s.author('owner');const p=await s.project(token);const v=await s.version(token,p);await s.request(`/v1/versions/${v.id}/file`,{method:'PUT',token,body:jar(),binary:true});await s.request(`/v1/admin/versions/${v.id}/review`,{method:'POST',token:admin,body:{action:'approve',note:'Private operator notes'}});return {token,p,v};}
test('project changes stay pending until approval; rejected and stale revisions retain approved content',async t=>{
  const s=await setup(t),{token,p}=await published(s);
  const revision=await s.request(`/v1/projects/${p.id}/revisions`,{method:'POST',token,body:{title:'New title',description:'<script>alert(1)</script>',license:'Strict license'}});assert.equal(revision.status,201);
  assert.equal((await s.request('/v1/projects/'+p.id)).data.title,p.title);
  const rejected=await s.request(`/v1/admin/revisions/${revision.data.id}/review`,{method:'POST',token:admin,body:{action:'reject',reason:'Needs clarification'}});assert.equal(rejected.status,200);
  assert.equal((await s.request('/v1/projects/'+p.id)).data.title,p.title);
  const next=await s.request(`/v1/projects/${p.id}/revisions`,{method:'POST',token,body:{title:'Approved title',description:'A safe description',license:'MIT'}});
  assert.equal((await s.request(`/v1/admin/revisions/${next.data.id}/review`,{method:'POST',token:admin,body:{action:'approve',reason:'Reviewed'}})).status,200);
  assert.equal((await s.request('/v1/projects/'+p.id)).data.title,'Approved title');
  assert.equal((await s.request(`/v1/admin/revisions/${next.data.id}/review`,{method:'POST',token:admin,body:{action:'reject',reason:'repeat'}})).status,409);
  const stale=await s.request(`/v1/projects/${p.id}/revisions`,{method:'POST',token,body:{title:'Stale title'}});
  const newer=await s.request(`/v1/projects/${p.id}/revisions`,{method:'POST',token,body:{title:'Newest title'}});
  await s.request(`/v1/admin/revisions/${newer.data.id}/review`,{method:'POST',token:admin,body:{action:'approve',reason:'Reviewed'}});
  assert.equal((await s.request(`/v1/admin/revisions/${stale.data.id}/review`,{method:'POST',token:admin,body:{action:'approve',reason:'Reviewed'}})).status,409);
});
test('authors can withdraw published releases without changing their stored bytes',async t=>{
  const s=await setup(t),{token,p,v}=await published(s);
  const before=await s.request('/v1/versions/'+v.id+'/download');
  assert.equal((await s.request('/v1/versions/'+v.id+'/withdraw',{method:'POST',token})).status,200);
  assert.equal((await s.request('/v1/versions/'+v.id+'/download')).status,401);
  assert.equal((await s.request('/v1/projects/'+p.id)).status,404);
  const privateFile=await s.request('/v1/versions/'+v.id+'/download',{token});assert.deepEqual(Buffer.from(privateFile.data),Buffer.from(before.data));
});
test('private review reasons and reports are not exposed to the public or unrelated accounts',async t=>{
  const s=await setup(t),{token,p,v}=await published(s);
  const other=await s.author('other');assert.equal((await s.request('/v1/versions/'+v.id)).data.reviewNote,undefined);
  assert.equal((await s.request('/v1/versions/'+v.id,{token})).data.reviewNote,'Private operator notes');
  const report=await s.request('/v1/reports',{method:'POST',token:other,body:{projectId:p.id,reason:'Please review the license'}});assert.equal(report.status,201);
  assert.equal((await s.request('/v1/reports/'+report.data.id)).status,401);
  assert.equal((await s.request('/v1/reports/'+report.data.id,{token})).status,404);
  assert.equal((await s.request('/v1/reports/'+report.data.id,{token:other})).status,200);
  assert.equal((await s.request('/v1/admin/reports',{token:admin})).data.reports.length,1);
});
test('owner-only invitations and transfers require acceptance; contributors cannot edit releases',async t=>{
  const s=await setup(t),{token,p}=await published(s);const other=await s.author('teammate');
  assert.equal((await s.request(`/v1/projects/${p.id}/members`,{method:'POST',token:other,body:{username:'teammate',role:'maintainer'}})).status,403);
  const invitation=await s.request(`/v1/projects/${p.id}/members`,{method:'POST',token,body:{username:'teammate',role:'contributor'}});assert.equal(invitation.status,201);
  assert.equal((await s.request(`/v1/projects/${p.id}/members/accept`,{method:'POST',token:other})).status,200);
  assert.equal((await s.request(`/v1/projects/${p.id}/revisions`,{method:'POST',token:other,body:{title:'Bad edit'}})).status,403);
  const me=(await s.request('/v1/me',{token:other})).data.user;
  assert.equal((await s.request(`/v1/projects/${p.id}/transfer`,{method:'POST',token:other,body:{userId:me.id}})).status,403);
  assert.equal((await s.request(`/v1/projects/${p.id}/transfer`,{method:'POST',token,body:{userId:me.id}})).status,200);
  assert.equal((await s.request(`/v1/projects/${p.id}/members`,{method:'POST',token,body:{username:'owner',role:'maintainer'}})).status,403);
  assert.equal((await s.request('/v1/projects/'+p.id)).data.author,'teammate');
});
test('raster images are re-encoded and remain private until a revision is approved',async t=>{
  const s=await setup(t),{token,p}=await published(s);
  const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.equal((await s.request(`/v1/projects/${p.id}/images`,{method:'POST',token,body:svg,binary:true,headers:{'Content-Type':'image/svg+xml'}})).status,415);
  const sharp=require('sharp'),png=await sharp({create:{width:12,height:12,channels:3,background:'#9b76d3'}}).png().toBuffer();
  const image=await s.request(`/v1/projects/${p.id}/images`,{method:'POST',token,body:png,binary:true,headers:{'Content-Type':'image/png'}});assert.equal(image.status,201);
  assert.equal((await s.request('/media/'+image.data.id)).status,404);
  const revision=await s.request(`/v1/projects/${p.id}/revisions`,{method:'POST',token,body:{iconId:image.data.id}});assert.equal(revision.status,201);
  await s.request(`/v1/admin/revisions/${revision.data.id}/review`,{method:'POST',token:admin,body:{action:'approve',reason:'Original image'}});
  const download=await s.request('/media/'+image.data.id);assert.equal(download.status,200);assert.equal(download.headers.get('content-type'),'image/webp');
  assert.equal((await s.request('/v1/projects/'+p.id)).data.iconUrl,'/media/'+image.data.id);
});
