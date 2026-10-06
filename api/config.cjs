const fs=require('node:fs/promises');
const SECRET_NAMES=['PETAL_SMTP_PASSWORD','PETAL_MFA_KEY','PETAL_ADMIN_TOKEN'];
async function loadSecretFiles(env=process.env){
  for(const name of SECRET_NAMES){
    if(!env[`${name}_FILE`])continue;
    if(env[name])throw new Error(`Choose ${name} or its private file configuration, not both.`);
    try{
      const stat=await fs.lstat(env[`${name}_FILE`]);if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>8192)throw new Error();
      const value=(await fs.readFile(env[`${name}_FILE`],'utf8')).replace(/\r?\n$/,'');
      if(!value||/[\x00\r\n]/.test(value))throw new Error();env[name]=value;
    }catch{throw new Error(`Private configuration for ${name} is unavailable or invalid.`);}
  }
}
module.exports={loadSecretFiles};
