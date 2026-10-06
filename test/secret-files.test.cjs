const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {loadSecretFiles}=require('../api/config.cjs');
test('private file configuration is bounded, exclusive and never included in errors',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'petal-secret-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const file=path.join(root,'smtp');await fs.writeFile(file,'fixture-secret\n');
  const env={PETAL_SMTP_PASSWORD_FILE:file};await loadSecretFiles(env);assert.equal(env.PETAL_SMTP_PASSWORD,'fixture-secret');
  await assert.rejects(()=>loadSecretFiles({PETAL_SMTP_PASSWORD_FILE:file,PETAL_SMTP_PASSWORD:'other'}),/Choose/);
  await fs.writeFile(file,'x'.repeat(9000));await assert.rejects(()=>loadSecretFiles({PETAL_SMTP_PASSWORD_FILE:file}),error=>!error.message.includes('xxx'));
});
