const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
test('all relative API runtime modules are included in the Docker build',()=>{
  const path=require('node:path'),image=fs.readFileSync('Dockerfile','utf8'),copied=[];
  for(const line of image.split(/\r?\n/).filter(l=>l.startsWith('COPY '))){const parts=line.slice(5).trim().split(/\s+/);parts.pop();copied.push(...parts);}
  const seen=new Set();
  function visit(file){if(seen.has(file))return;seen.add(file);assert.ok(copied.some(p=>file===p||file.startsWith(p+'/')),'Container omits runtime module '+file);
    for(const [,relative] of fs.readFileSync(file,'utf8').matchAll(/require\(['"](\.[^'"]+)['"]\)/g)){const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),relative));if(fs.existsSync(target)&&fs.statSync(target).isFile())visit(target);}
  }
  visit('api/server.cjs');
});
test('container declares one port, non-root persistence and readiness',()=>{
  const image=fs.readFileSync('Dockerfile','utf8');
  assert.deepEqual([...image.matchAll(/^EXPOSE (.+)$/gm)].map(m=>m[1]),['4318']);
  assert.match(image,/USER node/);assert.match(image,/PETAL_API_DATA_DIR=\/var\/lib\/petal/);
  assert.match(image,/PETAL_API_HOST=0\.0\.0\.0/);assert.match(image,/\/ready/);
  assert.match(image,/COPY scripts/);assert.doesNotMatch(image,/COPY \. /);
  const compose=fs.readFileSync('compose.yaml','utf8');
  assert.match(compose,/petal-data:\/var\/lib\/petal/);assert.match(compose,/PETAL_PUBLIC_URL:\s*\$\{PETAL_PUBLIC_URL:\?/);
  const ignored=fs.readFileSync('.dockerignore','utf8');
  for(const entry of ['api/data','artifacts','.env','*.sqlite*'])assert.ok(ignored.includes(entry));
});
