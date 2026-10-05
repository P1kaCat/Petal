const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
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
