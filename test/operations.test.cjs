const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {once}=require('node:events');
const {setup,jar,admin}=require('./helpers/api.cjs');
test('readiness probes actual writable storage and reports no private details',async t=>{
  const s=await setup(t);const ready=await s.request('/ready');assert.equal(ready.status,200);assert.equal(ready.data.status,'ready');
  await fs.rename(path.join(s.root,'incoming'),path.join(s.root,'incoming-saved'));await fs.writeFile(path.join(s.root,'incoming'),'blocked');
  const unready=await s.request('/ready');assert.equal(unready.status,503);assert.equal(unready.data.checks.storage,'unavailable');assert.equal(JSON.stringify(unready.data).includes(s.root),false);assert.equal(JSON.stringify(unready.data).includes(admin),false);
});
test('database readiness failure stays sanitized while liveness remains available',async t=>{
  const s=await setup(t,{dbCheck:()=>{throw new Error('synthetic DB outage with private details');}});
  assert.equal((await s.request('/health')).status,200);const ready=await s.request('/ready');assert.equal(ready.status,503);assert.equal(ready.data.checks.database,'unavailable');assert.equal(JSON.stringify(ready.data).includes('private details'),false);
});
test('live SQLite snapshot restores credentials, visibility and identical file checksums',async t=>{
  const {backupApi}=require('../scripts/backup-api.cjs'),{restoreApi}=require('../scripts/restore-api.cjs'),{createPetalServer}=require('../api/server.cjs');
  let now=Date.now();const s=await setup(t,{now:()=>now}),token=await s.author('backed_up'),p=await s.project(token),v=await s.version(token,p);
  await s.request('/v1/versions/'+v.id+'/file',{method:'PUT',token,body:jar(),binary:true});await s.request('/v1/admin/versions/'+v.id+'/review',{method:'POST',token:admin,body:{action:'approve'}});
  const pending=await s.version(token,p,{name:'private pending'});await s.request('/v1/versions/'+pending.id+'/file',{method:'PUT',token,body:jar(),binary:true});
  const mfaToken=await s.author('mfa_backed');const setupMFA=await s.request('/v1/me/mfa/setup',{method:'POST',token:mfaToken,body:{password:'test-only-password-1234'}});const otp=require('otplib');
  await s.request('/v1/me/mfa/confirm',{method:'POST',token:mfaToken,body:{code:await otp.generate({secret:setupMFA.data.secret,epoch:Math.floor(now/1000)})}});now+=31000;
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'petal-restore-test-')),snapshot=path.join(base,'snapshot'),target=path.join(base,'restored');let restored;
  t.after(async()=>{if(restored){restored.server.closeAllConnections();await new Promise(resolve=>restored.server.close(resolve));}await fs.rm(base,{recursive:true,force:true});});
  const manifest=await backupApi(s.root,snapshot);assert.equal(manifest.formatVersion,1);assert.ok(manifest.files.some(file=>file.path==='catalog.sqlite'));assert.ok(manifest.files.some(file=>file.path==='mfa-key.txt'));
  await restoreApi(snapshot,target);await assert.rejects(restoreApi(snapshot,target),/empty|populated/);
  restored=await createPetalServer({dataDir:target,adminToken:admin,now:()=>now});restored.server.listen(0,'127.0.0.1');await once(restored.server,'listening');
  const login=await fetch(restored.publicUrl+'/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'backed_up',password:'test-only-password-1234'})});assert.equal(login.status,200);
  const mfaLogin=await fetch(restored.publicUrl+'/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'mfa_backed',password:'test-only-password-1234',code:await otp.generate({secret:setupMFA.data.secret,epoch:Math.floor(now/1000)})})});assert.equal(mfaLogin.status,200);
  const original=await s.request('/v1/versions/'+v.id+'/download'),download=await fetch(restored.publicUrl+'/v1/versions/'+v.id+'/download');assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),Buffer.from(original.data));assert.equal(download.headers.get('x-checksum-sha512'),original.headers.get('x-checksum-sha512'));
  assert.equal((await fetch(restored.publicUrl+'/v1/versions/'+pending.id+'/download')).status,401);
  const release=manifest.files.find(file=>file.role==='release');await fs.appendFile(path.join(snapshot,release.path),'corrupt');await assert.rejects(restoreApi(snapshot,path.join(base,'bad-restore')),/checksum/);
});
