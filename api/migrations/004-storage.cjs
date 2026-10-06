module.exports={version:4,apply(db){db.exec(`
  ALTER TABLE versions ADD COLUMN uploadedBy TEXT REFERENCES users(id);
  ALTER TABLE versions ADD COLUMN storageKey TEXT;
  ALTER TABLE versions ADD COLUMN scanStatus TEXT NOT NULL DEFAULT 'unscanned';
  UPDATE versions SET uploadedBy=(SELECT ownerId FROM projects WHERE id=versions.projectId),storageKey=id||'.jar' WHERE sha512 IS NOT NULL;
  CREATE TABLE upload_reservations(id TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES users(id),versionId TEXT REFERENCES versions(id),size INTEGER NOT NULL,expiresAt INTEGER NOT NULL,kind TEXT NOT NULL);
  CREATE UNIQUE INDEX reserved_version ON upload_reservations(versionId) WHERE versionId IS NOT NULL;
`);}};
