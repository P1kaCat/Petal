const net=require('node:net'),fs=require('node:fs');
const {once}=require('node:events');
function createScanner({host=process.env.PETAL_CLAMAV_HOST,port=Number(process.env.PETAL_CLAMAV_PORT||3310)}={}){
  if(!host)return null;
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid scanner port.');
  return {async scan(filename){
    const socket=net.createConnection({host,port});socket.setTimeout(30000,()=>socket.destroy(new Error('Scanner timeout.')));
    const result=new Promise((resolve,reject)=>{let output='';socket.on('data',chunk=>{output+=chunk.toString('utf8');if(output.length>4096)socket.destroy(new Error('Invalid scanner response.'));});socket.on('end',()=>resolve(output));socket.on('error',reject);});
    // Attach rejection handling before connection/stream failures so no unhandled promise escapes.
    result.catch(()=>{});
    try{
      await once(socket,'connect');socket.write('zINSTREAM\0');
      for await(const chunk of fs.createReadStream(filename,{highWaterMark:65536})){
        const length=Buffer.alloc(4);length.writeUInt32BE(chunk.length);socket.write(length);if(!socket.write(chunk))await once(socket,'drain');
      }
      socket.write(Buffer.alloc(4));const response=(await result).replace(/\0.*$/s,'').trim();
      if(response==='stream: OK')return {status:'clean'};if(/^stream: .+ FOUND$/.test(response))return {status:'infected'};throw new Error('Scanner rejected the request.');
    }finally{socket.destroy();}
  }};
}
module.exports={createScanner};
