const http = require('node:http');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { openDatabase } = require('./db.cjs');
const { fail, json, body } = require('./http.cjs');
const { projectPage, authorPage } = require('./public-pages.cjs');
const {validateArchive}=require('./archives.cjs');
const {createStorage}=require('./storage.cjs');
const {createScanner}=require('./scanner.cjs');
const { safeFilename } = require('../src/store.cjs');
const { MinecraftMetadata, validVersionId } = require('../src/minecraft-metadata.cjs');
const {createAuth}=require('./auth.cjs');
const {createAccounts}=require('./accounts.cjs');
const {createMail}=require('./mail.cjs');
const {createAccountRoutes}=require('./routes/auth.cjs');
const {createProjects}=require('./projects.cjs');
const {createModeration}=require('./moderation.cjs');
const {createProjectRoutes}=require('./routes/projects.cjs');
const {createTokens}=require('./tokens.cjs');
const {page}=require('./pagination.cjs');
const {createReadiness}=require('./operations.cjs');
const text = (value, label, max = 200) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, `Invalid ${label}.`);
  return value.trim();
};
const matchId = value => /^[a-f0-9-]{36}$/.test(value);
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const validateJar=filename=>validateArchive(filename,'mod');

async function createPetalServer(options = {}) {
  const root = path.resolve(options.dataDir || process.env.PETAL_API_DATA_DIR || path.join(__dirname, 'data'));
  const metadata = options.metadata || new MinecraftMetadata({cacheFile:path.join(root,'minecraft-versions.json')});
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
  const db = openDatabase(root);
  let base = options.publicUrl || process.env.PETAL_PUBLIC_URL || '';
  if (base) {
    const url = new URL(base);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Public URL must be an HTTPS origin (HTTP loopback is allowed for development).');
    base = url.origin;
  }
  const publicMode=base.startsWith('https:'),now=options.now||Date.now;
  let mfaKey=process.env.PETAL_MFA_KEY;
  if(mfaKey&&!/^[a-f0-9]{64}$/i.test(mfaKey))throw new Error('PETAL_MFA_KEY must be a 32-byte hex key.');
  if(!mfaKey){const keyFile=path.join(root,'mfa-key.txt');try{mfaKey=(await fs.readFile(keyFile,'utf8')).trim();}catch(error){if(error.code!=='ENOENT')throw error;mfaKey=randomBytes(32).toString('hex');await fs.writeFile(keyFile,mfaKey+'\n',{flag:'wx',mode:0o600});}}
  if(!/^[a-f0-9]{64}$/i.test(mfaKey))throw new Error('Invalid stored MFA encryption key.');
  const mail=options.mail||createMail({root,publicMode,getBase:()=>base});
  const accounts=createAccounts({db,mail,publicMode,key:Buffer.from(mfaKey,'hex'),now});
  const auth=createAuth({db,adminToken,publicMode,now});
  const tokens=createTokens({db,now});
  const accountRoutes=createAccountRoutes({db,accounts,auth,tokens,publicMode,now});
  const projects=createProjects({db,auth});
  const moderationService=createModeration({db,auth,projects});
  const maxUpload = options.maxUploadBytes || Number(process.env.PETAL_API_UPLOAD_MB || 64) * 1024 * 1024;
  const maxStorage = options.maxStorageBytes || Number(process.env.PETAL_API_STORAGE_MB || 2048) * 1024 * 1024;
  if (!Number.isSafeInteger(maxUpload) || !Number.isSafeInteger(maxStorage) || maxUpload < 1 || maxStorage < 1) throw new Error('Invalid upload or storage limits.');
  const maxAuthor=options.maxAuthorBytes||Number(process.env.PETAL_API_AUTHOR_MB||256)*1048576;
  const storage=createStorage({db,root,maxUpload,maxStorage,maxAuthor,now});
  await storage.collectAbandoned({restart:true});
  const scanner=options.scanner||createScanner();
  const reviewPolicy=options.reviewPolicy||process.env.PETAL_REVIEW_POLICY||(publicMode?'scanner':'local-manual');
  if(!['scanner','manual','local-manual'].includes(reviewPolicy)||publicMode&&reviewPolicy==='local-manual')throw new Error('Invalid review policy.');
  const projectRoutes=createProjectRoutes({db,root,auth,projects,storage,moderation:moderationService});
  const readiness=createReadiness({db,root,dbCheck:options.dbCheck,publicMode,mail,scanner,reviewPolicy});
  const rates = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of rates) if (value.until < now) rates.delete(key);
    db.prepare('DELETE FROM sessions WHERE expires < ?').run(now);
    db.prepare('DELETE FROM account_tokens WHERE expires < ?').run(now);
  }, 60000).unref();
  const userFor = auth.authenticate;
  const requireUser = req => userFor(req) || fail(401, 'Sign in to continue.');
  const requireAdmin = req => { const u = requireUser(req); auth.requirePermission(u,'moderate'); return u; };
  const ownProject = (req, id) => {
    return projects.requireAccess(requireUser(req),id,req.method==='GET'?'read':'write');
  };
  const versionView = (row,privateView=false) => ({ id: row.id, projectId: row.projectId, name: row.name, gameVersions: JSON.parse(row.gameVersions), loaders: JSON.parse(row.loaders), dependencies: JSON.parse(row.dependencies), status: row.status, createdAt: row.createdAt, ...(privateView===true?{reviewNote:row.reviewNote,scanStatus:row.scanStatus}:{}), rightsConfirmed: !!row.rightsConfirmed, downloads: row.downloads, file: row.sha512 ? { name: row.filename, size: row.size, hash: row.sha512, algorithm: 'sha512', url: `${base}/v1/versions/${row.id}/download` } : null });
  const projectView = row => ({ id: row.id, slug: row.slug, title: row.title, description: row.description, license: row.license, sourceUrl: row.sourceUrl, author: db.prepare('SELECT username FROM users WHERE id=?').get(row.ownerId).username, downloads: db.prepare("SELECT COALESCE(SUM(downloads),0) AS count FROM versions WHERE projectId=? AND status='published'").get(row.id).count, url: `${base}/projects/${row.id}`, revisionId:row.revisionId, iconUrl:row.iconId?'/media/'+row.iconId:null,gallery:JSON.parse(row.gallery).map(id=>'/media/'+id) });
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
    const requestId=randomUUID();res.setHeader('X-Request-ID',requestId);let requestPath='/';
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    if(publicMode)res.setHeader('Strict-Transport-Security','max-age=31536000');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://localhost'), route = url.pathname;
      requestPath=route;
      limit(req, route.startsWith('/v1/auth/') || route.includes('/mfa/') || route==='/v1/me/email');
      if (req.headers.origin && req.headers.origin !== base && !['GET', 'HEAD'].includes(req.method)) fail(403, 'Cross-origin writes are not allowed.');
      if(req.headers['sec-fetch-site']==='cross-site'&&!['GET','HEAD'].includes(req.method))fail(403,'Cross-origin writes are not allowed.');
      auth.validateCSRF(req);
      auth.validateScopes(req,route);
      if(await accountRoutes(req,res,route,url))return;
      if(await projectRoutes(req,res,route,url))return;
      if (req.method === 'GET' && route === '/health') return json(res, 200, { status: 'ok', service: 'Petal API', version: '1' });
      if(req.method==='GET'&&route==='/ready'){const result=await readiness();return json(res,result.ready?200:503,{status:result.status,checks:result.checks});}
      if(req.method==='GET'&&route==='/openapi.yaml'){res.writeHead(200,{'Content-Type':'application/yaml; charset=utf-8'});return res.end(await fs.readFile(path.join(__dirname,'openapi.yaml')));}
      if (req.method === 'GET' && route === '/v1/game/versions') return json(res,200,await metadata.versions());
      const assets={'/':'discover.html','/discover':'discover.html','/dashboard':'index.html','/account':'account.html','/api':'api-docs.html','/account.js':'account.js','/portal.js':'portal.js','/portal.css':'portal.css','/site.js':'site.js','/project.js':'project.js','/site.css':'site.css','/favicon.svg':'favicon.svg','/minecraft-panorama.png':'../src/assets/minecraft-cherry-panorama.png'};
      if (req.method === 'GET' && Object.hasOwn(assets,route)) {
        const filename=assets[route];
        const data=await fs.readFile(route==='/minecraft-panorama.png'?path.join(__dirname,filename):path.join(__dirname,'public',filename));
        const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'}[path.extname(filename)];
        res.writeHead(200,{'Content-Type':mime});return res.end(data);
      }
      if (req.method === 'GET' && route === '/v1/me/projects') {
        const user = requireUser(req);
        const result=page(db,"SELECT * FROM projects WHERE (ownerId=? OR EXISTS(SELECT 1 FROM members m WHERE m.projectId=projects.id AND m.userId=? AND m.status='accepted'))",[user.id,user.id],url);
        result.items=result.items.map(row=>({...projectView(row),teamRole:projects.role(user,row)}));return json(res,200,{...result,projects:result.items});
      }
      if (req.method === 'POST' && route === '/v1/projects') {
        const user = requireUser(req); auth.requirePermission(user,'publish'); if (user.localOperator) fail(400, 'Create projects using an author account.');
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
        const id = randomUUID(); db.prepare('INSERT INTO projects(id,ownerId,slug,title,description,license,sourceUrl,createdAt) VALUES (?,?,?,?,?,?,?,?)').run(id, user.id, slug, title, description, license, sourceUrl, new Date().toISOString());
        return json(res, 201, projectView(db.prepare('SELECT * FROM projects WHERE id=?').get(id)));
      }
      if (req.method === 'GET' && route === '/v1/search') {
        const sort=url.searchParams.get('sort')||'newest';
        if(!['newest','downloads'].includes(sort))fail(400,'Invalid search sort.');
        const q = (url.searchParams.get('q') || '').slice(0, 200).replace(/[\\%_]/g, '\\$&');
        const offset = Number(url.searchParams.get('offset')??0),pageSize=Number(url.searchParams.get('limit')??20);
        if (!Number.isSafeInteger(offset)||offset<0||offset>100000||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100) fail(400, 'Invalid pagination.');
        const params = [`%${q}%`, `%${q}%`];
        let filters = "v.projectId=p.id AND v.status='published'";
        for (const [parameter, column] of [['version', 'gameVersions'], ['loader', 'loaders']]) {
          if (url.searchParams.has(parameter)) { filters += ` AND EXISTS (SELECT 1 FROM json_each(v.${column}) WHERE value=?)`; params.push(url.searchParams.get(parameter)); }
        }
        const where = `WHERE (p.title LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\') AND EXISTS(SELECT 1 FROM versions v WHERE ${filters})`;
        const total = db.prepare(`SELECT COUNT(*) AS n FROM projects p ${where}`).get(...params).n;
        const order=sort==='downloads'?"(SELECT COALESCE(SUM(v2.downloads),0) FROM versions v2 WHERE v2.projectId=p.id AND v2.status='published') DESC,p.createdAt DESC,p.id":"p.createdAt DESC,p.id";
        const projects = db.prepare(`SELECT p.* FROM projects p ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, pageSize, offset).map(projectView);
        return json(res, 200, { projects, total, offset, hasMore: total > offset + pageSize });
      }
      const projectRoute = /^\/v1\/projects\/([a-f0-9-]{36})(?:\/(versions))?$/.exec(route);
      if (projectRoute) {
        const id = projectRoute[1], p = db.prepare('SELECT * FROM projects WHERE id=?').get(id);
        if (!p) fail(404, 'Project not found.');
        const user = userFor(req), owner = user?.admin || !!projects.role(user,p);
        if (req.method === 'GET') {
          if(!owner&&!projects.publicProject(id))fail(404,'Project not found.');
          if(!projectRoute[2])return json(res,200,projectView(p));
          let query=`SELECT * FROM versions WHERE projectId=? ${owner?'':"AND status='published'"}`;const params=[id];
          for(const [parameter,column] of [['version','gameVersions'],['loader','loaders']])if(url.searchParams.has(parameter)){query+=` AND EXISTS(SELECT 1 FROM json_each(${column}) WHERE value=?)`;params.push(url.searchParams.get(parameter));}
          const result=page(db,query,params,url);result.items=result.items.map(v=>versionView(v,!!owner));return json(res,200,{...result,versions:result.items});
        }
        if (req.method === 'POST' && projectRoute[2]) {
          const publisher=requireUser(req); auth.requirePermission(publisher,'publish'); ownProject(req, id); const data = await body(req);
          const name = text(data.name, 'version name', 100);
          const gameVersions = data.gameVersions, loaders = data.loaders;
          if (!Array.isArray(gameVersions) || !gameVersions.length || gameVersions.length > 30 || gameVersions.some(v => !validVersionId(v))) fail(400, 'List supported official Minecraft versions.');
          if (!Array.isArray(loaders) || !loaders.length || loaders.length > 4 || loaders.some(v => !['fabric', 'quilt', 'forge', 'neoforge'].includes(v))) fail(400, 'List supported mod loaders.');
          for(const version of gameVersions) for(const loader of loaders) {
            try { await metadata.assertSelection({version,loader}); }
            catch(error) { fail(/unavailable|fetch|offline/i.test(error.message)?503:400,error.message); }
          }
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
          const length = Number(req.headers['content-length']);
          if (!Number.isSafeInteger(length) || length < 1) fail(411, 'A positive Content-Length is required.');
          if (!['application/java-archive', 'application/octet-stream'].includes(req.headers['content-type'])) fail(415, 'Upload a raw JAR file.');
          const publisher=requireUser(req);auth.requirePermission(publisher,'publish');
          const reservation=storage.reserveUpload({userId:publisher.id,versionId:id,size:length});
          const temporary = path.join(root, 'incoming', reservation.id), destination = storage.filePath(id+'.jar','quarantine');
          let committed = false, size = 0; const hash = createHash('sha512');
          try {
            const handle = await (options.writeUpload||((filename)=>fs.open(filename,'wx',0o600)))(temporary);
            const measure = new Transform({ transform(chunk, _encoding, cb) {
              size += chunk.length;
              if (size > length || size > maxUpload) return cb(Object.assign(new Error('Upload size exceeded.'), { status: 413 }));
              hash.update(chunk); cb(null, chunk);
            } });
            await pipeline(req, measure, handle.createWriteStream());
            if (size !== length) fail(400, 'Incomplete upload.');
            await validateJar(temporary);
            await fs.rename(temporary, destination);
            let scanStatus=reviewPolicy==='scanner'?'unscanned':'manual';
            if(scanner){try{const result=await scanner.scan(destination);scanStatus=['clean','infected'].includes(result?.status)?result.status:'failed';}catch{scanStatus='failed';}}
            ownProject(req,v.projectId);auth.requirePermission(requireUser(req),'publish');
            storage.commitUpload(reservation,{checksum:hash.digest('hex'),storageKey:id+'.jar',size,scanStatus});
            committed = true;
            return json(res, 200, versionView(db.prepare('SELECT * FROM versions WHERE id=?').get(id)));
          } finally {
            storage.cancelUpload(reservation);
            await fs.rm(temporary, { force: true }); if (!committed) await fs.rm(destination, { force: true });
          }
        }
        if (req.method === 'GET') {
          if (v.status !== 'published') ownProject(req, v.projectId);
          if (versionRoute[2] === 'download') {
            if (!v.sha512) fail(404, 'File not uploaded.');
            const filename = await storage.locate(v.storageKey||id+'.jar');
            await fs.access(filename);
            res.writeHead(200, { 'Content-Type': 'application/java-archive', 'Content-Length': v.size, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(v.filename)}`, 'Cache-Control': 'no-store', 'X-Checksum-SHA512': v.sha512 });
            await pipeline(createReadStream(filename), res);
            if (v.status === 'published') db.prepare('UPDATE versions SET downloads=downloads+1 WHERE id=?').run(id);
            return;
          }
          if (!versionRoute[2]) return json(res, 200, versionView(v,!!userFor(req)?.admin||!!projects.role(userFor(req),projects.get(v.projectId))));
        }
      }
      if (req.method === 'GET' && route === '/v1/admin/reviews') {
        requireAdmin(req); const status = url.searchParams.get('status') || 'pending';
        if (!['pending', 'published', 'rejected'].includes(status)) fail(400, 'Invalid review status.');
        const result=page(db,'SELECT * FROM versions WHERE status=?',[status],url);result.items=result.items.map(v=>({...versionView(v,true),project:projectView(projects.get(v.projectId))}));return json(res,200,{...result,versions:result.items});
      }
      const rescan=/^\/v1\/admin\/versions\/([a-f0-9-]{36})\/scan$/.exec(route);
      if(req.method==='POST'&&rescan){
        requireAdmin(req);if(!scanner)fail(503,'Scanner is not configured.');
        const v=db.prepare("SELECT * FROM versions WHERE id=? AND status='pending' AND sha512 IS NOT NULL").get(rescan[1]);if(!v)fail(409,'No pending file to scan.');
        let status='failed';try{const result=await scanner.scan(await storage.locate(v.storageKey));if(['clean','infected'].includes(result?.status))status=result.status;}catch{}
        requireAdmin(req);if(!db.prepare("UPDATE versions SET scanStatus=? WHERE id=? AND status='pending'").run(status,v.id).changes)fail(409,'Version changed while scanning.');
        if(status!=='clean')fail(503,'Scan did not approve the file. It remains private.');json(res,200,{scanStatus:status});return;
      }
      const moderation = /^\/v1\/admin\/versions\/([a-f0-9-]{36})\/review$/.exec(route);
      if (req.method === 'POST' && moderation) {
        requireAdmin(req); const data = await body(req), v = db.prepare('SELECT * FROM versions WHERE id=?').get(moderation[1]);
        if (!v || !['pending', 'published', 'rejected'].includes(v.status) || !v.sha512) fail(409, 'No submitted file to review.');
        if (!['approve', 'reject'].includes(data.action)) fail(400, 'Use approve or reject.');
        const note = data.action === 'reject' ? text(data.note, 'rejection reason', 2000) : String(data.note || '').slice(0, 2000);
        if(data.action==='approve'){
          if(['failed','infected'].includes(v.scanStatus)||(publicMode&&v.scanStatus!=='clean'&&!(reviewPolicy==='manual'&&['manual','unscanned'].includes(v.scanStatus))))fail(503,'A successful scan or configured manual review is required before publication.');
          await storage.publish(v);
        }
        requireAdmin(req);
        if(!db.prepare('UPDATE versions SET status=?,reviewNote=?,reviewedAt=? WHERE id=? AND status=? AND reviewedAt IS ?').run(data.action === 'approve' ? 'published' : 'rejected', note, new Date().toISOString(), v.id,v.status,v.reviewedAt).changes)fail(409,'Version changed while reviewing.');
        return json(res, 200, versionView(db.prepare('SELECT * FROM versions WHERE id=?').get(v.id)));
      }
      const pageRoute = /^\/projects\/([a-f0-9-]{36})$/.exec(route);
      if (req.method === 'GET' && pageRoute) {
        const p = db.prepare("SELECT p.* FROM projects p WHERE p.id=? AND EXISTS(SELECT 1 FROM versions v WHERE v.projectId=p.id AND v.status='published')").get(pageRoute[1]);
        if (!p) fail(404, 'Project not found.');
        const project = projectView(p), versions = db.prepare("SELECT * FROM versions WHERE projectId=? AND status='published' ORDER BY createdAt DESC").all(p.id).map(versionView);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(projectPage(project,versions));
      }
      const userPage=/^\/users\/([a-z0-9_-]{3,40})$/.exec(route);
      if(req.method==='GET'&&userPage){
        const user=db.prepare('SELECT id,username FROM users WHERE username=?').get(userPage[1]);
        if(!user)fail(404,'Author not found.');
        const where="ownerId=? AND EXISTS(SELECT 1 FROM versions v WHERE v.projectId=projects.id AND v.status='published')";
        const total=db.prepare(`SELECT COUNT(*) AS n FROM projects WHERE ${where}`).get(user.id).n;
        const offset=Number(url.searchParams.get('offset')||0);
        if(!Number.isInteger(offset)||offset<0||offset>100000)fail(400,'Invalid pagination.');
        const projects=db.prepare(`SELECT * FROM projects WHERE ${where} ORDER BY createdAt DESC,id LIMIT 20 OFFSET ?`).all(user.id,offset).map(projectView);
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(authorPage(user.username,projects,total,offset));
      }
      fail(404, 'Endpoint not found.');
    } catch (error) {
      if (res.headersSent || res.destroyed) { if (!res.destroyed) res.destroy(); return; }
      const status = error.code==='ENOSPC'?507:error.status || 500;
      const code=({400:'invalid_request',401:'authentication_required',403:'permission_denied',404:'not_found',409:'conflict',411:'length_required',413:'limit_exceeded',415:'unsupported_media',429:'rate_limited',500:'internal_error',503:'unavailable',507:'storage_unavailable'})[status]||'request_failed';
      const detail=status===500?'Internal server error.':error.code==='ENOSPC'?'Storage space unavailable.':error.message;
      if(status>=500)console.error(JSON.stringify({event:'request.failed',requestId,status,code}));
      json(res,status,{type:'about:blank',title:http.STATUS_CODES[status]||'Request failed',status,detail,instance:requestPath,code,requestId,error:detail},'application/problem+json');
    }
  });
  const cleanup=setInterval(()=>storage.collectAbandoned().catch(error=>console.error('Petal storage cleanup failed:',error.code||error.name)),3600000).unref();
  server.on('listening', () => { if (!base) base = `http://127.0.0.1:${server.address().port}`; });
  server.on('close', () => { clearInterval(sweep); clearInterval(cleanup); db.close(); });
  server.maxConnections = 200;
  return { server, root, db, get publicUrl() { return base; } };
}

if (require.main === module) {
  require('./config.cjs').loadSecretFiles().then(()=>createPetalServer()).then(({ server, root }) => {
    const host = process.env.PETAL_API_HOST || '127.0.0.1', port = Number(process.env.PETAL_API_PORT || 4318);
    if (host !== '127.0.0.1' && host !== 'localhost' && !process.env.PETAL_PUBLIC_URL) throw new Error('Set PETAL_PUBLIC_URL before listening beyond loopback.');
    server.listen(port, host, () => console.log(`Petal API listening on ${host}:${port}. Portal: ${process.env.PETAL_PUBLIC_URL || `http://127.0.0.1:${port}`}. Local admin token: ${path.join(root, 'admin-token.txt')} (unless supplied through the environment).`));
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
  }).catch(error => { console.error(error.message); process.exit(1); });
}
module.exports = { createPetalServer, validateJar };
