const path=require('node:path'),fs=require('node:fs/promises');
const {constants}=require('node:fs');
const {validateRelative,checksum,safeSource}=require('./backup-common.cjs');
async function restoreApi(source,target){
  source=path.resolve(source);target=path.resolve(target);if(target===source||target.startsWith(source+path.sep))throw Error('Restore target must be separate from the backup directory.');
  try{const stat=await fs.lstat(target);if(!stat.isDirectory()||(await fs.readdir(target)).length)throw Error('Restore target must be an empty directory, never populated.');}catch(error){if(error.code!=='ENOENT')throw error;}
  const filename=path.join(source,'manifest.json');if((await fs.stat(filename)).size>32*1024*1024)throw Error('Backup manifest is too large.');
  const manifest=JSON.parse(await fs.readFile(filename,'utf8'));
  if(manifest.formatVersion!==1||!Array.isArray(manifest.files)||manifest.files.length>100000||!manifest.files.some(file=>file.path==='catalog.sqlite'))throw Error('Invalid backup manifest.');
  const seen=new Set();
  for(const file of manifest.files){
    validateRelative(file.path);if(seen.has(file.path)||!Number.isSafeInteger(file.size)||file.size<1||! /^[a-f0-9]{128}$/.test(file.sha512))throw Error('Invalid backup file record.');seen.add(file.path);
    const actual=await checksum(await safeSource(source,file.path));if(actual.size!==file.size||actual.sha512!==file.sha512)throw Error('Backup checksum verification failed.');
  }
  await fs.mkdir(target,{recursive:true,mode:0o700});
  for(const file of manifest.files){const src=await safeSource(source,file.path),destination=path.join(target,...file.path.split('/'));await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});await fs.copyFile(src,destination,constants.COPYFILE_EXCL);await fs.chmod(destination,0o600);const actual=await checksum(destination);if(actual.sha512!==file.sha512||actual.size!==file.size)throw Error('Restored checksum verification failed; target is incomplete.');}
  return {files:manifest.files.length,schemaVersion:manifest.schemaVersion,requiredExternalConfig:manifest.requiredExternalConfig};
}
if(require.main===module){if(process.argv.length!==4){console.error('Usage: node scripts/restore-api.cjs BACKUP_DIRECTORY EMPTY_TARGET_DIRECTORY');process.exitCode=1;}else restoreApi(process.argv[2],process.argv[3]).then(result=>console.log(`Restore complete: ${result.files} verified files. Supply protected runtime configuration before starting.`)).catch(error=>{console.error('Restore failed:',error.message);process.exitCode=1;});}
module.exports={restoreApi};
