const {safeFilename}=require('./store.cjs');
const TYPES=['mod','resourcepack','shader','datapack','modpack'];
const TARGETS={mod:'mods',resourcepack:'resourcepacks',shader:'shaderpacks',datapack:'datapacks'};
function safeContentFilename(name,type='mod'){
  if(!TYPES.includes(type))throw Error('Unknown content type.');
  if(type==='mod')return safeFilename(name);
  if(typeof name!=='string'||!name.endsWith('.zip')||name.length>200||/[\\/:*?"<>|\x00-\x1f]/.test(name)||name.startsWith('.')||name.endsWith(' ')||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(name))throw Error('Invalid pack filename.');return name;
}
function validatePack(pack){
  if(!pack||pack.formatVersion!==1||Object.keys(pack).some(k=>!['formatVersion','name','gameVersion','loader','files'].includes(k))||typeof pack.name!=='string'||!pack.name.trim()||pack.name.length>120||!require('./version-id.cjs').validVersionId(pack.gameVersion)||!['vanilla','fabric','forge','neoforge','quilt'].includes(pack.loader)||!Array.isArray(pack.files)||!pack.files.length||pack.files.length>100)throw Error('Invalid Petal pack manifest formatVersion=1.');
  const targets=new Set();
  for(const file of pack.files){
    if(!file||Object.keys(file).some(k=>!['source','projectId','versionId','type','target','hash','algorithm','optional'].includes(k))||!['modrinth','curseforge','petal'].includes(file.source)||!TARGETS[file.type]||typeof file.projectId!=='string'||!file.projectId||file.projectId.length>100||typeof file.versionId!=='string'||!file.versionId||file.versionId.length>100||typeof file.optional!=='boolean'||!['sha1','sha512'].includes(file.algorithm)||typeof file.hash!=='string'||!(file.algorithm==='sha1'?/^[a-f0-9]{40}$/i:/^[a-f0-9]{128}$/i).test(file.hash))throw Error('Invalid pinned pack file.');
    if(typeof file.target!=='string'||file.target.split('/').length!==2||file.target.split('/')[0]!==TARGETS[file.type])throw Error('Unsafe pack target.');
    safeContentFilename(file.target.split('/')[1],file.type);if(targets.has(file.target.toLowerCase()))throw Error('Duplicate pack target.');targets.add(file.target.toLowerCase());
  }
  return pack;
}
module.exports={TYPES,TARGETS,safeContentFilename,validatePack};
