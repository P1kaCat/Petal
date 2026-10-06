const fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID}=require('node:crypto');
function createReadiness({db,root,dbCheck,publicMode,mail,scanner,reviewPolicy}){
  return async()=>{
    const checks={database:'ok',storage:'ok'};
    try{if(dbCheck){if(await dbCheck()===false)throw Error('Unavailable');}else db.prepare('SELECT version FROM schema_migrations LIMIT 1').get();}catch{checks.database='unavailable';}
    let probe;
    try{
      for(const folder of ['incoming','files','quarantine','images']){const stat=await fs.stat(path.join(root,folder));if(!stat.isDirectory())throw Error('Unavailable');}
      probe=path.join(root,'incoming','.ready-'+randomUUID());await fs.writeFile(probe,'',{flag:'wx',mode:0o600});await fs.rm(probe);probe=null;
    }catch{checks.storage='unavailable';}finally{if(probe)await fs.rm(probe,{force:true}).catch(()=>{});}
    if(publicMode){checks.mail=mail.available?'configured':'unavailable';checks.reviewPolicy=reviewPolicy==='manual'||scanner?'configured':'unavailable';}
    const ready=Object.values(checks).every(value=>value==='ok'||value==='configured');
    return {ready,status:ready?'ready':'unavailable',checks};
  };
}
module.exports={createReadiness};
