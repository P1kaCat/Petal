const {body,json,fail}=require('../http.cjs');
function createAccountRoutes({db,accounts,auth,publicMode}){
  const requireUser=req=>{const p=auth.authenticate(req);if(!p||p.localOperator)fail(401,'Sign in using an account.');return p;};
  const cookie=(res,token,clear=false)=>res.setHeader('Set-Cookie',`petal_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear?0:86400}${publicMode?'; Secure':''}`);
  return async (req,res,route)=>{
    if(req.method==='GET'&&route==='/v1/auth/capabilities'){json(res,200,{localOperator:!publicMode&&!db.prepare("SELECT 1 FROM operator_settings WHERE key='bootstrap'").get()});return true;}
    if(req.method==='POST'&&['/v1/auth/register','/v1/auth/login'].includes(route)){
      const input=await body(req);
      if(input.sessionType&&!['cookie','bearer'].includes(input.sessionType))fail(400,'Invalid session type.');
      const user=route.endsWith('register')?await accounts.register(input):await accounts.login(input);
      const session=accounts.issueSession(user,input.sessionType==='cookie'?'cookie':'bearer');
      if(input.sessionType==='cookie'){cookie(res,session.token);delete session.token;}
      json(res,route.endsWith('register')?201:200,session);return true;
    }
    if(req.method==='POST'&&route==='/v1/auth/recovery'){json(res,202,await accounts.issueRecovery((await body(req)).email));return true;}
    if(req.method==='POST'&&route==='/v1/auth/reset'){const data=await body(req);json(res,200,await accounts.redeemRecovery(data.token,data.password));return true;}
    if(req.method==='POST'&&route==='/v1/auth/verify'){json(res,200,await accounts.verifyEmail((await body(req)).token));return true;}
    if(req.method==='POST'&&route==='/v1/auth/logout'){
      const p=requireUser(req);db.prepare('DELETE FROM sessions WHERE hash=?').run(p.sessionHash);if(p.kind==='cookie')cookie(res,'',true);json(res,200,{ok:true});return true;
    }
    if(req.method==='GET'&&route==='/v1/me'){
      const p=requireUser(req);json(res,200,{user:accounts.view(db.prepare('SELECT * FROM users WHERE id=?').get(p.id)),csrf:p.kind==='cookie'?p.csrf:undefined,sessionId:p.sessionId});return true;
    }
    if(req.method==='GET'&&route==='/v1/me/sessions'){
      const p=requireUser(req);const sessions=db.prepare('SELECT id,expires,createdAt,kind FROM sessions WHERE userId=? AND expires>? ORDER BY createdAt DESC LIMIT 100').all(p.id,Date.now());json(res,200,{sessions});return true;
    }
    const revoke=/^\/v1\/me\/sessions\/([a-f0-9-]{36})$/.exec(route);
    if(req.method==='DELETE'&&revoke){json(res,200,await accounts.revokeSession(requireUser(req).id,revoke[1]));return true;}
    if(req.method==='POST'&&route==='/v1/me/email'){json(res,200,await accounts.setEmail(requireUser(req).id,await body(req)));return true;}
    if(req.method==='POST'&&route==='/v1/me/mfa/setup'){json(res,200,await accounts.setupMFA(requireUser(req).id,(await body(req)).password));return true;}
    if(req.method==='POST'&&route==='/v1/me/mfa/confirm'){json(res,200,await accounts.confirmMFA(requireUser(req).id,(await body(req)).code));return true;}
    return false;
  };
}
module.exports={createAccountRoutes};
