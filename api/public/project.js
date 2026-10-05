const form=document.querySelector('#report-project');
form?.addEventListener('submit',async e=>{
  e.preventDefault();const button=form.querySelector('button'),status=document.querySelector('#report-status');button.disabled=true;
  try{const me=await fetch('/v1/me').then(r=>r.json());if(!me.user)throw Error('Sign in to your Petal account before reporting.');
    const response=await fetch('/v1/reports',{method:'POST',headers:{'Content-Type':'application/json','X-Petal-CSRF':me.csrf},body:JSON.stringify({projectId:form.dataset.project,reason:new FormData(form).get('reason')})});
    const data=await response.json();if(!response.ok)throw Error(data.error||'Report failed.');form.reset();status.textContent='Report sent privately to the review team.';
  }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
});
