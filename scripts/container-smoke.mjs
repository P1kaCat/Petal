// Run on a Docker-equipped Linux host, from the repository root.
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8'}).trim();
const image='petal:smoke',name=`petal-smoke-${Date.now()}`,volume=`${name}-data`;
docker('build','-t',image,'.');
const [details]=JSON.parse(docker('image','inspect',image));
assert.equal(Object.keys(details.Config.ExposedPorts).length,1);assert.equal(details.Config.User,'node');
docker('volume','create',volume);
const start=()=>docker('run','-d','--name',name,'--mount',`type=volume,src=${volume},dst=/var/lib/petal`,'-e','PETAL_PUBLIC_URL=http://127.0.0.1:4318','-e','PETAL_REVIEW_POLICY=local-manual',image);
try{
  start();
  docker('exec',name,'node','-e',"require('fs').writeFileSync('/var/lib/petal/smoke-marker','persistent')");
  docker('rm','-f',name);start();
  assert.equal(docker('exec',name,'node','-e',"process.stdout.write(require('fs').readFileSync('/var/lib/petal/smoke-marker','utf8'))"),'persistent');
  console.log('One port, non-root write and volume recreation verified. Run the documented account/backup acceptance checks on this host.');
}finally{docker('rm','-f',name);docker('volume','rm',volume);}
