const caches = new WeakMap();
async function request(fetcher, url, format = 'json') {
  let cache = caches.get(fetcher); if (!cache) caches.set(fetcher, cache = new Map());
  const existing = cache.get(url);
  if (existing && existing.until > Date.now()) return existing.value;
  const r = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (r.status === 404) return format === 'json' ? [] : '';
  if (!r.ok) throw new Error(`Loader metadata unavailable (HTTP ${r.status}).`);
  const value = format === 'json' ? await r.json() : await r.text();
  if(cache.size >= 250) cache.delete(cache.keys().next().value);
  cache.set(url, { value, until: Date.now() + 3600000 }); return value;
}
const stable = v => !/alpha|beta|pre|snapshot|rc/i.test(v);
const descending = (a,b) => b.version.localeCompare(a.version, 'en', { numeric: true });
const xmlVersions = xml => [...xml.matchAll(/<version>([a-z0-9.+_-]+)<\/version>/gi)].map(m=>m[1]);
function choice(id, version, gameVersion, isStable = stable(version)) { return { id, version, stable: isStable, gameVersion }; }
async function selected(adapter, profile) {
  const list = await adapter.list(profile.version, { includePrerelease: !!profile.loaderVersion });
  const found = profile.loaderVersion ? list.find(v=>v.version === profile.loaderVersion) : list.find(v=>v.stable);
  if (!found) throw new Error('No compatible selected loader version is available.');
  return found;
}
module.exports = { request, stable, descending, xmlVersions, choice, selected };
