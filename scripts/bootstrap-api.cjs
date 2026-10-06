const path=require('node:path');
const {openDatabase}=require('../api/db.cjs');
const {randomUUID}=require('node:crypto');
function bootstrap(db,username){
  db.exec('BEGIN IMMEDIATE');try{
    if(db.prepare("SELECT 1 FROM operator_settings WHERE key='bootstrap'").get())throw new Error('Operator bootstrap has already been used.');
    const user=db.prepare('SELECT * FROM users WHERE username=?').get(username);
    if(!user||!user.emailVerified||!user.mfaSecret)throw new Error('First create an account, verify its email and enable MFA.');
    db.prepare("UPDATE users SET roles='[\"admin\"]' WHERE id=?").run(user.id);
    db.prepare("INSERT INTO operator_settings VALUES('bootstrap',?)").run(user.id);
    db.prepare('DELETE FROM sessions WHERE userId=?').run(user.id);
    db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run(randomUUID(),user.id,'operator.bootstrap',null,Date.now());
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
}
if(require.main===module){
  const username=process.argv[2];if(!username||! /^[a-z0-9_-]{3,40}$/.test(username)){console.error('Usage: node scripts/bootstrap-api.cjs USERNAME');process.exitCode=1;}
  else{const db=openDatabase(path.resolve(process.env.PETAL_API_DATA_DIR||path.join(__dirname,'../api/data')));try{bootstrap(db,username);console.log('Administrator initialized. Sign in again with MFA. Legacy operator token disabled.');}catch(error){console.error(error.message);process.exitCode=1;}finally{db.close();}}
}
module.exports={bootstrap};
