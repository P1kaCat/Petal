const $=s=>document.querySelector(s);
let csrf='',currentId='',linkToken='',linkKind='';
function notice(text,error=false){$('#notice').hidden=false;$('#notice').textContent=text;$('#notice').classList.toggle('error',error);}
async function call(route,method='GET',body){
  const response=await fetch('/v1'+route,{method,credentials:'same-origin',headers:{...(body?{'Content-Type':'application/json'}:{}),...(csrf?{'X-Petal-CSRF':csrf}:{})},body:body?JSON.stringify(body):undefined});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Request failed.');return data;
}
function bind(id,action){$(id).addEventListener('submit',async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;try{await action(Object.fromEntries(new FormData(e.target)));e.target.reset();}catch(error){notice(error.message,true);}finally{b.disabled=false;}});}
async function refresh(){
  try{const me=await call('/me');csrf=me.csrf;currentId=me.sessionId;$('#signed-in').hidden=false;$('#signed-out').hidden=true;$('#account-label').textContent=me.user.username;$('#email-state').textContent=me.user.email?`${me.user.email} · ${me.user.emailVerified?'Verified':'Verification pending'}`:'Add an email to enable account recovery.';$('#email-form [name=email]').value=me.user.email||'';$('#mfa-setup').hidden=me.user.mfaEnabled;await sessions();}
  catch(error){csrf='';$('#signed-in').hidden=true;$('#signed-out').hidden=false;}
}
async function sessions(){
  const data=await call('/me/sessions');$('#sessions').replaceChildren();
  for(const s of data.sessions){const article=document.createElement('article'),text=document.createElement('p'),button=document.createElement('button');text.textContent=`${s.kind==='cookie'?'Website':'API'} session${s.id===currentId?' · Current session':''} · Expires ${new Date(s.expires).toLocaleString()}`;button.textContent='Revoke session';button.className='secondary';button.addEventListener('click',async()=>{try{await call('/me/sessions/'+s.id,'DELETE');await refresh();notice('Session revoked.');}catch(e){notice(e.message,true);}});article.append(text,button);$('#sessions').append(article);}
}
bind('#signin',async data=>{await call('/auth/login','POST',{...data,sessionType:'cookie'});await refresh();notice('Signed in.');});
bind('#recovery',async data=>{notice((await call('/auth/recovery','POST',data)).message);});
bind('#email-form',async data=>{await call('/me/email','POST',data);notice('Verification email sent.');});
bind('#mfa-setup',async data=>{const setup=await call('/me/mfa/setup','POST',data);$('#setup-key').textContent=setup.secret;$('#mfa-confirm').hidden=false;notice('Add the key to your authenticator, then confirm a code.');});
bind('#mfa-confirm',async data=>{const result=await call('/me/mfa/confirm','POST',data);$('#setup-key').textContent='';$('#mfa-confirm').hidden=true;$('#recovery-codes').hidden=false;$('#codes').textContent=result.recoveryCodes.join('\n');await refresh();notice('Authenticator enabled. Sign in again with a fresh code before moderating.');});
$('#logout').addEventListener('click',async()=>{try{await call('/auth/logout','POST');$('#codes').textContent='';$('#recovery-codes').hidden=true;await refresh();notice('Signed out.');}catch(e){notice(e.message,true);}});
bind('#verify',async()=>{await call('/auth/verify','POST',{token:linkToken});linkToken='';$('#link-actions').hidden=true;await refresh();notice('Email verified.');});
bind('#reset',async data=>{await call('/auth/reset','POST',{token:linkToken,...data});linkToken='';$('#link-actions').hidden=true;await refresh();notice('Password updated. Sign in with your new password.');});
function readLink(){
  const fragment=new URLSearchParams(location.hash.slice(1));for(const kind of ['verify','reset'])if(fragment.has(kind)){linkKind=kind;linkToken=fragment.get(kind);}
  history.replaceState(null,'',location.pathname);if(linkToken){$('#link-actions').hidden=false;$('#verify').hidden=linkKind!=='verify';$('#reset').hidden=linkKind!=='reset';}
}
window.addEventListener('hashchange',readLink);readLink();
refresh();
