const form=document.querySelector('#discover-form'),results=document.querySelector('#project-results');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let offset=0,generation=0;
function empty(title,message){return `<div class="empty"><img src="/favicon.svg" alt="" width="52" height="52"><h2>${esc(title)}</h2><p>${esc(message)}</p><a class="button secondary" href="/dashboard">Share a creation →</a></div>`;}
async function search(){
  const current=++generation,params=new URLSearchParams(new FormData(form));
  for(const [key,value] of [...params])if(!value.trim())params.delete(key);
  params.set('offset',offset);params.set('limit','12');
  document.querySelector('#result-count').textContent='Finding projects…';
  try{
    const response=await fetch('/v1/search?'+params);if(!response.ok)throw new Error('Search is temporarily unavailable. Please try again.');
    const data=await response.json();if(current!==generation)return;
    document.querySelector('#result-count').textContent=`${data.total.toLocaleString('en')} ${data.total===1?'project':'projects'}`;
    results.innerHTML=data.projects.length?data.projects.map(p=>`<article class="project-card"><div class="project-mark" aria-hidden="true">${esc(p.title.slice(0,1).toUpperCase())}</div><div><a class="card-title" href="/projects/${encodeURIComponent(p.id)}">${esc(p.title)}</a><p class="byline">by <a href="/users/${encodeURIComponent(p.author)}">${esc(p.author)}</a></p><p class="description">${esc(p.description)}</p><div class="card-meta"><span>Mod</span><span>${p.downloads.toLocaleString('en')} downloads</span></div></div></article>`).join(''):empty('A world of possibilities.','No published projects match these filters yet. Try another search, or be one of the first creators to make this space your own.');
    document.querySelector('#previous-page').disabled=offset===0;document.querySelector('#next-page').disabled=!data.hasMore;document.querySelector('#page-label').textContent=`Page ${Math.floor(offset/12)+1}`;
  }catch(error){if(current!==generation)return;results.innerHTML=empty('Let’s try that again.',error.message);document.querySelector('#result-count').textContent='Search unavailable';document.querySelector('#next-page').disabled=true;document.querySelector('#previous-page').disabled=true;}
}
form.addEventListener('submit',e=>{e.preventDefault();offset=0;search();});
for(const control of document.querySelectorAll('select[form=discover-form],#game-filter'))control.addEventListener('change',()=>{offset=0;search();});
document.querySelector('#clear-filters').addEventListener('click',()=>{form.reset();offset=0;search();});
document.querySelector('#next-page').addEventListener('click',()=>{offset+=12;search();});
document.querySelector('#previous-page').addEventListener('click',()=>{offset=Math.max(0,offset-12);search();});
fetch('/v1/game/versions').then(r=>r.json()).then(data=>{document.querySelector('#game-versions').innerHTML=(data.versions||[]).map(v=>`<option value="${esc(v.id)}"></option>`).join('');}).catch(()=>{});
search();
