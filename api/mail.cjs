const fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID}=require('node:crypto');
function createMail({root,publicMode,getBase}){
  const smtp=process.env.PETAL_SMTP_HOST;
  let transporter;
  if(smtp){
    const port=Number(process.env.PETAL_SMTP_PORT||465);
    if(!Number.isInteger(port)||port<1||port>65535||!process.env.PETAL_MAIL_FROM)throw new Error('Configure SMTP port and PETAL_MAIL_FROM.');
    transporter=require('nodemailer').createTransport({host:smtp,port,secure:port===465,requireTLS:port!==465,auth:process.env.PETAL_SMTP_USER?{user:process.env.PETAL_SMTP_USER,pass:process.env.PETAL_SMTP_PASSWORD}:undefined,connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000});
  }
  return {available:!!transporter||!publicMode,async send({to,template,variables}){
    const label=template==='verify'?'Verify your Petal email':'Reset your Petal password';
    const link=`${getBase()}/account#${template}=${encodeURIComponent(variables.token)}`;
    const message={to,subject:label,text:`${label}\n\n${link}\n\nIf you did not request this, ignore this message. This link can only be used once.`};
    if(transporter){await transporter.sendMail({...message,from:process.env.PETAL_MAIL_FROM});return;}
    if(publicMode)throw new Error('Email delivery is unavailable.');
    const outbox=path.join(root,'mail-outbox');await fs.mkdir(outbox,{recursive:true,mode:0o700});
    await fs.writeFile(path.join(outbox,randomUUID()+'.json'),JSON.stringify(message,null,2),{flag:'wx',mode:0o600});
  }};
}
module.exports={createMail};
