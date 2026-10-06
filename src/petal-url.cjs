function petalOrigin(value) {
  if (!value) return '';
  let url;
  try { url = new URL(String(value).trim()); } catch { throw new Error('Invalid Petal API URL.'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) throw new Error('Use an HTTPS origin for Petal API, or HTTP localhost for development.');
  return url.origin;
}
function isPetalDownload(url, base) {
  return !!base && url.origin === petalOrigin(base) && !url.username && !url.password && !url.search && !url.hash && /^\/v1\/versions\/[a-f0-9-]{36}\/download$/.test(url.pathname);
}
module.exports = { petalOrigin, isPetalDownload };
