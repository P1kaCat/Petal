const {randomUUID,randomBytes}=require('node:crypto');
const {digest}=require('./auth.cjs');
const {fail}=require('./http.cjs');
const scopes=['project:read','project:write','account:read','community:read','community:write'];
function createTokens({db,now=Date.now}){
  function requireSession(principal){if(!principal)fail(401,'Sign in to continue.');if(!['cookie','bearer'].includes(principal.kind)||principal.localOperator)fail(403,'Use an account session to manage API tokens.');}
  function issueScopedToken(principal,{name,scopes:requested,expiresAt}){
    requireSession(principal);
    if(typeof name!=='string'||!name.trim()||name.length>80||!Array.isArray(requested)||!requested.length||requested.length>scopes.length||requested.some(s=>!scopes.includes(s)))fail(400,'Choose a name and valid token scopes.');
    if(!Number.isSafeInteger(expiresAt)||expiresAt<=now()||expiresAt>now()+90*86400000)fail(400,'Token expiry must be within 90 days.');
    if(db.prepare('SELECT COUNT(*) AS n FROM api_tokens WHERE userId=?').get(principal.id).n>=100)fail(409,'Token limit reached.');
    const id=randomUUID(),token='ptl_'+randomBytes(32).toString('base64url');db.prepare('INSERT INTO api_tokens VALUES(?,?,?,?,?,?,?)').run(id,principal.id,digest(token),name.trim(),JSON.stringify([...new Set(requested)]),expiresAt,now());
    db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run(randomUUID(),principal.id,'token.issued',id,now());return {id,token,name:name.trim(),scopes:[...new Set(requested)],expiresAt};
  }
  function revokeScopedToken(principal,tokenId){requireSession(principal);db.prepare('DELETE FROM api_tokens WHERE id=? AND userId=?').run(tokenId,principal.id);db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run(randomUUID(),principal.id,'token.revoked',tokenId,now());return {ok:true};}
  return {issueScopedToken,revokeScopedToken,requireSession};
}
module.exports={createTokens,scopes};
