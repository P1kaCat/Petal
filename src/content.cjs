const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {download,planInstall}=require('./mods.cjs');
const {validateArchive}=require('./archive-validation.cjs');
const {TYPES,TARGETS,safeContentFilename,validatePack}=require('./content-format.cjs');
async function safeDirectory(root,relative,{mustExist=false}={}){
  let current=root;
  for(const part of relative.split('/')){
    if(!part||part==='.'||part==='..'||/[\\:\x00-\x1f]/.test(part))throw Error('Unsafe content directory.');current=path.join(current,part);
    try{const stat=await fs.lstat(current);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Content directory must not be a link.');}
    catch(error){if(error.code!=='ENOENT')throw error;if(mustExist)throw Error('Select an existing Minecraft world.');await fs.mkdir(current);}
  }
  return current;
}
async function installContent(store,catalog,profileId,source,id,type,options={},notify=()=>{},fetcher=fetch){
  if(!TYPES.includes(type)||type==='mod')throw Error('Select a pack content type.');
  const profile=store.profile(profileId),root=store.directory(profileId);
  const destination=async fileType=>{
    if(fileType==='datapack'){
      if(typeof options.world!=='string'||!options.world||options.world.length>100||options.world==='.'||options.world==='..'||/[\\/:\x00-\x1f]/.test(options.world))throw Error('Select a Minecraft world for datapacks.');
      await safeDirectory(root,`saves/${options.world}`,{mustExist:true});return safeDirectory(root,`saves/${options.world}/datapacks`);
    }return safeDirectory(root,TARGETS[fileType]);
  };
  const stage=path.join(root,`.content-${randomUUID()}`);await fs.mkdir(stage,{recursive:true});
  const original=structuredClone(profile.content||[]),originalMods=structuredClone(profile.mods),written=[],backups=[];let totalBytes=0;
  try{
    let requests=[];const resolved=await catalog.resolveContent(source,id,profile,options.versionId,type);
    if(type==='modpack'){
      const bytes=await download(resolved.file,fetcher,source==='petal'?catalog.petalUrl:'',source==='curseforge'?catalog.getKey?.():'',type);
      const archive=path.join(stage,'manifest.zip');await fs.writeFile(archive,bytes);const {manifest}=await validateArchive(archive,type);
      if(manifest.gameVersion!==profile.version||manifest.loader!==profile.loader)throw Error('Pack Minecraft version and loader must match the selected profile.');
      for(const entry of manifest.files.filter(f=>!f.optional||options.includeOptional===true)){
        const item=await catalog.resolveContent(entry.source,entry.projectId,profile,entry.versionId,entry.type);
        if(item.file.hash.toLowerCase()!==entry.hash.toLowerCase()||item.file.algorithm!==entry.algorithm)throw Error('Pack checksum disagrees with provider metadata.');requests.push({...item,type:entry.type,targetName:entry.target.split('/')[1]});
      }
    }else requests=[{...resolved,type,targetName:resolved.file.name}];
    const modRoots=requests.filter(r=>r.type==='mod');if(modRoots.length&&profile.loader==='vanilla')throw Error('Vanilla cannot load mods.');
    if(modRoots.length){
      const adapter={resolve:(s,p,profile,v)=>catalog.resolveContent(s,p,profile,v,'mod')};
      const dependencies=await planInstall(adapter,profile,null,null,modRoots.map(item=>({source:item.source,id:item.id,versionId:item.versionId})));
      for(const dep of dependencies)if(!requests.some(r=>r.source===dep.source&&r.id===dep.id&&r.versionId===dep.versionId))requests.push({...dep,type:'mod',targetName:dep.file.name});
    }
    if(requests.length>100)throw Error('Pack exceeds 100 resolved files.');const targets=new Set();
    for(let i=0;i<requests.length;i++){
      const item=requests[i];safeContentFilename(item.targetName,item.type);item.file={...item.file,name:item.targetName};item.directory=await destination(item.type);item.target=path.join(item.directory,item.targetName);
      if(targets.has(item.target.toLowerCase()))throw Error('Content target collision.');targets.add(item.target.toLowerCase());
      const owner=item.type==='mod'?originalMods.find(m=>m.source===item.source&&m.id===item.id):original.find(m=>m.source===item.source&&m.id===item.id&&m.target===path.relative(root,item.target));
      try{const stat=await fs.lstat(item.target);if(!owner)throw Error('Content file already exists.');if(!stat.isFile()||stat.isSymbolicLink())throw Error('Content target must be a regular file.');}catch(error){if(error.code!=='ENOENT')throw error;}
      notify(`Downloading: ${item.title||item.targetName}`);
      const bytes=await download(item.file,fetcher,item.source==='petal'?catalog.petalUrl:'',item.source==='curseforge'?catalog.getKey?.():'',item.type);
      totalBytes+=bytes.length;if(totalBytes>1073741824)throw Error('Pack exceeds 1 GB downloaded content.');item.staged=path.join(stage,String(i));await fs.writeFile(item.staged,bytes);await validateArchive(item.staged,item.type);
      if(owner){const previous=item.type==='mod'?path.join(root,'mods',owner.file.name+(owner.enabled===false?'.disabled':'')):item.target;
        const stat=await fs.lstat(previous).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});if(stat?.isSymbolicLink())throw Error('Content target must not be a link.');item.previous=stat?previous:null;}
    }
    for(const item of requests){
      if(item.previous){const backup=path.join(stage,`backup-${backups.length}`);await fs.rename(item.previous,backup);backups.push({from:item.previous,to:backup});}
      await fs.rename(item.staged,item.target);written.push(item.target);
      const record={...item,enabled:true,installedAt:new Date().toISOString()};for(const key of ['directory','staged','previous','targetName'])delete record[key];record.target=path.relative(root,item.target);
      if(item.type==='mod'){profile.mods=profile.mods.filter(m=>m.source!==item.source||m.id!==item.id);profile.mods.push(record);}
      else{profile.content=(profile.content||[]).filter(m=>m.target!==record.target);profile.content.push(record);}
    }
    await store.save();return {count:requests.length};
  }catch(error){for(const file of written)await fs.rm(file,{force:true});for(const backup of backups.reverse())await fs.rename(backup.to,backup.from);profile.content=original;profile.mods=originalMods;throw error;}
  finally{await fs.rm(stage,{recursive:true,force:true});}
}
module.exports={installContent,validatePack,safeDirectory};
