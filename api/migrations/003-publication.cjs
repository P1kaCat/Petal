module.exports={version:3,apply(db){db.exec(`
  ALTER TABLE projects ADD COLUMN revisionId TEXT;
  ALTER TABLE projects ADD COLUMN iconId TEXT;
  ALTER TABLE projects ADD COLUMN gallery TEXT NOT NULL DEFAULT '[]';
  CREATE TABLE revisions(id TEXT PRIMARY KEY,projectId TEXT NOT NULL REFERENCES projects(id),actorId TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL,content TEXT NOT NULL,baseRevisionId TEXT,createdAt TEXT NOT NULL);
  CREATE INDEX revision_queue ON revisions(status,createdAt,id);
  CREATE TABLE decisions(id TEXT PRIMARY KEY,revisionId TEXT NOT NULL REFERENCES revisions(id),action TEXT NOT NULL,reason TEXT NOT NULL,actorId TEXT NOT NULL,createdAt TEXT NOT NULL);
  CREATE TABLE members(projectId TEXT NOT NULL REFERENCES projects(id),userId TEXT NOT NULL REFERENCES users(id),role TEXT NOT NULL,status TEXT NOT NULL,PRIMARY KEY(projectId,userId));
  CREATE TABLE reports(id TEXT PRIMARY KEY,reporterId TEXT NOT NULL REFERENCES users(id),projectId TEXT NOT NULL REFERENCES projects(id),reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',resolution TEXT NOT NULL DEFAULT '',createdAt TEXT NOT NULL);
  CREATE TABLE images(id TEXT PRIMARY KEY,projectId TEXT NOT NULL REFERENCES projects(id),ownerId TEXT NOT NULL REFERENCES users(id),size INTEGER NOT NULL,createdAt TEXT NOT NULL);
`);}};
