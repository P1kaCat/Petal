const {createHash,timingSafeEqual}=require('node:crypto');
const {fail}=require('./http.cjs');
const digest=value=>createHash('sha256').update(value).digest('hex');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&timingSafeEqual(Buffer.from(digest(a)),Buffer.from(digest(b)));
function createAuth({db,adminToken,publicMode,now=Date.now}){
  function authenticate(req){
    const bearer=/^Bearer (\S+)$/.exec(req.headers.authorization||'')?.[1];
    const cookie=/(?:^|;\s*)petal_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||'')?.[1];
    const token=bearer||cookie;if(!token)return null;
    if(bearer&&!publicMode&&!db.prepare("SELECT 1 FROM operator_settings WHERE key='bootstrap'").get()&&equal(bearer,adminToken))return {id:'admin',admin:true,roles:['admin'],sessionId:null,scopes:['*'],localOperator:true};
    const row=db.prepare('SELECT u.*,s.id AS sessionId,s.hash AS sessionHash,s.kind,s.csrf,s.mfa FROM sessions s JOIN users u ON u.id=s.userId WHERE s.hash=? AND s.expires>?').get(digest(token),now());
    if(!row||row.kind!==(bearer?'bearer':'cookie'))return null;
    const roles=JSON.parse(row.roles);
    return {id:row.id,username:row.username,email:row.email,emailVerified:!!row.emailVerified,roles,sessionId:row.sessionId,sessionHash:row.sessionHash,csrf:row.csrf,kind:row.kind,mfa:!!row.mfa,scopes:['*'],admin:roles.some(r=>['admin','moderator'].includes(r))&&(!publicMode||(!!row.mfa&&!!row.mfaSecret&&!!row.emailVerified))};
  }
  function requirePermission(principal,action,resource){
    if(!principal)fail(401,'Sign in to continue.');
    if(action==='moderate'&&!principal.admin){db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run(require('node:crypto').randomUUID(),principal.id,'permission.denied',resource?.id||null,now());fail(403,'Verified moderator access with MFA is required.');}
    if(action==='publish'&&publicMode&&!principal.emailVerified)fail(403,'Verify your email before publishing.');
    if(action==='owner'&&!principal.admin&&principal.id!==resource.ownerId)fail(403,'This project belongs to another author.');
  }
  function validateCSRF(req){
    const principal=authenticate(req);
    if(principal?.kind==='cookie'&&!['GET','HEAD','OPTIONS'].includes(req.method)&&!equal(req.headers['x-petal-csrf'],principal.csrf))fail(403,'Invalid CSRF token. Reload your account and try again.');
  }
  return {authenticate,requirePermission,validateCSRF};
}
module.exports={createAuth,digest,equal};
