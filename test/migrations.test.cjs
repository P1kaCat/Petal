const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {migrate}=require('../api/db.cjs');
test('adopting a preview database preserves passwords, ownership and published-file hashes on repeated migration',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec('CREATE TABLE users (id TEXT PRIMARY KEY,username TEXT,passwordHash TEXT,salt TEXT);CREATE TABLE projects (id TEXT PRIMARY KEY,ownerId TEXT,title TEXT);CREATE TABLE versions(id TEXT PRIMARY KEY,projectId TEXT,sha512 TEXT,status TEXT)');
    db.prepare('INSERT INTO users VALUES (?,?,?,?)').run('author','alice','original-hash','original-salt');
    db.prepare('INSERT INTO projects VALUES (?,?,?)').run('project','author','Original');
    db.prepare('INSERT INTO versions VALUES (?,?,?,?)').run('version','project','immutable-file-hash','published');
    migrate(db);migrate(db);
    assert.equal(db.prepare('SELECT passwordHash FROM users').get().passwordHash,'original-hash');
    assert.equal(db.prepare('SELECT ownerId FROM projects').get().ownerId,'author');
    assert.equal(db.prepare('SELECT sha512 FROM versions').get().sha512,'immutable-file-hash');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n,5);
  }finally{db.close();}
});
test('a failed schema migration rolls back both changes and its version marker',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    migrate(db);
    assert.throws(()=>migrate(db,[{version:6,apply(db){db.exec('CREATE TABLE partial_change(id TEXT)');throw new Error('migration failure');}}]),/migration failure/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='partial_change'").get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE version=6').get().n,0);
  }finally{db.close();}
});
