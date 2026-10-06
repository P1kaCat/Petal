const {randomBytes,randomUUID,scrypt,createCipheriv,createDecipheriv}=require('node:crypto');
const {promisify}=require('node:util');
const {fail}=require('./http.cjs');
const {digest,equal}=require('./auth.cjs');
const otp=require('otplib');
const derive=promisify(scrypt),hour=3600000;
const emailAddress=value=>{
  if(typeof value!=='string'||value.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(value)||/[\r\n]/.test(value))fail(400,'Enter a valid email address.');return value.trim().toLowerCase();
};
const checkPassword=value=>{if(typeof value!=='string'||value.length<12||value.length>256)fail(400,'Use a password of 12–256 characters.');};
function createAccounts({db,mail,publicMode,key,now=Date.now}){
  const audit=(userId,action)=>db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run(randomUUID(),userId||null,action,null,now());
  const view=u=>({id:u.id,username:u.username,email:u.email||null,emailVerified:!!u.emailVerified,roles:JSON.parse(u.roles||'[]'),mfaEnabled:!!u.mfaSecret});
  const encrypt=secret=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const bytes=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64');};
  const decrypt=value=>{const b=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));cipher.setAuthTag(b.subarray(12,28));return Buffer.concat([cipher.update(b.subarray(28)),cipher.final()]).toString('utf8');};
  async function matches(user,password){
    checkPassword(password);
    const hash=await derive(password,user?.salt||'petal-invalid-user',64,user?JSON.parse(user.scryptParams):{N:16384,r:8,p:1});
    return !!user&&equal(hash.toString('hex'),user.passwordHash);
  }
  async function sendToken(user,kind){
    if(!mail.available)fail(503,'Email delivery is unavailable. Try again later.');
    const token=randomBytes(32).toString('hex');
    // Await delivery before changing the active token; failed mail leaves no valid undelivered token.
    try{await mail.send({to:user.email,template:kind==='verify'?'verify':'reset',variables:{token}});}catch{audit(user.id,'mail.failed');fail(503,'Email delivery is unavailable. Try again later.');}
    db.exec('BEGIN IMMEDIATE');try{db.prepare('DELETE FROM account_tokens WHERE userId=? AND kind=?').run(user.id,kind);db.prepare('INSERT INTO account_tokens VALUES(?,?,?,?)').run(digest(token),user.id,kind,now()+(kind==='reset'?30*60000:24*hour));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  }
  async function register({username,email,password}){
    if(typeof username!=='string'||! /^[a-zA-Z0-9_-]{3,40}$/.test(username))fail(400,'Use a 3–40 character username.');
    username=username.toLowerCase();checkPassword(password);email=email?emailAddress(email):null;
    if(publicMode&&!email)fail(400,'Email is required.');
    if(email&&!mail.available)fail(503,'Email delivery is unavailable. Try again later.');
    const salt=randomBytes(16).toString('hex'),hash=(await derive(password,salt,64)).toString('hex'),id=randomUUID();
    try{db.prepare('INSERT INTO users(id,username,passwordHash,salt,email) VALUES(?,?,?,?,?)').run(id,username,hash,salt,email);}catch{fail(409,'Username or email is already registered.');}
    const user=db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if(email){try{await sendToken(user,'verify');}catch(error){db.prepare('DELETE FROM users WHERE id=?').run(id);throw error;}}
    audit(id,'account.registered');return view(user);
  }
  async function verifyMFA(user,code){
    if(typeof code!=='string'||code.length>64)return false;
    if(/^[0-9]{6}$/.test(code)){
      const result=await otp.verify({secret:decrypt(user.mfaSecret),token:code,epoch:Math.floor(now()/1000),epochTolerance:30});
      if(!result.valid)return false;
      const step=result.timeStep;
      if(!Number.isSafeInteger(step)||step<=user.mfaLastStep)return false;
      return db.prepare('UPDATE users SET mfaLastStep=? WHERE id=? AND mfaLastStep<?').run(step,user.id,step).changes===1;
    }
    return db.prepare('DELETE FROM recovery_codes WHERE hash=? AND userId=?').run(digest(code),user.id).changes===1;
  }
  async function login({identifier,username,password,code}){
    const name=String(identifier||username||'').toLowerCase().slice(0,254);
    const user=db.prepare('SELECT * FROM users WHERE username=? OR email=?').get(name,name);
    if(!await matches(user,password)){audit(null,'login.failed');fail(401,'Invalid credentials.');}
    let mfa=false;
    if(user.mfaSecret){mfa=await verifyMFA(user,code);if(!mfa){audit(user.id,'mfa.failed');fail(401,'A valid authenticator or unused recovery code is required.');}}
    audit(user.id,'login.success');return {...view(user),mfa};
  }
  function issueSession(user,kind){
    const token=randomBytes(32).toString('hex'),id=randomUUID(),csrf=randomBytes(32).toString('hex'),expires=now()+24*hour;
    db.prepare('INSERT INTO sessions(hash,userId,expires,id,csrf,kind,mfa,createdAt) VALUES(?,?,?,?,?,?,?,?)').run(digest(token),user.id,expires,id,csrf,kind,user.mfa?1:0,now());
    return {token,csrf,expires,user};
  }
  async function issueRecovery(email){
    email=emailAddress(email);if(!mail.available)fail(503,'Email delivery is unavailable. Try again later.');
    const user=db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if(user){try{await sendToken(user,'reset');}catch(error){if(error.status!==503)throw error;}}
    return {message:'If an account matches this address, a recovery email will arrive shortly.'};
  }
  function tokenUser(token,kind){
    if(typeof token!=='string'||! /^[a-f0-9]{64}$/.test(token))fail(400,'Invalid or expired link.');
    const row=db.prepare('SELECT * FROM account_tokens WHERE hash=? AND kind=? AND expires>?').get(digest(token),kind,now());
    if(!row)fail(400,'Invalid or expired link.');return row;
  }
  async function redeemRecovery(token,newPassword){
    checkPassword(newPassword);tokenUser(token,'reset');
    const salt=randomBytes(16).toString('hex'),hash=(await derive(newPassword,salt,64)).toString('hex');
    db.exec('BEGIN IMMEDIATE');try{
      const row=tokenUser(token,'reset');
      db.prepare('UPDATE users SET passwordHash=?,salt=?,scryptParams=? WHERE id=?').run(hash,salt,JSON.stringify({N:16384,r:8,p:1}),row.userId);
      db.prepare('DELETE FROM account_tokens WHERE userId=? AND kind=?').run(row.userId,'reset');db.prepare('DELETE FROM sessions WHERE userId=?').run(row.userId);db.prepare('DELETE FROM api_tokens WHERE userId=?').run(row.userId);audit(row.userId,'password.reset');db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}return {ok:true};
  }
  async function verifyEmail(token){const row=tokenUser(token,'verify');db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE users SET emailVerified=1 WHERE id=?').run(row.userId);db.prepare('DELETE FROM account_tokens WHERE hash=?').run(row.hash);audit(row.userId,'email.verified');db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return {ok:true};}
  async function setEmail(userId,{email,password}){
    const user=db.prepare('SELECT * FROM users WHERE id=?').get(userId);if(!await matches(user,password))fail(401,'Invalid credentials.');email=emailAddress(email);
    if(user.email&&user.email!==email)fail(409,'Email changes require operator support in this release.');
    if(!user.email){try{db.prepare('UPDATE users SET email=? WHERE id=?').run(email,userId);}catch{fail(409,'Email is already registered.');}}
    await sendToken({...user,email},'verify');return {ok:true};
  }
  async function setupMFA(userId,password){
    const user=db.prepare('SELECT * FROM users WHERE id=?').get(userId);if(!await matches(user,password))fail(401,'Invalid credentials.');
    if(user.mfaSecret)fail(409,'MFA is already enabled.');
    const secret=otp.generateSecret();db.prepare('UPDATE users SET mfaPending=?,mfaPendingUntil=? WHERE id=?').run(encrypt(secret),now()+10*60000,userId);
    return {secret,uri:otp.generateURI({issuer:'Petal',label:user.username,secret})};
  }
  async function confirmMFA(userId,code){
    const user=db.prepare('SELECT * FROM users WHERE id=?').get(userId);
    if(!user.mfaPending||user.mfaPendingUntil<=now()||typeof code!=='string'||! /^[0-9]{6}$/.test(code))fail(400,'MFA setup has expired or the code is invalid.');
    const result=await otp.verify({secret:decrypt(user.mfaPending),token:code,epoch:Math.floor(now()/1000),epochTolerance:30});if(!result.valid)fail(400,'Invalid authenticator code.');
    const recoveryCodes=Array.from({length:10},()=>randomBytes(16).toString('hex'));
    // Another setup request may have replaced this secret while verification was running.
    db.exec('BEGIN IMMEDIATE');try{
      const updated=db.prepare('UPDATE users SET mfaSecret=mfaPending,mfaPending=NULL,mfaPendingUntil=NULL,mfaLastStep=? WHERE id=? AND mfaSecret IS NULL AND mfaPending=? AND mfaPendingUntil>?').run(result.timeStep,userId,user.mfaPending,now());
      if(!updated.changes)fail(409,'MFA setup changed. Start again.');
      for(const code of recoveryCodes)db.prepare('INSERT INTO recovery_codes VALUES(?,?)').run(digest(code),userId);db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    audit(userId,'mfa.enabled');return {recoveryCodes};
  }
  async function revokeSession(userId,sessionId){db.prepare('DELETE FROM sessions WHERE userId=? AND id=?').run(userId,sessionId);return {ok:true};}
  return {register,login,issueSession,issueRecovery,redeemRecovery,verifyEmail,revokeSession,setEmail,setupMFA,confirmMFA,view};
}
module.exports={createAccounts};
