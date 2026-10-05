const {randomUUID}=require('node:crypto');
const {fail}=require('./http.cjs');
function createModeration({db,auth,projects}){
  async function decide(principal,{revisionId,action,reason}){
    auth.requirePermission(principal,'moderate');
    if(!['approve','reject','withdraw'].includes(action)||typeof reason!=='string'||!reason.trim()||reason.length>2000)fail(400,'Provide an action and review reason.');
    const revision=db.prepare('SELECT * FROM revisions WHERE id=?').get(revisionId);if(!revision||revision.status!=='pending')fail(409,'Revision is no longer pending.');
    const content=JSON.parse(revision.content),createdAt=new Date().toISOString();db.exec('BEGIN IMMEDIATE');
    try{
      if(action==='approve'){
        const p=projects.get(revision.projectId);if(p.revisionId!==revision.baseRevisionId)fail(409,'Project changed since this revision. Submit an updated revision.');
        db.prepare('UPDATE projects SET title=?,description=?,license=?,sourceUrl=?,iconId=?,gallery=?,revisionId=? WHERE id=?').run(content.title,content.description,content.license,content.sourceUrl,content.iconId,JSON.stringify(content.gallery),revisionId,p.id);
      }
      const status=action==='approve'?'approved':action==='reject'?'rejected':'withdrawn';
      if(!db.prepare("UPDATE revisions SET status=? WHERE id=? AND status='pending'").run(status,revisionId).changes)fail(409,'Revision is no longer pending.');
      const id=randomUUID();db.prepare('INSERT INTO decisions VALUES(?,?,?,?,?,?)').run(id,revisionId,action,reason.trim(),principal.id,createdAt);
      db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run(randomUUID(),principal.id,'revision.'+action,revisionId,Date.now());db.exec('COMMIT');
      return {id,revisionId,action,reason:reason.trim(),actorId:principal.id,createdAt};
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  return {decide};
}
module.exports={createModeration};
