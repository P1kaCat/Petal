const yauzl=require('yauzl');
const {fail}=require('./http.cjs');
async function validateArchive(filename,type='mod'){
  if(type!=='mod')fail(400,'Unsupported archive type.');let zip;
  try{
    zip=await yauzl.openPromise(filename,{lazyEntries:true,strictFileNames:true,validateEntrySizes:true});let entryCount=0,expandedBytes=0;const descriptors=[];
    for await(const entry of zip.eachEntry()){
      expandedBytes+=entry.uncompressedSize;
      if(++entryCount>30000||expandedBytes>1024*1024*1024||entry.isEncrypted()||entry.fileName.split('/').some(part=>part==='..')||entry.fileName.startsWith('/')||/^[a-z]:/i.test(entry.fileName))fail(400,'Archive is encrypted or exceeds archive limits.');
      if(['fabric.mod.json','quilt.mod.json','META-INF/mods.toml','META-INF/neoforge.mods.toml','mcmod.info'].includes(entry.fileName))descriptors.push(entry.fileName);
      if(!entry.fileName.endsWith('/')){const stream=await zip.openReadStreamPromise(entry);for await(const chunk of stream){void chunk;}}
    }
    if(!descriptors.length)fail(400,'The JAR needs a Fabric, Quilt, Forge, or NeoForge mod descriptor.');return {type,entryCount,expandedBytes,descriptors};
  }catch(e){if(e.status)throw e;fail(400,'Invalid or damaged mod JAR archive.');}finally{zip?.close();}
}
module.exports={validateArchive};
