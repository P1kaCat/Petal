module.exports={version:7,apply(db){db.exec(`
CREATE TABLE follows(id TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES users(id),projectId TEXT NOT NULL REFERENCES projects(id),createdAt TEXT NOT NULL,UNIQUE(userId,projectId));
CREATE TABLE collections(id TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,createdAt TEXT NOT NULL);
CREATE TABLE collection_items(id TEXT PRIMARY KEY,collectionId TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,projectId TEXT NOT NULL REFERENCES projects(id),createdAt TEXT NOT NULL,UNIQUE(collectionId,projectId));
CREATE TABLE notification_preferences(userId TEXT PRIMARY KEY REFERENCES users(id),releaseUpdates INTEGER NOT NULL DEFAULT 1 CHECK(releaseUpdates IN (0,1)));
CREATE TABLE notifications(id TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES users(id),projectId TEXT NOT NULL REFERENCES projects(id),versionId TEXT REFERENCES versions(id),revisionId TEXT REFERENCES revisions(id),eventKey TEXT NOT NULL,title TEXT NOT NULL,createdAt TEXT NOT NULL,readAt TEXT,UNIQUE(userId,eventKey));
CREATE INDEX notifications_user ON notifications(userId,createdAt,id);
CREATE INDEX follows_project ON follows(projectId);
`);}};
