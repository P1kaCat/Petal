const { request, choice, descending, xmlVersions, selected } = require('./common.cjs');
const { retryDownload } = require('../retry.cjs');
module.exports = ({ fetcher = fetch } = {}) => {
  const adapter = {
    async list(version,{includePrerelease=false}={}) {
      if(version === '1.20.1') {
        const values = xmlVersions(await request(fetcher,'https://maven.neoforged.net/releases/net/neoforged/forge/maven-metadata.xml','text'));
        return values.filter(v=>v.startsWith('1.20.1-')).map(v=>choice('neoforge',v.slice(7),version)).sort(descending);
      }
      const legacy = version.startsWith('1.');
      const parts = version.match(legacy ? /^1\.(\d+)(?:\.(\d+))?$/ : /^(\d+)\.(\d+)(?:\.(\d+))?$/);
      if(!parts) return [];
      const prefix = `${parts[1]}.${parts[2] ?? '0'}.`;
      const xml = await request(fetcher,'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml','text');
      const candidates = xmlVersions(xml).filter(v=>v.startsWith(prefix)).map(v=>choice('neoforge',v,version)).filter(v=>includePrerelease || v.stable).sort(descending).slice(0,30);
      const verified = [];
      for(let offset=0;offset<candidates.length;offset+=5) {
        const batch = await Promise.all(candidates.slice(offset,offset+5).map(async item=>{
          const pom = await request(fetcher,`https://maven.neoforged.net/releases/net/neoforged/neoforge/${item.version}/neoforge-${item.version}.pom`,'text');
          const dependencies = [...pom.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)].map(m=>m[1]);
          return dependencies.some(d=>/<artifactId>neoform<\/artifactId>/.test(d) && d.includes(`<version>${version}-`)) ? item : null;
        }));
        verified.push(...batch.filter(Boolean));
      }
      return verified;
    },
    async install({profile,resources,javaPath,agent,notify=()=>{}}) {
      const chosen = await selected(adapter,profile);
      const artifact = profile.version === '1.20.1' ? 'forge' : 'neoforge';
      const version = artifact === 'forge' ? `1.20.1-${chosen.version}` : chosen.version;
      const runtimeVersion = await retryDownload(()=>require('@xmcl/installer').installNeoForged(artifact,version,resources,{java:javaPath,agent}),notify);
      return {runtimeVersion,loaderVersion:chosen.version};
    }
  }; return adapter;
};
