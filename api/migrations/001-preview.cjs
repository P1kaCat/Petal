module.exports = { version: 1, apply(db) { db.exec(`
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, passwordHash TEXT NOT NULL, salt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, ownerId TEXT NOT NULL REFERENCES users(id), slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, license TEXT NOT NULL, sourceUrl TEXT NOT NULL, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL, gameVersions TEXT NOT NULL, loaders TEXT NOT NULL, dependencies TEXT NOT NULL, filename TEXT NOT NULL, status TEXT NOT NULL, sha512 TEXT, size INTEGER, createdAt TEXT NOT NULL, reviewedAt TEXT, reviewNote TEXT NOT NULL DEFAULT '', downloads INTEGER NOT NULL DEFAULT 0, rightsConfirmed INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS project_versions ON versions(projectId, status);
    CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires);`); } };
