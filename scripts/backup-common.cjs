const path=require('node:path'),fs=require('node:fs/promises');
const {createReadStream}=require('node:fs'),{createHash}=require('node:crypto');
function validateRelative(value){
  if(typeof value!=='string'||! /^(catalog\.sqlite|mfa-key\.txt|admin-token\.txt|(?:files|quarantine)\/[a-f0-9-]{36}\.(?:jar|zip)|images\/[a-f0-9-]{36}\.webp)$/.test(value))throw Error('Invalid backup file path.');return value;
}
async function checksum(filename){let size=0;const hash=createHash('sha512');for await(const chunk of createReadStream(filename)){size+=chunk.length;hash.update(chunk);}return {size,sha512:hash.digest('hex')};}
async function safeSource(root,relative){
  validateRelative(relative);const filename=path.join(root,...relative.split('/')),canonicalRoot=await fs.realpath(root),canonical=await fs.realpath(filename);
  if(!canonical.startsWith(canonicalRoot+path.sep)||!(await fs.lstat(filename)).isFile())throw Error('Backup files must be regular files within the backup directory.');return filename;
}
module.exports={validateRelative,checksum,safeSource};
