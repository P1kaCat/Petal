const { request, choice, descending, selected } = require('./common.cjs');
module.exports = ({ fetcher = fetch } = {}) => {
  const artifacts = version => request(fetcher, `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(version)}`);
  const adapter = {
    async list(version,{includePrerelease=false}={}) {
      const data = await artifacts(version);
      if(!Array.isArray(data)) throw new Error('Invalid Fabric metadata.');
      return data.filter(a=>a.loader?.version && (includePrerelease || a.loader.stable === true)).map(a=>choice('fabric',a.loader.version,version,a.loader.stable === true)).sort(descending);
    },
    async install({profile,resources}) {
      const chosen = await selected(adapter,profile);
      const artifact = (await artifacts(profile.version)).find(a=>a.loader.version === chosen.version);
      const runtimeVersion = await require('@xmcl/installer').installFabric(artifact,resources);
      return {runtimeVersion,loaderVersion:chosen.version};
    }
  }; return adapter;
};
