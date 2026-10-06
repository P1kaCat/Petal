const {DatabaseSync,backup}=require('node:sqlite');
const fs=require('node:fs/promises'),path=require('node:path');
const {constants}=require('node:fs');
const {validateRelative,checksum,safeSource}=require('./backup-common.cjs');
async function backupApi(source,destination){
  source=path.resolve(source);destination=path.resolve(destination);
  if(destination===source||destination.startsWith(source+path.sep))throw Error('Backup destination must be outside the data directory.');
  const db=new DatabaseSync(path.join(source,'catalog.sqlite'),{readOnly:true});
  try{await fs.mkdir(destination,{mode:0o700});await backup(db,path.join(destination,'catalog.sqlite'));}finally{db.close();}
  const snapshot=new DatabaseSync(path.join(destination,'catalog.sqlite'),{readOnly:true});let releases,images,schemaVersion,hasMFA;
  try{
    if(snapshot.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('Database snapshot failed integrity checks.');
    releases=snapshot.prepare('SELECT id,storageKey,sha512,status FROM versions WHERE sha512 IS NOT NULL').all();images=snapshot.prepare('SELECT id FROM images').all();schemaVersion=snapshot.prepare('SELECT MAX(version) AS n FROM schema_migrations').get().n;hasMFA=!!snapshot.prepare('SELECT 1 FROM users WHERE mfaSecret IS NOT NULL LIMIT 1').get();
  }finally{snapshot.close();}
  const manifest={formatVersion:1,createdAt:new Date().toISOString(),schemaVersion,files:[],requiredExternalConfig:['origin, mail, scanning policy and operator-managed environment configuration']};
  async function record(relative,role,expected){
    validateRelative(relative);const result=await checksum(path.join(destination,...relative.split('/')));if(expected&&result.sha512!==expected)throw Error('Stored release checksum mismatch. Backup is incomplete.');manifest.files.push({path:relative,role,...result});
  }
  async function copy(relative,destRelative=relative){
    validateRelative(destRelative);const src=await safeSource(source,relative),target=path.join(destination,...destRelative.split('/'));await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});await fs.copyFile(src,target,constants.COPYFILE_EXCL);await fs.chmod(target,0o600);
  }
  await fs.chmod(path.join(destination,'catalog.sqlite'),0o600);await record('catalog.sqlite','database');
  for(const release of releases){
    const key=release.storageKey||release.id+'.jar',relative=(release.status==='published'?'files/':'quarantine/')+key;let copied=false;
    for(const folder of ['files','quarantine']){try{await copy(folder+'/'+key,relative);copied=true;break;}catch(error){if(error.code!=='ENOENT')throw error;}}
    if(!copied)throw Error('Referenced release is missing. Backup is incomplete.');await record(relative,'release',release.sha512);
  }
  for(const image of images){const relative='images/'+image.id+'.webp';await copy(relative);await record(relative,'image');}
  for(const name of ['mfa-key.txt','admin-token.txt']){try{await copy(name);await record(name,'secret');}catch(error){if(error.code!=='ENOENT')throw error;if(name==='mfa-key.txt'&&hasMFA)manifest.requiredExternalConfig.push('PETAL_MFA_KEY');}}
  await fs.writeFile(path.join(destination,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});return manifest;
}
if(require.main===module){if(process.argv.length!==4){console.error('Usage: node scripts/backup-api.cjs DATA_DIRECTORY NEW_BACKUP_DIRECTORY');process.exitCode=1;}else backupApi(process.argv[2],process.argv[3]).then(m=>console.log(`Backup complete: ${m.files.length} checksummed files.`)).catch(error=>{console.error('Backup failed:',error.message);process.exitCode=1;});}
module.exports={backupApi};
