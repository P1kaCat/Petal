module.exports={version:2,apply(db){
  db.exec(`ALTER TABLE users ADD COLUMN email TEXT;
    ALTER TABLE users ADD COLUMN emailVerified INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN roles TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE users ADD COLUMN scryptParams TEXT NOT NULL DEFAULT '{"N":16384,"r":8,"p":1}';
    ALTER TABLE users ADD COLUMN mfaSecret TEXT;
    ALTER TABLE users ADD COLUMN mfaPending TEXT;
    ALTER TABLE users ADD COLUMN mfaPendingUntil INTEGER;
    ALTER TABLE users ADD COLUMN mfaLastStep INTEGER NOT NULL DEFAULT -1;
    CREATE UNIQUE INDEX users_email ON users(email) WHERE email IS NOT NULL;
    ALTER TABLE sessions ADD COLUMN id TEXT;
    ALTER TABLE sessions ADD COLUMN csrf TEXT;
    ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'bearer';
    ALTER TABLE sessions ADD COLUMN mfa INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE sessions ADD COLUMN createdAt INTEGER NOT NULL DEFAULT 0;
    CREATE UNIQUE INDEX sessions_id ON sessions(id) WHERE id IS NOT NULL;
    CREATE TABLE account_tokens(hash TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE INDEX account_token_users ON account_tokens(userId,kind);
    CREATE TABLE recovery_codes(hash TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES users(id));
    CREATE TABLE operator_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE audit(id TEXT PRIMARY KEY,actorId TEXT,action TEXT NOT NULL,targetId TEXT,createdAt INTEGER NOT NULL);
  `);
  // Preserve existing bearer credentials while making migrated sessions individually revocable.
  const {randomUUID,randomBytes}=require('node:crypto');
  for(const session of db.prepare('SELECT hash FROM sessions WHERE id IS NULL').all())db.prepare('UPDATE sessions SET id=?,csrf=? WHERE hash=?').run(randomUUID(),randomBytes(32).toString('hex'),session.hash);
}};
