const {randomUUID}=require('node:crypto');
const {fail,json,body}=require('./http.cjs');
const {page}=require('./pagination.cjs');
function notifyApproval(db,{projectId,versionId=null,revisionId=null}){
  const project=db.prepare("SELECT p.* FROM projects p WHERE p.id=? AND EXISTS(SELECT 1 FROM versions WHERE projectId=p.id AND status='published')").get(projectId);if(!project)return;
  const followers=db.prepare('SELECT f.userId FROM follows f LEFT JOIN notification_preferences p ON p.userId=f.userId WHERE f.projectId=? AND f.userId<>? AND COALESCE(p.releaseUpdates,1)=1').all(projectId,project.ownerId);
  const eventKey=versionId?'version:'+versionId:'revision:'+revisionId,createdAt=new Date().toISOString();
  for(const {userId} of followers){
    db.prepare('INSERT OR IGNORE INTO notifications VALUES(?,?,?,?,?,?,?,?,NULL)').run(randomUUID(),userId,projectId,versionId,revisionId,eventKey,project.title,createdAt);
    db.prepare('DELETE FROM notifications WHERE userId=? AND id IN (SELECT id FROM notifications WHERE userId=? ORDER BY createdAt DESC,id DESC LIMIT -1 OFFSET 500)').run(userId,userId);
  }
}
function createCommunityRoutes({db,auth,projects}){
  const own=(user,id)=>db.prepare('SELECT * FROM collections WHERE id=? AND userId=?').get(id,user.id)||fail(404,'Collection not found.');
  const summary=row=>({id:row.id,name:row.name,createdAt:row.createdAt,private:true});
  return async(req,res,route,url)=>{
    const follow=/^\/v1\/projects\/([a-f0-9-]{36})\/follow$/.exec(route);
    if(!follow&&!route.startsWith('/v1/me/follows')&&!route.startsWith('/v1/me/collections')&&!route.startsWith('/v1/me/notifications'))return false;
    const user=auth.authenticate(req);if(!user||user.localOperator)fail(401,'Sign in with a Petal account.');
    if(follow){
      const id=follow[1];
      if(req.method==='DELETE'){db.prepare('DELETE FROM follows WHERE userId=? AND projectId=?').run(user.id,id);json(res,200,{following:false});return true;}
      if(!projects.publicProject(id))fail(404,'Published project not found.');
      if(req.method==='POST'){
        if(!db.prepare('SELECT 1 FROM follows WHERE userId=? AND projectId=?').get(user.id,id)&&db.prepare('SELECT COUNT(*) AS n FROM follows WHERE userId=?').get(user.id).n>=1000)fail(409,'Follow limit reached.');
        db.prepare('INSERT OR IGNORE INTO follows VALUES(?,?,?,?)').run(randomUUID(),user.id,id,new Date().toISOString());json(res,200,{following:true});return true;
      }
      if(req.method==='GET'){json(res,200,{following:!!db.prepare('SELECT 1 FROM follows WHERE userId=? AND projectId=?').get(user.id,id)});return true;}
    }
    if(route==='/v1/me/follows'&&req.method==='GET'){
      const result=page(db,"SELECT f.* FROM follows f WHERE userId=? AND EXISTS(SELECT 1 FROM versions WHERE projectId=f.projectId AND status='published')",[user.id],url);result.items=result.items.map(f=>({...f,title:projects.get(f.projectId).title,userId:undefined}));json(res,200,result);return true;
    }
    if(route==='/v1/me/collections'){
      if(req.method==='GET'){const result=page(db,'SELECT * FROM collections WHERE userId=?',[user.id],url);result.items=result.items.map(summary);json(res,200,result);return true;}
      if(req.method==='POST'){
        const input=await body(req);if(typeof input.name!=='string'||!input.name.trim()||input.name.length>80||Object.keys(input).some(k=>k!=='name'))fail(400,'Provide a collection name of 1–80 characters.');
        if(db.prepare('SELECT COUNT(*) AS n FROM collections WHERE userId=?').get(user.id).n>=100)fail(409,'Collection limit reached.');
        const id=randomUUID();db.prepare('INSERT INTO collections VALUES(?,?,?,?)').run(id,user.id,input.name.trim(),new Date().toISOString());json(res,201,summary(own(user,id)));return true;
      }
    }
    const collection=/^\/v1\/me\/collections\/([a-f0-9-]{36})(?:\/items\/([a-f0-9-]{36}))?$/.exec(route);
    if(collection){
      const row=own(user,collection[1]);
      if(collection[2]){
        const projectId=collection[2];
        if(req.method==='DELETE'){db.prepare('DELETE FROM collection_items WHERE collectionId=? AND projectId=?').run(row.id,projectId);json(res,200,{removed:true});return true;}
        if(req.method==='POST'){
          if(!projects.publicProject(projectId))fail(404,'Published project not found.');
          if(!db.prepare('SELECT 1 FROM collection_items WHERE collectionId=? AND projectId=?').get(row.id,projectId)&&db.prepare('SELECT COUNT(*) AS n FROM collection_items WHERE collectionId=?').get(row.id).n>=1000)fail(409,'Collection item limit reached.');
          db.prepare('INSERT OR IGNORE INTO collection_items VALUES(?,?,?,?)').run(randomUUID(),row.id,projectId,new Date().toISOString());json(res,200,{added:true});return true;
        }
      }else{
        if(req.method==='DELETE'){db.prepare('DELETE FROM collections WHERE id=?').run(row.id);json(res,200,{deleted:true});return true;}
        if(req.method==='GET'){const result=page(db,"SELECT i.* FROM collection_items i WHERE collectionId=? AND EXISTS(SELECT 1 FROM versions WHERE projectId=i.projectId AND status='published')",[row.id],url);result.items=result.items.map(i=>({...i,title:projects.get(i.projectId).title}));json(res,200,{...summary(row),...result});return true;}
      }
    }
    if(route==='/v1/me/notifications/preferences'){
      if(req.method==='GET'){json(res,200,{releaseUpdates:db.prepare('SELECT releaseUpdates FROM notification_preferences WHERE userId=?').get(user.id)?.releaseUpdates!==0});return true;}
      if(req.method==='POST'){const input=await body(req);if(typeof input.releaseUpdates!=='boolean'||Object.keys(input).some(k=>k!=='releaseUpdates'))fail(400,'Provide releaseUpdates as a boolean.');db.prepare('INSERT INTO notification_preferences VALUES(?,?) ON CONFLICT(userId) DO UPDATE SET releaseUpdates=excluded.releaseUpdates').run(user.id,Number(input.releaseUpdates));json(res,200,input);return true;}
    }
    if(route==='/v1/me/notifications'&&req.method==='GET'){
      const result=page(db,'SELECT id,projectId,versionId,revisionId,title,createdAt,readAt FROM notifications WHERE userId=?',[user.id],url);json(res,200,result);return true;
    }
    const read=/^\/v1\/me\/notifications\/([a-f0-9-]{36})\/read$/.exec(route);
    if(read&&req.method==='POST'){if(!db.prepare('UPDATE notifications SET readAt=COALESCE(readAt,?) WHERE id=? AND userId=?').run(new Date().toISOString(),read[1],user.id).changes)fail(404,'Notification not found.');json(res,200,{read:true});return true;}
    fail(405,'Method not allowed.');
  };
}
module.exports={createCommunityRoutes,notifyApproval};
