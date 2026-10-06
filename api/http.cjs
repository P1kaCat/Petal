const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const json = (res, status, data, mime='application/json') => { res.writeHead(status, { 'Content-Type': mime+'; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
const body = async req => {
    if (!String(req.headers['content-type']).startsWith('application/json')) fail(415, 'Use application/json.');
    if(Number(req.headers['content-length'])>65536)fail(413,'Request body too large.');
    let length = 0; const chunks = [];
    for await (const chunk of req) { length += chunk.length; if (length > 65536) fail(413, 'Request body too large.'); chunks.push(chunk); }
    try { const value = JSON.parse(Buffer.concat(chunks)); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
    catch { fail(400, 'Invalid JSON object.'); }
  };
module.exports = { fail, json, body };
