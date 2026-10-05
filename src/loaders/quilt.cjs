const { request, choice, descending, stable, selected } = require('./common.cjs');
module.exports = ({ fetcher = fetch } = {}) => {
  const adapter = {
    async list(version,{includePrerelease=false}={}) {
      const data = await request(fetcher,`https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(version)}`);
      if(!Array.isArray(data)) throw new Error('Invalid Quilt metadata.');
      return data.filter(a=>a.loader?.version && (includePrerelease || stable(a.loader.version))).map(a=>choice('quilt',a.loader.version,version)).sort(descending);
    },
    async install({profile,resources,agent}) {
      const chosen = await selected(adapter,profile);
      const runtimeVersion = await require('@xmcl/installer').installQuiltVersion({minecraftVersion:profile.version,version:chosen.version,minecraft:resources,dispatcher:agent?.dispatcher});
      return {runtimeVersion,loaderVersion:chosen.version};
    }
  }; return adapter;
};
