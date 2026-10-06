const path=require('node:path'),fs=require('node:fs/promises');
const {randomUUID}=require('node:crypto');
const {body,json,fail}=require('../http.cjs');
const {page}=require('../pagination.cjs');
function createProjectRoutes({db,root,auth,projects,storage,moderation}){
  const user=req=>{const p=auth.authenticate(req);if(!p)fail(401,'Sign in to continue.');return p;};
  const audit=(p,action,id)=>db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run(randomUUID(),p.id,action,id,Date.now());
  return async(req,res,route,url)=>{
    if(req.method==='GET'&&route==='/v1/me/invitations'){
      const p=user(req),result=page(db,"SELECT m.projectId,m.role,p.title FROM members m JOIN projects p ON p.id=m.projectId WHERE m.userId=? AND m.status='invited'",[p.id],url,{keys:['m.projectId']});json(res,200,{...result,invitations:result.items});return true;
    }
    const withdraw=/^\/v1\/versions\/([a-f0-9-]{36})\/withdraw$/.exec(route);
    if(req.method==='POST'&&withdraw){
      const p=user(req),v=db.prepare('SELECT * FROM versions WHERE id=?').get(withdraw[1]);if(!v)fail(404,'Version not found.');projects.requireAccess(p,v.projectId);
      if(!['pending','published'].includes(v.status))fail(409,'Only submitted releases can be withdrawn.');
      db.prepare("UPDATE versions SET status='withdrawn',reviewedAt=? WHERE id=?").run(new Date().toISOString(),v.id);audit(p,'version.withdrawn',v.id);json(res,200,{ok:true});return true;
    }
    const withdrawRevision=/^\/v1\/projects\/([a-f0-9-]{36})\/revisions\/([a-f0-9-]{36})\/withdraw$/.exec(route);
    if(req.method==='POST'&&withdrawRevision){const p=user(req);projects.requireAccess(p,withdrawRevision[1]);if(!db.prepare("UPDATE revisions SET status='withdrawn' WHERE id=? AND projectId=? AND status='pending'").run(withdrawRevision[2],withdrawRevision[1]).changes)fail(409,'Revision is no longer pending.');audit(p,'revision.withdrawn',withdrawRevision[2]);json(res,200,{ok:true});return true;}
    const projectRoute=/^\/v1\/projects\/([a-f0-9-]{36})\/(revisions|members|members\/accept|transfer|images)$/.exec(route);
    if(projectRoute){
      const [,id,action]=projectRoute,p=user(req);
      if(action==='revisions'){
        if(req.method==='POST'){json(res,201,await projects.proposeRevision(p,id,await body(req)));return true;}
        if(req.method==='GET'){projects.requireAccess(p,id,'read');const result=page(db,'SELECT * FROM revisions WHERE projectId=?',[id],url);result.items=result.items.map(projects.revisionView);json(res,200,{...result,revisions:result.items});return true;}
      }
      if(action==='members'){
        if(req.method==='GET'){projects.requireAccess(p,id,'read');const result=page(db,'SELECT u.id,u.username,m.role,m.status FROM members m JOIN users u ON u.id=m.userId WHERE projectId=?',[id],url,{keys:['u.username','u.id'],direction:'ASC'});json(res,200,{...result,members:result.items});return true;}
        if(req.method==='POST'){
          const project=projects.requireAccess(p,id,'owner'),input=await body(req);
          if(!['maintainer','contributor'].includes(input.role)||typeof input.username!=='string')fail(400,'Choose a member and role.');
          const member=db.prepare('SELECT id FROM users WHERE username=?').get(input.username.toLowerCase());if(!member||member.id===project.ownerId)fail(400,'Invalid project member.');
          if(db.prepare('SELECT COUNT(*) AS n FROM members WHERE projectId=?').get(id).n>=100)fail(409,'Team limit reached.');
          db.prepare("INSERT INTO members VALUES(?,?,?,'invited') ON CONFLICT(projectId,userId) DO UPDATE SET role=excluded.role").run(id,member.id,input.role);audit(p,'team.invited',id);json(res,201,{userId:member.id,role:input.role});return true;
        }
        if(req.method==='DELETE'){
          projects.requireAccess(p,id,'owner');const input=await body(req);if(typeof input.userId!=='string')fail(400,'Choose a member.');db.prepare('DELETE FROM members WHERE projectId=? AND userId=?').run(id,input.userId);audit(p,'team.removed',id);json(res,200,{ok:true});return true;
        }
      }
      if(action==='members/accept'&&req.method==='POST'){
        projects.get(id);if(!db.prepare("UPDATE members SET status='accepted' WHERE projectId=? AND userId=? AND status='invited'").run(id,p.id).changes)fail(404,'Invitation not found.');audit(p,'team.accepted',id);json(res,200,{ok:true});return true;
      }
      if(action==='transfer'&&req.method==='POST'){
        const project=projects.requireAccess(p,id,'owner'),input=await body(req);
        if(typeof input.userId!=='string'||input.userId===p.id||!db.prepare("SELECT 1 FROM members WHERE projectId=? AND userId=? AND status='accepted'").get(id,input.userId))fail(400,'Transfer requires an accepted team member.');
        db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE projects SET ownerId=? WHERE id=? AND ownerId=?').run(input.userId,id,p.id);db.prepare('DELETE FROM members WHERE projectId=? AND userId=?').run(id,input.userId);audit(p,'project.transferred',id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}json(res,200,{ownerId:input.userId});return true;
      }
      if(action==='images'&&req.method==='POST'){
        projects.requireAccess(p,id);auth.requirePermission(p,'publish');
        if(!['image/png','image/jpeg','image/webp'].includes(req.headers['content-type']))fail(415,'Use a PNG, JPEG or WebP raster image.');
        const length=Number(req.headers['content-length']);if(!Number.isSafeInteger(length)||length<1)fail(411,'Content-Length is required.');if(length>5*1024*1024)fail(413,'Image exceeds 5 MB.');
        if(db.prepare('SELECT COUNT(*) AS n FROM images WHERE projectId=?').get(id).n>=100)fail(409,'Project image limit reached.');
        const reservation=storage.reserveUpload({userId:p.id,size:5*1024*1024,kind:'image'});
        try{
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>length)fail(413,'Image size exceeded.');chunks.push(chunk);}if(size!==length)fail(400,'Incomplete image.');
        let bytes;try{const sharp=require('sharp'),image=sharp(Buffer.concat(chunks),{limitInputPixels:16000000,animated:false});const metadata=await image.metadata();if(!['png','jpeg','webp'].includes(metadata.format)||metadata.pages>1)fail(400,'Use a static raster image.');bytes=await image.rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer();}catch(e){if(e.status)throw e;fail(400,'Invalid image.');}
        const imageId=randomUUID();await fs.mkdir(path.join(root,'images'),{recursive:true});await fs.writeFile(path.join(root,'images',imageId+'.webp'),bytes,{flag:'wx',mode:0o600});
        try{projects.requireAccess(user(req),id);storage.commitImage(reservation,{id:imageId,projectId:id,size:bytes.length});}catch(e){await fs.rm(path.join(root,'images',imageId+'.webp'),{force:true});throw e;}json(res,201,{id:imageId,url:'/media/'+imageId});return true;
        }finally{storage.cancelUpload(reservation);}
      }
    }
    const imageRoute=/^\/media\/([a-f0-9-]{36})$/.exec(route);
    if(req.method==='GET'&&imageRoute){
      const image=db.prepare('SELECT * FROM images WHERE id=?').get(imageRoute[1]);
      const publicImage=image&&db.prepare("SELECT 1 FROM projects p WHERE p.id=? AND (p.iconId=? OR EXISTS(SELECT 1 FROM json_each(p.gallery) WHERE value=?)) AND EXISTS(SELECT 1 FROM versions WHERE projectId=p.id AND status='published')").get(image.projectId,image.id,image.id);
      if(!image||!publicImage){if(!image)fail(404,'Image not found.');const p=auth.authenticate(req);if(!p||!projects.role(p,projects.get(image.projectId))&&!p.admin)fail(404,'Image not found.');}
      res.writeHead(200,{'Content-Type':'image/webp','Cache-Control':'no-store'});res.end(await fs.readFile(path.join(root,'images',image.id+'.webp')));return true;
    }
    const review=/^\/v1\/admin\/revisions\/([a-f0-9-]{36})\/review$/.exec(route);
    if(req.method==='POST'&&review){json(res,200,await moderation.decide(user(req),{...await body(req),revisionId:review[1]}));return true;}
    if(req.method==='GET'&&route==='/v1/admin/revisions'){auth.requirePermission(user(req),'moderate');const result=page(db,"SELECT * FROM revisions WHERE status='pending'",[],url,{direction:'ASC'});result.items=result.items.map(row=>({...projects.revisionView(row),projectTitle:projects.get(row.projectId).title}));json(res,200,{...result,revisions:result.items});return true;}
    if(req.method==='POST'&&route==='/v1/reports'){
      const p=user(req),input=await body(req);if(typeof input.projectId!=='string'||!projects.publicProject(input.projectId))fail(404,'Published project not found.');
      if(typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>2000)fail(400,'Provide a report reason.');
      if(db.prepare("SELECT COUNT(*) AS n FROM reports WHERE reporterId=? AND status='open'").get(p.id).n>=20)fail(409,'Open report limit reached.');
      const id=randomUUID();db.prepare('INSERT INTO reports(id,reporterId,projectId,reason,createdAt) VALUES(?,?,?,?,?)').run(id,p.id,input.projectId,input.reason.trim(),new Date().toISOString());json(res,201,{id,status:'open'});return true;
    }
    const reportRoute=/^\/v1\/reports\/([a-f0-9-]{36})$/.exec(route);
    if(req.method==='GET'&&reportRoute){const p=user(req),row=db.prepare('SELECT * FROM reports WHERE id=? AND reporterId=?').get(reportRoute[1],p.id);if(!row)fail(404,'Report not found.');json(res,200,row);return true;}
    if(req.method==='GET'&&route==='/v1/admin/reports'){auth.requirePermission(user(req),'moderate');const result=page(db,"SELECT * FROM reports WHERE status='open'",[],url,{direction:'ASC'});json(res,200,{...result,reports:result.items});return true;}
    const resolve=/^\/v1\/admin\/reports\/([a-f0-9-]{36})$/.exec(route);
    if(req.method==='POST'&&resolve){const p=user(req);auth.requirePermission(p,'moderate');const input=await body(req);if(typeof input.resolution!=='string'||!input.resolution.trim()||input.resolution.length>2000)fail(400,'Provide a resolution.');if(!db.prepare("UPDATE reports SET status='closed',resolution=? WHERE id=? AND status='open'").run(input.resolution.trim(),resolve[1]).changes)fail(409,'Report is no longer open.');audit(p,'report.closed',resolve[1]);json(res,200,{ok:true});return true;}
    return false;
  };
}
module.exports={createProjectRoutes};
