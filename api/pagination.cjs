const {fail}=require('./http.cjs');
function page(db,query,parameters,url,{keys=['createdAt','id'],direction='DESC'}={}){
  if(!['ASC','DESC'].includes(direction)||keys.some(k=>! /^[a-zA-Z][a-zA-Z0-9.]*$/.test(k)))throw new Error('Invalid internal page ordering.');
  const raw=url.searchParams.get('limit')??'20';if(! /^[1-9][0-9]{0,2}$/.test(raw)||Number(raw)>100)fail(400,'Page limit must be 1–100.');const limit=Number(raw);
  let cursor;
  if(url.searchParams.has('cursor')){const encoded=url.searchParams.get('cursor');try{if(encoded.length>1024||! /^[a-zA-Z0-9_-]+$/.test(encoded))throw Error();cursor=JSON.parse(Buffer.from(encoded,'base64url'));if(!Array.isArray(cursor)||cursor.length!==keys.length||cursor.some(v=>!(typeof v==='string'&&v.length<=254||Number.isSafeInteger(v))))throw Error();}catch{fail(400,'Invalid page cursor.');}}
  const where=cursor?` AND (${keys.join(',')}) ${direction==='ASC'?'>':'<'} (${keys.map(()=>'?').join(',')})`:'';
  const rows=db.prepare(`${query}${where} ORDER BY ${keys.map(k=>k+' '+direction).join(',')} LIMIT ?`).all(...parameters,...(cursor||[]),limit+1);
  const more=rows.length>limit,items=rows.slice(0,limit),last=items.at(-1);
  return {items,limit,nextCursor:more?Buffer.from(JSON.stringify(keys.map(k=>last[k.split('.').at(-1)]))).toString('base64url'):null};
}
module.exports={page};
