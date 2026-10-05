const {randomUUID}=require('node:crypto');
const {fail}=require('./http.cjs');
const value=(input,label,max)=>{if(typeof input!=='string'||!input.trim()||input.trim().length>max)fail(400,`Invalid ${label}.`);return input.trim();};
function createProjects({db,auth}){
  function role(principal,project){if(!principal)return null;if(principal.id===project.ownerId)return 'owner';return db.prepare("SELECT role FROM members WHERE projectId=? AND userId=? AND status='accepted'").get(project.id,principal.id)?.role||null;}
  function get(id){const p=db.prepare('SELECT * FROM projects WHERE id=?').get(id);if(!p)fail(404,'Project not found.');return p;}
  function requireAccess(principal,id,action='write'){
    const p=get(id);if(!principal)fail(401,'Sign in to continue.');const r=role(principal,p);
    if(action==='owner'){if(r!=='owner')fail(403,'Only the project owner can manage this action.');}
    else if(!principal.admin&&!(action==='read'?r:['owner','maintainer'].includes(r)))fail(403,'Project membership does not permit this action.');
    return p;
  }
  function publicProject(id){return db.prepare("SELECT * FROM projects WHERE id=? AND EXISTS(SELECT 1 FROM versions WHERE projectId=projects.id AND status='published')").get(id)||null;}
  const revisionView=row=>({id:row.id,projectId:row.projectId,status:row.status,content:JSON.parse(row.content),createdAt:row.createdAt,baseRevisionId:row.baseRevisionId,decisions:db.prepare('SELECT action,reason,createdAt FROM decisions WHERE revisionId=? ORDER BY createdAt').all(row.id)});
  async function proposeRevision(principal,projectId,input){
    const project=requireAccess(principal,projectId);auth.requirePermission(principal,'publish');
    if(principal.localOperator)fail(400,'Use an author account to propose revisions.');
    if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'Invalid revision.');
    const allowed=['title','description','license','sourceUrl','iconId','gallery'];if(!Object.keys(input).length||Object.keys(input).some(k=>!allowed.includes(k)))fail(400,'Invalid revision fields.');
    if(db.prepare('SELECT COUNT(*) AS n FROM revisions WHERE projectId=?').get(projectId).n>=500)fail(409,'Project revision limit reached.');
    const content={title:project.title,description:project.description,license:project.license,sourceUrl:project.sourceUrl,iconId:project.iconId,gallery:JSON.parse(project.gallery),...input};
    for(const [k,max] of [['title',120],['description',4000],['license',500]])content[k]=value(content[k],k,max);
    if(content.sourceUrl){let u;try{u=new URL(value(content.sourceUrl,'source URL',500));}catch{fail(400,'Invalid source URL.');}if(u.protocol!=='https:'||u.username||u.password)fail(400,'Source URL must use HTTPS.');content.sourceUrl=u.href;}else content.sourceUrl='';
    if(!Array.isArray(content.gallery)||content.gallery.length>10||content.gallery.some(id=>typeof id!=='string'))fail(400,'Use at most ten project images.');
    for(const id of [...content.gallery,...(content.iconId?[content.iconId]:[])])if(!db.prepare('SELECT 1 FROM images WHERE id=? AND projectId=?').get(id,projectId))fail(400,'Image must belong to this project.');
    if(content.iconId!==null&&typeof content.iconId!=='string')fail(400,'Invalid icon.');
    const id=randomUUID();db.prepare('INSERT INTO revisions VALUES(?,?,?,?,?,?,?)').run(id,projectId,principal.id,'pending',JSON.stringify(content),project.revisionId,new Date().toISOString());
    return revisionView(db.prepare('SELECT * FROM revisions WHERE id=?').get(id));
  }
  return {role,get,requireAccess,publicProject,proposeRevision,revisionView};
}
module.exports={createProjects};
