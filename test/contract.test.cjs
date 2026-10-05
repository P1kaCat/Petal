const test=require('node:test'),assert=require('node:assert/strict');
const {setup}=require('./helpers/api.cjs');
test('scoped credentials cannot write, mint broader tokens or survive revocation',async t=>{
  const s=await setup(t),session=await s.author('tokens');
  const issued=await s.request('/v1/me/tokens',{method:'POST',token:session,body:{name:'Read only',scopes:['project:read'],expiresAt:Date.now()+3600000}});assert.equal(issued.status,201);
  const token=issued.data.token;assert.match(token,/^ptl_/);
  const p=await s.project(session);assert.equal((await s.request('/v1/projects/'+p.id,{token})).status,200);
  assert.equal((await s.request('/v1/projects',{method:'POST',token,body:{}})).status,403);
  assert.equal((await s.request('/v1/me/tokens',{method:'POST',token,body:{name:'Escalate',scopes:['project:write'],expiresAt:Date.now()+3600000}})).status,403);
  const list=await s.request('/v1/me/tokens',{token:session});assert.equal(list.data.items[0].token,undefined);assert.equal(list.data.items[0].hash,undefined);
  assert.equal((await s.request('/v1/me/tokens/'+issued.data.id,{method:'DELETE',token:session})).status,200);
  assert.equal((await s.request('/v1/projects/'+p.id,{token})).status,404);
});
test('token expiry and problem details preserve the legacy error field without internal details',async t=>{
  let now=Date.now();const s=await setup(t,{now:()=>now}),session=await s.author('expiry');
  const issued=await s.request('/v1/me/tokens',{method:'POST',token:session,body:{name:'Short',scopes:['account:read'],expiresAt:now+1000}});assert.equal(issued.status,201);
  assert.equal((await s.request('/v1/me',{token:issued.data.token})).status,200);now+=1001;
  const expired=await s.request('/v1/me',{token:issued.data.token});assert.equal(expired.status,401);assert.equal(expired.data.status,401);assert.equal(expired.data.code,'authentication_required');assert.ok(expired.data.requestId);assert.equal(expired.headers.get('x-request-id'),expired.data.requestId);assert.equal(expired.data.error,expired.data.detail);assert.match(expired.headers.get('content-type'),/application\/problem\+json/);assert.equal(JSON.stringify(expired.data).includes('SELECT'),false);
});
test('private lists use stable bounded cursor pagination and reject invalid bounds',async t=>{
  const s=await setup(t),token=await s.author('pages'),p=await s.project(token);
  for(let n=0;n<3;n++)await s.request('/v1/projects/'+p.id+'/revisions',{method:'POST',token,body:{title:'Revision '+n}});
  const first=await s.request('/v1/projects/'+p.id+'/revisions?limit=2',{token});assert.equal(first.status,200);assert.equal(first.data.limit,2);assert.equal(first.data.items.length,2);assert.ok(first.data.nextCursor);
  const next=await s.request('/v1/projects/'+p.id+'/revisions?limit=2&cursor='+first.data.nextCursor,{token});assert.equal(next.data.items.length,1);assert.equal(new Set([...first.data.items,...next.data.items].map(r=>r.id)).size,3);
  assert.equal((await s.request('/v1/projects/'+p.id+'/revisions?limit=101',{token})).status,400);
  assert.equal((await s.request('/v1/projects/'+p.id+'/revisions?cursor=bad',{token})).status,400);
  assert.equal((await s.request('/v1/search?limit=0')).status,400);
});
test('representative account, project, release, page and error responses match OpenAPI schemas',async t=>{
  const Ajv=require('ajv/dist/2020');const fs=require('node:fs');const contract=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../api/openapi.yaml'),'utf8'));
  const ajv=new Ajv({strict:false,validateFormats:false});
  const check=(name,data)=>{const validate=ajv.compile({$ref:'#/components/schemas/'+name,components:contract.components});assert.equal(validate(data),true,JSON.stringify(validate.errors));};
  const s=await setup(t),token=await s.author('schema'),p=await s.project(token),v=await s.version(token,p);
  check('Account',(await s.request('/v1/me',{token})).data.user);check('Project',p);check('Version',v);check('Page',(await s.request('/v1/me/projects',{token})).data);check('Problem',(await s.request('/v1/me')).data);
  assert.equal((await s.request('/v1/versions/'+v.id+'/download')).status,401);
  assert.equal((await s.request('/openapi.yaml')).status,200);
});
