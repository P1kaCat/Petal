const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const migrations = [require('./migrations/001-preview.cjs'),require('./migrations/002-accounts.cjs'),require('./migrations/003-publication.cjs'),require('./migrations/004-storage.cjs')];
function migrate(db, steps=migrations) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, appliedAt TEXT NOT NULL)');
  for(const step of [...steps].sort((a,b)=>a.version-b.version)) {
    if(!Number.isSafeInteger(step.version)||step.version<1)throw new Error('Invalid migration version.');
    if(db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(step.version))continue;
    db.exec('BEGIN IMMEDIATE');
    try{
      step.apply(db);
      db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(step.version,new Date().toISOString());
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
}
function openDatabase(dataDir) {
  mkdirSync(dataDir,{recursive:true});
  const db=new DatabaseSync(path.join(dataDir,'catalog.sqlite'));
  try{db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');migrate(db);return db;}
  catch(error){db.close();throw error;}
}
module.exports={openDatabase,migrate};
