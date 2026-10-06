const test=require('node:test'),assert=require('node:assert/strict');
const {setup,jar,admin}=require('./helpers/api.cjs');
const html=r=>Buffer.from(r.data).toString('utf8');
test('public discovery and dashboard have separate accessible entry points and safe project pages',async t=>{
  const s=await setup(t),token=await s.author('web_author');
  const hidden=await s.project(token,'pending-project');
  assert.equal((await s.request(`/projects/${hidden.id}`)).status,404);
  const p=(await s.request('/v1/projects',{method:'POST',token,body:{slug:'safe-mod',title:'<script>alert(1)</script>',description:'<img src=x onerror=alert(1)>',license:'MIT'}})).data;
  const v=await s.version(token,p);
  await s.request(`/v1/versions/${v.id}/file`,{method:'PUT',token,body:jar(),binary:true});
  await s.request(`/v1/admin/versions/${v.id}/review`,{method:'POST',token:admin,body:{action:'approve'}});
  const discovery=await s.request('/discover');assert.equal(discovery.status,200);assert.match(html(discovery),/Search|Discover/);
  const dashboard=await s.request('/dashboard');assert.equal(dashboard.status,200);assert.match(html(dashboard),/Your author account/);
  const page=html(await s.request(`/projects/${p.id}`));assert.ok(!page.includes('<script>alert(1)</script>'));assert.ok(!page.includes('<img src=x onerror=alert(1)>'));
  assert.match(page,/&lt;script&gt;/);assert.match(page,/site.css/);
  const profile=await s.request('/users/web_author');assert.equal(profile.status,200);assert.ok(!html(profile).includes('pending-project'));
  const search=await s.request('/v1/search?limit=1&sort=downloads');assert.equal(search.data.projects.length,1);assert.equal(search.data.projects[0].downloads,0);
  assert.equal((await s.request('/v1/search?q=absent')).data.total,0);
});
test('public website never serves arbitrary files or exposes unknown private authors',async t=>{
  const s=await setup(t);
  assert.equal((await s.request('/users/no_such_author')).status,404);
  assert.equal((await s.request('/data/admin-token.txt')).status,404);
  assert.equal((await s.request('/site.js')).status,200);
  const response=await s.request('/');assert.match(response.headers.get('content-security-policy'),/script-src 'self'/);
  assert.match(html(response),/href="\/account">Your account/);
});
