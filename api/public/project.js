const form=document.querySelector('#report-project');
const community=document.querySelector('#community-project');
let communitySession=null,following=false;
async function communityCall(route,method='GET',body){const response=await fetch('/v1'+route,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(communitySession?.csrf?{'X-Petal-CSRF':communitySession.csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw Error(data.error||'Please try again.');return data;}
if(community){
  const status=document.querySelector('#community-status'),follow=document.querySelector('#follow-project');
  (async()=>{try{const me=await communityCall('/me');if(!me.user)return;communitySession=me;following=(await communityCall(`/projects/${community.dataset.project}/follow`)).following;follow.textContent=following?'Unfollow project':'Follow project';const collections=await communityCall('/me/collections?limit=100');const select=document.querySelector('#project-collections');for(const collection of collections.items){const option=document.createElement('option');option.value=collection.id;option.textContent=collection.name;select.append(option);}status.textContent=collections.items.length?'Keep this project in your private library.':'Create a private collection in your library to save projects.';}catch(error){status.textContent=error.message;}})();
  follow.addEventListener('click',async()=>{follow.disabled=true;try{if(!communitySession)throw Error('Sign in on the account page first.');await communityCall(`/projects/${community.dataset.project}/follow`,following?'DELETE':'POST');following=!following;follow.textContent=following?'Unfollow project':'Follow project';status.textContent=following?'You will hear about approved updates in your library.':'Project unfollowed.';}catch(error){status.textContent=error.message;}finally{follow.disabled=false;}});
  document.querySelector('#save-project').addEventListener('submit',async e=>{e.preventDefault();try{if(!communitySession)throw Error('Sign in on the account page first.');const id=new FormData(e.target).get('collectionId');await communityCall(`/me/collections/${id}/items/${community.dataset.project}`,'POST');status.textContent='Saved to your private collection.';}catch(error){status.textContent=error.message;}});
}
form?.addEventListener('submit',async e=>{
  e.preventDefault();const button=form.querySelector('button'),status=document.querySelector('#report-status');button.disabled=true;
  try{const me=await fetch('/v1/me').then(r=>r.json());if(!me.user)throw Error('Sign in to your Petal account before reporting.');
    const response=await fetch('/v1/reports',{method:'POST',headers:{'Content-Type':'application/json','X-Petal-CSRF':me.csrf},body:JSON.stringify({projectId:form.dataset.project,reason:new FormData(form).get('reason')})});
    const data=await response.json();if(!response.ok)throw Error(data.error||'Report failed.');form.reset();status.textContent='Report sent privately to the review team.';
  }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
});
