const { choice } = require('./common.cjs');
module.exports = () => ({
  list: async version => [choice('vanilla', version, version, true)],
  install: async ({profile}) => ({runtimeVersion: profile.version,loaderVersion: profile.version})
});
