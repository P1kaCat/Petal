const http = require('node:http');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes, createHash, timingSafeEqual, scrypt } = require('node:crypto');
const { promisify } = require('node:util');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { DatabaseSync } = require('node:sqlite');
const yauzl = require('yauzl');
const { safeFilename } = require('../src/store.cjs');
const derive = promisify(scrypt);
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const text = (value, label, max = 200) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, `Invalid ${label}.`);
  return value.trim();
};
const matchId = value => /^[a-f0-9-]{36}$/.test(value);
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function validateJar(filename) {
  let zip;
  try {
    zip = await yauzl.openPromise(filename, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true });
    let count = 0, expanded = 0, descriptor = false;
    for await (const entry of zip.eachEntry()) {
      expanded += entry.uncompressedSize;
      if (++count > 30000 || expanded > 1024 * 1024 * 1024 || entry.isEncrypted()) fail(400, 'Archive is encrypted or exceeds archive limits.');
      if (['fabric.mod.json', 'META-INF/mods.toml', 'META-INF/neoforge.mods.toml', 'mcmod.info'].includes(entry.fileName)) descriptor = true;
      // Read each entry without extracting it; verify structure and declared sizes.
      if (!entry.fileName.endsWith('/')) {
        const stream = await zip.openReadStreamPromise(entry);
        for await (const chunk of stream) { void chunk; }
      }
    }
    if (!descriptor) fail(400, 'The JAR needs a Fabric, Forge, or NeoForge mod descriptor.');
  } catch (error) { if (error.status) throw error; fail(400, 'Invalid or damaged mod JAR archive.'); }
  finally { zip?.close(); }
}

async function createPetalServer(options = {}) {
  const root = path.resolve(options.dataDir || process.env.PETAL_API_DATA_DIR || path.join(__dirname, 'data'));
  await fs.mkdir(path.join(root, 'files'), { recursive: true });
  await fs.mkdir(path.join(root, 'incoming'), { recursive: true });
  let adminToken = options.adminToken || process.env.PETAL_ADMIN_TOKEN;
  if (!adminToken) {
    const secretFile = path.join(root, 'admin-token.txt');
    try { adminToken = (await fs.readFile(secretFile, 'utf8')).trim(); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      adminToken = randomBytes(32).toString('hex');
      await fs.writeFile(secretFile, adminToken + '\n', { flag: 'wx', mode: 0o600 });
    }
  }
  if (adminToken.length < 32) throw new Error('PETAL_ADMIN_TOKEN must contain at least 32 characters.');
  const db = new DatabaseSync(path.join(root, 'catalog.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, passwordHash TEXT NOT NULL, salt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, ownerId TEXT NOT NULL REFERENCES users(id), slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, license TEXT NOT NULL, sourceUrl TEXT NOT NULL, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL, gameVersions TEXT NOT NULL, loaders TEXT NOT NULL, dependencies TEXT NOT NULL, filename TEXT NOT NULL, status TEXT NOT NULL, sha512 TEXT, size INTEGER, createdAt TEXT NOT NULL, reviewedAt TEXT, reviewNote TEXT NOT NULL DEFAULT '', downloads INTEGER NOT NULL DEFAULT 0, rightsConfirmed INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS project_versions ON versions(projectId, status);
    CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires);`);
  let base = options.publicUrl || process.env.PETAL_PUBLIC_URL || '';
  if (base) {
    const url = new URL(base);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Public URL must be an HTTPS origin (HTTP loopback is allowed for development).');
    base = url.origin;
  }
  const maxUpload = options.maxUploadBytes || Number(process.env.PETAL_API_UPLOAD_MB || 64) * 1024 * 1024;
  const maxStorage = options.maxStorageBytes || Number(process.env.PETAL_API_STORAGE_MB || 2048) * 1024 * 1024;
  if (!Number.isSafeInteger(maxUpload) || !Number.isSafeInteger(maxStorage) || maxUpload < 1 || maxStorage < 1) throw new Error('Invalid upload or storage limits.');
  const activeUploads = new Set(), rates = new Map();
  let reservedBytes = 0;
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of rates) if (value.until < now) rates.delete(key);
    db.prepare('DELETE FROM sessions WHERE expires < ?').run(now);
  }, 60000).unref();
  const currentUsed = () => db.prepare('SELECT COALESCE(SUM(size), 0) AS bytes FROM versions').get().bytes;
  const userFor = req => {
    const token = /^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1];
    if (!token) return null;
    if (timingSafeEqual(Buffer.from(digest(token)), Buffer.from(digest(adminToken)))) return { id: 'admin', admin: true };
    return db.prepare('SELECT u.id, u.username FROM sessions s JOIN users u ON u.id=s.userId WHERE s.hash=? AND s.expires>?').get(digest(token), Date.now()) || null;
  };
  const requireUser = req => userFor(req) || fail(401, 'Sign in to continue.');
  const requireAdmin = req => { const u = requireUser(req); if (!u.admin) fail(403, 'Administrator access required.'); return u; };
  const ownProject = (req, id) => {
    const user = requireUser(req), p = db.prepare('SELECT * FROM projects WHERE id=?').get(id);
    if (!p) fail(404, 'Project not found.');
    if (!user.admin && p.ownerId !== user.id) fail(403, 'This project belongs to another author.');
    return p;
  };
  const versionView = row => ({ id: row.id, projectId: row.projectId, name: row.name, gameVersions: JSON.parse(row.gameVersions), loaders: JSON.parse(row.loaders), dependencies: JSON.parse(row.dependencies), status: row.status, createdAt: row.createdAt, reviewNote: row.reviewNote, rightsConfirmed: !!row.rightsConfirmed, downloads: row.downloads, file: row.sha512 ? { name: row.filename, size: row.size, hash: row.sha512, algorithm: 'sha512', url: `${base}/v1/versions/${row.id}/download` } : null });
  const projectView = row => ({ id: row.id, slug: row.slug, title: row.title, description: row.description, license: row.license, sourceUrl: row.sourceUrl, author: db.prepare('SELECT username FROM users WHERE id=?').get(row.ownerId).username, downloads: db.prepare("SELECT COALESCE(SUM(downloads),0) AS count FROM versions WHERE projectId=? AND status='published'").get(row.id).count, url: `${base}/projects/${row.id}` });
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  const body = async req => {
    if (!String(req.headers['content-type']).startsWith('application/json')) fail(415, 'Use application/json.');
    let length = 0; const chunks = [];
    for await (const chunk of req) { length += chunk.length; if (length > 65536) fail(413, 'Request body too large.'); chunks.push(chunk); }
    try { const value = JSON.parse(Buffer.concat(chunks)); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
    catch { fail(400, 'Invalid JSON object.'); }
  };
  const issueSession = user => {
    const token = randomBytes(32).toString('hex'), expires = Date.now() + 24 * 60 * 60 * 1000;
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(digest(token), user.id, expires);
    return { token, expires, user: { id: user.id, username: user.username } };
  };
  const limit = (req, auth = false) => {
    const key = `${auth ? 'auth' : 'read'}:${req.socket.remoteAddress}`;
    const now = Date.now(); let bucket = rates.get(key);
    if (!bucket || bucket.until < now) {
      if (rates.size > 10000) fail(503, 'Server busy.');
      bucket = { count: 0, until: now + (auth ? 15 * 60000 : 60000) }; rates.set(key, bucket);
    }
    if (++bucket.count > (auth ? 20 : 300)) fail(429, 'Too many requests. Try again later.');
  };

  const server = http.createServer({ requestTimeout: 120000, headersTimeout: 15000, maxHeaderSize: 16384 }, async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://localhost'), route = url.pathname;
      limit(req, route.startsWith('/v1/auth/'));
      if (req.headers.origin && req.headers.origin !== base && !['GET', 'HEAD'].includes(req.method)) fail(403, 'Cross-origin writes are not allowed.');
      if (req.method === 'GET' && route === '/health') return json(res, 200, { status: 'ok', service: 'Petal API', version: '1' });
      if (req.method === 'GET' && ['/', '/portal.js', '/portal.css'].includes(route)) {
        const filename = route === '/' ? 'index.html' : route.slice(1);
        const data = await fs.readFile(path.join(__dirname, 'public', filename));
        res.writeHead(200, { 'Content-Type': { 'index.html': 'text/html; charset=utf-8', 'portal.js': 'text/javascript; charset=utf-8', 'portal.css': 'text/css; charset=utf-8' }[filename] }); return res.end(data);
      }
      if (req.method === 'POST' && ['/v1/auth/register', '/v1/auth/login'].includes(route)) {
        const data = await body(req), username = text(data.username, 'username', 40).toLowerCase();
        if (!/^[a-z0-9_-]{3,40}$/.test(username) || typeof data.password !== 'string' || data.password.length < 12 || data.password.length > 256) fail(400, 'Use a 3–40 character username and a 12–256 character password.');
        const existing = db.prepare('SELECT * FROM users WHERE username=?').get(username);
        if (route.endsWith('/register')) {
          if (existing) fail(409, 'Username already registered.');
          const salt = randomBytes(16).toString('hex'), hash = (await derive(data.password, salt, 64)).toString('hex');
          const id = randomUUID();
          try { db.prepare('INSERT INTO users VALUES (?,?,?,?)').run(id, username, hash, salt); }
          catch { fail(409, 'Username already registered.'); }
          return json(res, 201, issueSession({ id, username }));
        }
        const hash = await derive(data.password, existing?.salt || 'petal-invalid-user', 64);
        if (!existing || !timingSafeEqual(hash, Buffer.from(existing.passwordHash, 'hex'))) fail(401, 'Invalid username or password.');
        return json(res, 200, issueSession(existing));
      }
      if (req.method === 'POST' && route === '/v1/auth/logout') {
        requireUser(req); db.prepare('DELETE FROM sessions WHERE hash=?').run(digest((req.headers.authorization || '').slice(7)));
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && route === '/v1/me/projects') {
        const user = requireUser(req);
        return json(res, 200, { projects: db.prepare('SELECT * FROM projects WHERE ownerId=? ORDER BY createdAt DESC').all(user.id).map(projectView) });
      }
      if (req.method === 'POST' && route === '/v1/projects') {
        const user = requireUser(req); if (user.admin) fail(400, 'Create projects using an author account.');
        const data = await body(req), slug = text(data.slug, 'slug', 80).toLowerCase();
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) fail(400, 'Use lowercase letters, numbers, and single hyphens for the slug.');
        const title = text(data.title, 'title', 120), description = text(data.description, 'description', 4000), license = text(data.license, 'mod license', 500);
        let sourceUrl = '';
        if (data.sourceUrl) {
          let u;
          try { u = new URL(text(data.sourceUrl, 'source URL', 500)); }
          catch { fail(400, 'Invalid source URL.'); }
          if (u.protocol !== 'https:' || u.username || u.password) fail(400, 'Source URL must use HTTPS.'); sourceUrl = u.href;
        }
        if (db.prepare('SELECT COUNT(*) AS n FROM projects WHERE ownerId=?').get(user.id).n >= 100) fail(409, 'Author project limit reached.');
        if (db.prepare('SELECT id FROM projects WHERE slug=?').get(slug)) fail(409, 'Slug already in use.');
        const id = randomUUID(); db.prepare('INSERT INTO projects VALUES (?,?,?,?,?,?,?,?)').run(id, user.id, slug, title, description, license, sourceUrl, new Date().toISOString());
        return json(res, 201, projectView(db.prepare('SELECT * FROM projects WHERE id=?').get(id)));
      }
      if (req.method === 'GET' && route === '/v1/search') {
        const q = (url.searchParams.get('q') || '').slice(0, 200).replace(/[\\%_]/g, '\\$&');
        const offset = Math.min(100000, Math.max(0, Number(url.searchParams.get('offset')) || 0));
        const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 20));
        if (!Number.isInteger(offset) || !Number.isInteger(pageSize)) fail(400, 'Invalid pagination.');
        const params = [`%${q}%`, `%${q}%`];
        let filters = "v.projectId=p.id AND v.status='published'";
        for (const [parameter, column] of [['version', 'gameVersions'], ['loader', 'loaders']]) {
          if (url.searchParams.has(parameter)) { filters += ` AND EXISTS (SELECT 1 FROM json_each(v.${column}) WHERE value=?)`; params.push(url.searchParams.get(parameter)); }
        }
        const where = `WHERE (p.title LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\') AND EXISTS(SELECT 1 FROM versions v WHERE ${filters})`;
        const total = db.prepare(`SELECT COUNT(*) AS n FROM projects p ${where}`).get(...params).n;
        const projects = db.prepare(`SELECT p.* FROM projects p ${where} ORDER BY p.createdAt DESC, p.id LIMIT ? OFFSET ?`).all(...params, pageSize, offset).map(projectView);
        return json(res, 200, { projects, total, offset, hasMore: total > offset + pageSize });
      }
      const projectRoute = /^\/v1\/projects\/([a-f0-9-]{36})(?:\/(versions))?$/.exec(route);
      if (projectRoute) {
        const id = projectRoute[1], p = db.prepare('SELECT * FROM projects WHERE id=?').get(id);
        if (!p) fail(404, 'Project not found.');
        const user = userFor(req), owner = user?.admin || user?.id === p.ownerId;
        if (req.method === 'GET') {
          const rows = db.prepare(`SELECT * FROM versions WHERE projectId=? ${owner ? '' : "AND status='published'"} ORDER BY createdAt DESC, id DESC`).all(id);
          if (!owner && !rows.length) fail(404, 'Project not found.');
          return json(res, 200, projectRoute[2] ? { versions: rows.map(versionView) } : projectView(p));
        }
        if (req.method === 'POST' && projectRoute[2]) {
          ownProject(req, id); const data = await body(req);
          const name = text(data.name, 'version name', 100);
          const gameVersions = data.gameVersions, loaders = data.loaders;
          if (!Array.isArray(gameVersions) || !gameVersions.length || gameVersions.length > 30 || gameVersions.some(v => typeof v !== 'string' || !/^\d+\.\d+(\.\d+)?$/.test(v))) fail(400, 'List supported Minecraft release versions.');
          if (!Array.isArray(loaders) || !loaders.length || loaders.length > 3 || loaders.some(v => !['fabric', 'forge', 'neoforge'].includes(v))) fail(400, 'List supported mod loaders.');
          if (data.rightsConfirmed !== true) fail(400, 'Confirm that you own this mod or have permission to distribute it.');
          let filename;
          try { filename = safeFilename(data.filename); } catch { fail(400, 'Invalid mod filename.'); }
          const dependencies = data.dependencies || [];
          if (!Array.isArray(dependencies) || dependencies.length > 30) fail(400, 'Invalid dependencies.');
          const normalized = dependencies.map(d => {
            if (!d || !matchId(d.id) || d.id === id || (d.versionId && !matchId(d.versionId)) || !db.prepare('SELECT id FROM projects WHERE id=?').get(d.id)) fail(400, 'Dependency must reference another Petal project.');
            if (d.versionId && !db.prepare('SELECT id FROM versions WHERE id=? AND projectId=?').get(d.versionId, d.id)) fail(400, 'Invalid pinned dependency version.');
            return { source: 'petal', id: d.id, ...(d.versionId ? { versionId: d.versionId } : {}) };
          });
          if (db.prepare('SELECT COUNT(*) AS n FROM versions WHERE projectId=?').get(id).n >= 500) fail(409, 'Project version limit reached.');
          const versionId = randomUUID();
          db.prepare('INSERT INTO versions (id,projectId,name,gameVersions,loaders,dependencies,filename,status,createdAt,rightsConfirmed) VALUES (?,?,?,?,?,?,?,?,?,?)').run(versionId, id, name, JSON.stringify(gameVersions), JSON.stringify(loaders), JSON.stringify(normalized), filename, 'draft', new Date().toISOString(), 1);
          return json(res, 201, versionView(db.prepare('SELECT * FROM versions WHERE id=?').get(versionId)));
        }
      }
      const versionRoute = /^\/v1\/versions\/([a-f0-9-]{36})(?:\/(file|download))?$/.exec(route);
      if (versionRoute) {
        const id = versionRoute[1], v = db.prepare('SELECT * FROM versions WHERE id=?').get(id);
        if (!v) fail(404, 'Version not found.');
        if (req.method === 'PUT' && versionRoute[2] === 'file') {
          ownProject(req, v.projectId);
          if (v.status !== 'draft') fail(409, 'This version has already been submitted. Create a new version instead.');
          if (activeUploads.has(id) || activeUploads.size >= 4) fail(409, 'An upload is already in progress. Try again later.');
          const length = Number(req.headers['content-length']);
          if (!Number.isSafeInteger(length) || length < 1) fail(411, 'A positive Content-Length is required.');
          if (length > maxUpload) fail(413, 'Mod file exceeds the upload limit.');
          if (currentUsed() + reservedBytes + length > maxStorage) fail(507, 'Storage quota exceeded.');
          if (!['application/java-archive', 'application/octet-stream'].includes(req.headers['content-type'])) fail(415, 'Upload a raw JAR file.');
          activeUploads.add(id); reservedBytes += length;
          const temporary = path.join(root, 'incoming', randomUUID()), destination = path.join(root, 'files', id + '.jar');
          let committed = false, size = 0; const hash = createHash('sha512');
          try {
            const handle = await fs.open(temporary, 'wx', 0o600);
            const measure = new Transform({ transform(chunk, _encoding, cb) {
              size += chunk.length;
              if (size > length || size > maxUpload) return cb(Object.assign(new Error('Upload size exceeded.'), { status: 413 }));
              hash.update(chunk); cb(null, chunk);
            } });
            await pipeline(req, measure, handle.createWriteStream());
            if (size !== length) fail(400, 'Incomplete upload.');
            await validateJar(temporary);
            await fs.rename(temporary, destination);
            db.prepare("UPDATE versions SET status='pending',sha512=?,size=? WHERE id=? AND status='draft'").run(hash.digest('hex'), size, id);
            committed = true;
            return json(res, 200, versionView(db.prepare('SELECT * FROM versions WHERE id=?').get(id)));
          } finally {
            activeUploads.delete(id); reservedBytes -= length;
            await fs.rm(temporary, { force: true }); if (!committed) await fs.rm(destination, { force: true });
          }
        }
        if (req.method === 'GET') {
          if (v.status !== 'published') ownProject(req, v.projectId);
          if (versionRoute[2] === 'download') {
            if (!v.sha512) fail(404, 'File not uploaded.');
            const filename = path.join(root, 'files', id + '.jar');
            await fs.access(filename);
            res.writeHead(200, { 'Content-Type': 'application/java-archive', 'Content-Length': v.size, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(v.filename)}`, 'Cache-Control': 'no-store', 'X-Checksum-SHA512': v.sha512 });
            await pipeline(createReadStream(filename), res);
            if (v.status === 'published') db.prepare('UPDATE versions SET downloads=downloads+1 WHERE id=?').run(id);
            return;
          }
          if (!versionRoute[2]) return json(res, 200, versionView(v));
        }
      }
      if (req.method === 'GET' && route === '/v1/admin/reviews') {
        requireAdmin(req); const status = url.searchParams.get('status') || 'pending';
        if (!['pending', 'published', 'rejected'].includes(status)) fail(400, 'Invalid review status.');
        const versions = db.prepare('SELECT * FROM versions WHERE status=? ORDER BY createdAt DESC LIMIT 100').all(status).map(v => ({ ...versionView(v), project: projectView(db.prepare('SELECT * FROM projects WHERE id=?').get(v.projectId)) }));
        return json(res, 200, { versions });
      }
      const moderation = /^\/v1\/admin\/versions\/([a-f0-9-]{36})\/review$/.exec(route);
      if (req.method === 'POST' && moderation) {
        requireAdmin(req); const data = await body(req), v = db.prepare('SELECT * FROM versions WHERE id=?').get(moderation[1]);
        if (!v || !['pending', 'published', 'rejected'].includes(v.status) || !v.sha512) fail(409, 'No submitted file to review.');
        if (!['approve', 'reject'].includes(data.action)) fail(400, 'Use approve or reject.');
        const note = data.action === 'reject' ? text(data.note, 'rejection reason', 2000) : String(data.note || '').slice(0, 2000);
        db.prepare('UPDATE versions SET status=?,reviewNote=?,reviewedAt=? WHERE id=?').run(data.action === 'approve' ? 'published' : 'rejected', note, new Date().toISOString(), v.id);
        return json(res, 200, versionView(db.prepare('SELECT * FROM versions WHERE id=?').get(v.id)));
      }
      const pageRoute = /^\/projects\/([a-f0-9-]{36})$/.exec(route);
      if (req.method === 'GET' && pageRoute) {
        const p = db.prepare("SELECT p.* FROM projects p WHERE p.id=? AND EXISTS(SELECT 1 FROM versions v WHERE v.projectId=p.id AND v.status='published')").get(pageRoute[1]);
        if (!p) fail(404, 'Project not found.');
        const project = projectView(p), versions = db.prepare("SELECT * FROM versions WHERE projectId=? AND status='published' ORDER BY createdAt DESC").all(p.id).map(versionView);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/portal.css"><title>${escapeHTML(p.title)} · Petal</title><main><a href="/">✿ Petal</a><h1>${escapeHTML(p.title)}</h1><p>By ${escapeHTML(project.author)} · License: ${escapeHTML(p.license)}</p><p>${escapeHTML(p.description)}</p>${p.sourceUrl ? `<a href="${escapeHTML(p.sourceUrl)}">Source / author website ↗</a>` : ''}<h2>Published versions</h2>${versions.map(v => `<article><h3>${escapeHTML(v.name)}</h3><p>Minecraft ${escapeHTML(v.gameVersions.join(', '))} · ${escapeHTML(v.loaders.join(', '))}</p><a href="${escapeHTML(v.file.url)}">Download ${escapeHTML(v.file.name)}</a></article>`).join('')}</main></html>`);
      }
      fail(404, 'Endpoint not found.');
    } catch (error) {
      if (res.headersSent || res.destroyed) { if (!res.destroyed) res.destroy(); return; }
      const status = error.status || 500;
      if (status >= 500 && status !== 507) console.error('Petal API request failed:', error.code || error.name);
      json(res, status, { error: status === 500 ? 'Internal server error.' : error.message });
    }
  });
  server.on('listening', () => { if (!base) base = `http://127.0.0.1:${server.address().port}`; });
  server.on('close', () => { clearInterval(sweep); db.close(); });
  server.maxConnections = 200;
  return { server, root, db, get publicUrl() { return base; } };
}

if (require.main === module) {
  createPetalServer().then(({ server, root }) => {
    const host = process.env.PETAL_API_HOST || '127.0.0.1', port = Number(process.env.PETAL_API_PORT || 4318);
    if (host !== '127.0.0.1' && host !== 'localhost' && !process.env.PETAL_PUBLIC_URL) throw new Error('Set PETAL_PUBLIC_URL before listening beyond loopback.');
    server.listen(port, host, () => console.log(`Petal API listening on ${host}:${port}. Portal: ${process.env.PETAL_PUBLIC_URL || `http://127.0.0.1:${port}`}. Local admin token: ${path.join(root, 'admin-token.txt')} (unless supplied through the environment).`));
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
  }).catch(error => { console.error(error.message); process.exit(1); });
}
module.exports = { createPetalServer, validateJar };
