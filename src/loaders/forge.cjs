const { request, choice, descending, xmlVersions, selected } = require('./common.cjs');
const { retryDownload } = require('../retry.cjs');
module.exports = ({ fetcher = fetch } = {}) => {
  const adapter = {
    async list(version,{includePrerelease=false}={}) {
      if (!/^1\.(?:[6-9]|\d{2,})(?:\.\d+)?$/.test(version)) return [];
      const all = xmlVersions(await request(fetcher,'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml','text'));
      return all.filter(v=>v.startsWith(`${version}-`)).map(v=>choice('forge',v.slice(version.length+1),version)).filter(v=>includePrerelease || v.stable).sort(descending);
    },
    async install({profile,resources,javaPath,agent,notify=()=>{}}) {
      const chosen = await selected(adapter,profile);
      const artifact = `${profile.version}-${chosen.version}`;
      const url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${artifact}/forge-${artifact}-installer.jar`;
      const sha1 = (await request(fetcher,`${url}.sha1`,'text')).trim().split(/\s/)[0];
      if(!/^[a-f0-9]{40}$/i.test(sha1)) throw new Error('Forge installer checksum is unavailable.');
      const runtimeVersion = await retryDownload(()=>require('@xmcl/installer').installForge({mcversion:profile.version,version:chosen.version,installer:{path:url,sha1}},resources,{java:javaPath,mavenHost:'https://maven.minecraftforge.net/',agent}),notify);
      return {runtimeVersion,loaderVersion:chosen.version};
    }
  }; return adapter;
};
