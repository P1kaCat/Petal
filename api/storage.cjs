const path=require('node:path'),fs=require('node:fs/promises');
const {randomUUID}=require('node:crypto');
const {fail}=require('./http.cjs');
function createStorage({db,root,maxUpload=64*1048576,maxStorage=2048*1048576,maxAuthor=256*1048576,now=Date.now}){
  for(const n of [maxUpload,maxStorage,maxAuthor])if(!Number.isSafeInteger(n)||n<1)throw new Error('Invalid storage limits.');
  const filePath=(key,folder='files')=>{if(!/^[a-f0-9-]{36}\.(jar|zip|webp)$/.test(key)||!['files','quarantine','images'].includes(folder))throw new Error('Invalid storage key.');return path.join(root,folder,key);};
  function reserveUpload({userId,versionId=null,size,kind='version'}){
    if(!Number.isSafeInteger(size)||size<1||size>maxUpload)fail(413,'File exceeds the upload limit.');
    if(!['version','image'].includes(kind))fail(400,'Invalid upload type.');
    db.exec('BEGIN IMMEDIATE');try{
      const global=db.prepare('SELECT (SELECT COALESCE(SUM(size),0) FROM versions)+(SELECT COALESCE(SUM(size),0) FROM images)+(SELECT COALESCE(SUM(size),0) FROM upload_reservations) AS used').get().used;
      const user=db.prepare('SELECT (SELECT COALESCE(SUM(size),0) FROM versions WHERE uploadedBy=?)+(SELECT COALESCE(SUM(size),0) FROM images WHERE ownerId=?)+(SELECT COALESCE(SUM(size),0) FROM upload_reservations WHERE userId=?) AS used').get(userId,userId,userId).used;
      if(global+size>maxStorage||user+size>maxAuthor)fail(413,'Storage quota exceeded.');
      if(db.prepare('SELECT COUNT(*) AS n FROM upload_reservations').get().n>=4||versionId&&db.prepare('SELECT 1 FROM upload_reservations WHERE versionId=?').get(versionId))fail(409,'An upload is already in progress. Try again later.');
      const id=randomUUID(),expiresAt=now()+2*3600000;db.prepare('INSERT INTO upload_reservations VALUES(?,?,?,?,?,?)').run(id,userId,versionId,size,expiresAt,kind);db.exec('COMMIT');return {id,userId,versionId,size,expiresAt,kind};
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  function commitUpload(reservation,{checksum,storageKey,size,scanStatus='unscanned'}){
    if(!/^[a-f0-9]{128}$/.test(checksum)||!Number.isSafeInteger(size)||size<1||size>reservation.size||!['clean','failed','infected','unscanned','manual'].includes(scanStatus))throw new Error('Invalid upload result.');filePath(storageKey);
    db.exec('BEGIN IMMEDIATE');try{
      const held=db.prepare('SELECT * FROM upload_reservations WHERE id=? AND expiresAt>?').get(reservation.id,now());if(!held||held.versionId!==reservation.versionId)fail(409,'Upload reservation expired.');
      if(!db.prepare("UPDATE versions SET status='pending',sha512=?,size=?,uploadedBy=?,storageKey=?,scanStatus=? WHERE id=? AND status='draft'").run(checksum,size,held.userId,storageKey,scanStatus,held.versionId).changes)fail(409,'Version changed while uploading.');
      db.prepare('DELETE FROM upload_reservations WHERE id=?').run(reservation.id);db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  function cancelUpload(reservation){db.prepare('DELETE FROM upload_reservations WHERE id=?').run(reservation.id);}
  function commitImage(reservation,{id,projectId,size}){
    if(!Number.isSafeInteger(size)||size<1||size>reservation.size)fail(413,'Encoded image exceeds its reservation.');
    db.exec('BEGIN IMMEDIATE');try{
      const held=db.prepare("SELECT * FROM upload_reservations WHERE id=? AND kind='image' AND expiresAt>?").get(reservation.id,now());if(!held)fail(409,'Upload reservation expired.');
      if(db.prepare('SELECT COUNT(*) AS n FROM images WHERE projectId=?').get(projectId).n>=100)fail(409,'Project image limit reached.');
      db.prepare('INSERT INTO images VALUES(?,?,?,?,?)').run(id,projectId,held.userId,size,new Date(now()).toISOString());db.prepare('DELETE FROM upload_reservations WHERE id=?').run(reservation.id);db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  async function locate(key){for(const folder of ['files','quarantine']){const target=filePath(key,folder);try{await fs.access(target);return target;}catch(e){if(e.code!=='ENOENT')throw e;}}fail(404,'Stored file is unavailable.');}
  async function publish(version){
    const current=await locate(version.storageKey||version.id+'.jar'),target=filePath(version.storageKey||version.id+'.jar');if(current!==target)await fs.rename(current,target);
  }
  async function collectAbandoned({before=now()-86400000,restart=false}={}){
    for(const folder of ['incoming','files','quarantine','images'])await fs.mkdir(path.join(root,folder),{recursive:true});
    const rows=db.prepare(`SELECT * FROM upload_reservations ${restart?'':'WHERE expiresAt<=?'}`).all(...(restart?[]:[now()]));
    for(const row of rows){await fs.rm(path.join(root,'incoming',row.id),{force:true});cancelUpload(row);}
    // A restart owns no active uploads. Periodic sweeps preserve every live reservation.
    for(const entry of await fs.readdir(path.join(root,'incoming'),{withFileTypes:true})){if(!entry.isFile()||! /^[a-f0-9-]{36}$/.test(entry.name)||db.prepare('SELECT 1 FROM upload_reservations WHERE id=?').get(entry.name))continue;const target=path.join(root,'incoming',entry.name);if(restart||(await fs.stat(target)).mtimeMs<before)await fs.rm(target,{force:true});}
    const cutoff=new Date(now()-7*86400000).toISOString();
    const withdrawn=db.prepare("SELECT * FROM versions WHERE status IN ('withdrawn','rejected') AND reviewedAt<? AND sha512 IS NOT NULL").all(cutoff);
    for(const v of withdrawn){
      const referenced=db.prepare("SELECT 1 FROM versions d,json_each(d.dependencies) dep WHERE d.status='published' AND json_extract(dep.value,'$.versionId')=? LIMIT 1").get(v.id);if(referenced)continue;
      for(const folder of ['files','quarantine'])await fs.rm(filePath(v.storageKey||v.id+'.jar',folder),{force:true});
      db.prepare('UPDATE versions SET sha512=NULL,size=NULL,storageKey=NULL WHERE id=?').run(v.id);
    }
    db.prepare("DELETE FROM versions WHERE status='draft' AND createdAt<? AND NOT EXISTS(SELECT 1 FROM upload_reservations WHERE versionId=versions.id)").run(new Date(before).toISOString());
    for(const folder of ['files','quarantine']){
      for(const entry of await fs.readdir(path.join(root,folder),{withFileTypes:true})){if(!entry.isFile()||! /^[a-f0-9-]{36}\.(jar|zip)$/.test(entry.name))continue;
        if(db.prepare('SELECT 1 FROM versions WHERE storageKey=? AND sha512 IS NOT NULL').get(entry.name))continue;
        const target=filePath(entry.name,folder);if(restart||(await fs.stat(target)).mtimeMs<before)await fs.rm(target,{force:true});
      }
    }
    for(const image of db.prepare('SELECT * FROM images WHERE createdAt<?').all(new Date(before).toISOString())){
      const retained=db.prepare("SELECT 1 FROM revisions r WHERE r.projectId=? AND r.status IN ('pending','approved') AND (json_extract(r.content,'$.iconId')=? OR EXISTS(SELECT 1 FROM json_each(json_extract(r.content,'$.gallery')) WHERE value=?)) UNION SELECT 1 FROM projects p WHERE p.id=? AND (p.iconId=? OR EXISTS(SELECT 1 FROM json_each(p.gallery) WHERE value=?)) LIMIT 1").get(image.projectId,image.id,image.id,image.projectId,image.id,image.id);
      if(!retained){await fs.rm(filePath(image.id+'.webp','images'),{force:true});db.prepare('DELETE FROM images WHERE id=?').run(image.id);}
    }
    for(const entry of await fs.readdir(path.join(root,'images'),{withFileTypes:true})){
      if(!entry.isFile()||! /^[a-f0-9-]{36}\.webp$/.test(entry.name)||db.prepare('SELECT 1 FROM images WHERE id=?').get(entry.name.slice(0,-5)))continue;
      const target=filePath(entry.name,'images');if(restart||(await fs.stat(target)).mtimeMs<before)await fs.rm(target,{force:true});
    }
  }
  return {reserveUpload,commitUpload,commitImage,cancelUpload,collectAbandoned,locate,publish,filePath};
}
module.exports={createStorage};
