const yauzl=require('yauzl');
const {TYPES,validatePack}=require('./content-format.cjs');
const invalid=message=>{throw Object.assign(Error(message),{status:400});};
async function validateArchive(filename,type='mod'){
  if(!TYPES.includes(type))invalid('Unsupported archive type.');let zip;
  try{
    zip=await yauzl.openPromise(filename,{lazyEntries:true,strictFileNames:true,validateEntrySizes:true});
    let entryCount=0,expandedBytes=0,metadata=null,shader=false;const descriptors=[],names=new Set();
    for await(const entry of zip.eachEntry()){
      expandedBytes+=entry.uncompressedSize;const name=entry.fileName;
      if(++entryCount>30000||expandedBytes>1073741824||entry.isEncrypted()||name.split('/').some(p=>p==='..'||p==='.')||/[\\:\x00-\x1f]/.test(name)||name.startsWith('/')||(entry.externalFileAttributes>>>16&0xf000)===0xa000||names.has(name.toLowerCase()))invalid('Unsafe, encrypted or oversized archive.');
      names.add(name.toLowerCase());
      if(['fabric.mod.json','quilt.mod.json','META-INF/mods.toml','META-INF/neoforge.mods.toml','mcmod.info'].includes(name))descriptors.push(name);
      if(/^shaders\/.+\.(?:vsh|fsh|glsl)$/.test(name))shader=true;
      const capture=name===(type==='modpack'?'petal.index.json':'pack.mcmeta')&&type!=='mod'&&type!=='shader';
      if(capture&&entry.uncompressedSize>1048576)invalid('Pack metadata exceeds 1 MB.');
      if(!name.endsWith('/')){const stream=await zip.openReadStreamPromise(entry),chunks=[];let size=0;
        for await(const chunk of stream){size+=chunk.length;if(size>entry.uncompressedSize)invalid('Archive size mismatch.');if(capture)chunks.push(chunk);}
        if(capture){try{metadata=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{invalid('Invalid JSON pack metadata.');}}
      }
    }
    if(type==='mod'&&!descriptors.length)invalid('The JAR needs a Fabric, Quilt, Forge, or NeoForge mod descriptor.');
    if(['resourcepack','datapack'].includes(type)){const p=metadata?.pack,format=v=>Number.isInteger(v)&&v>=1||Array.isArray(v)&&v.length===2&&v.every(n=>Number.isInteger(n)&&n>=0);if(!p||!('description' in p)||!format(p.pack_format)&&!(format(p.min_format)&&format(p.max_format)))invalid('A valid pack.mcmeta is required.');}
    if(type==='shader'&&!shader)invalid('The ZIP needs shader source files under shaders/.');
    if(type==='modpack')validatePack(metadata);
    return {type,entryCount,expandedBytes,descriptors,...(type==='modpack'?{manifest:metadata}:{})};
  }catch(error){if(error.status)throw error;invalid('Invalid or damaged content archive.');}finally{zip?.close();}
}
module.exports={validateArchive};
