const test=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {download,installMods}=require('../src/mods.cjs');
test('CurseForge download authentication is restricted to the exact edge CDN and redirects are refused',async()=>{
  const body=Buffer.from('fixture'),file={name:'fixture.jar',algorithm:'sha512',hash:createHash('sha512').update(body).digest('hex')};
  const seen=[];const fetcher=async(url,options)=>{seen.push({host:url.hostname,...options});return new Response(body);};
  await download({...file,url:'https://edge.forgecdn.net/files/1/2/fixture.jar'},fetcher,'','test-only-key');
  await download({...file,url:'https://cdn.modrinth.com/fixture.jar'},fetcher,'','test-only-key');
  assert.equal(seen[0].headers['x-api-key'],'test-only-key');assert.equal(seen[0].redirect,'error');
  assert.equal(seen[1].headers?.['x-api-key'],undefined);
  await assert.rejects(download({...file,url:'https://edge.forgecdn.net.attacker.example/file.jar'},fetcher,'','test-only-key'));
  assert.equal(seen.length,2);
});
test('Vanilla profiles reject mod installation before resolving or downloading content',async()=>{
  let resolved=false;
  await assert.rejects(installMods({profile:()=>({loader:'vanilla',mods:[]})},{resolve:async()=>{resolved=true;}},'id','modrinth','mod'),/vanilla/i);
  assert.equal(resolved,false);
});
