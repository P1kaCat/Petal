const path = require('node:path');
const { Store, atomicJSON } = require('../src/store.cjs');
const { prepareGame } = require('../src/game.cjs');
const { getLoader } = require('../src/loaders/index.cjs');
const { Version, generateArguments } = require('@xmcl/core');
(async()=>{
  const root=path.resolve(process.env.PETAL_VERIFY_ROOT || 'artifacts/integration');
  const store=new Store(root);await store.load();const report=[];
  const cases=[['vanilla','1.21.1'],['vanilla','24w14a'],['fabric','1.21.1'],['forge','1.21.1'],['neoforge','1.21.1'],['quilt','1.21.1']];
  for(const [loader,version] of cases){
    try{
      const choices=await getLoader(loader).list(version);
      if(!choices.length)throw new Error('No compatible metadata.');
      const profile=await store.create({name:`Adapter verification ${loader} ${version}`,version,loader,loaderVersion:choices[0].version});
      const result=await prepareGame(store,profile.id,console.log);
      await Version.parse(result.resources,result.version);
      const args=await generateArguments({gamePath:result.directory,resourcePath:result.resources,javaPath:result.javaPath,version:result.version,gameProfile:{name:'Test',id:'00000000000000000000000000000000'},accessToken:'test-only',userType:'msa',features:{petal_session:{clientid:'test-client',auth_xuid:'0'}},maxMemory:4096});
      if(args.some(a=>/\$\{/.test(a)) || !args.includes(result.directory))throw new Error('Incomplete launch arguments.');
      report.push({loader,version,loaderVersion:profile.loaderVersion,runtime:result.version,installed:true,launchVerified:false});
      console.log('INSTALLED',loader,version);
    }catch(e){report.push({loader,version,installed:false,error:e.message.slice(0,1000)});console.error('FAILED',loader,version,e.message.slice(0,500));}
    await atomicJSON(path.join(root,'adapter-report.json'),report);
  }
  if(report.some(r=>!r.installed))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
