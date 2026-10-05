const factories = {vanilla:require('./vanilla.cjs'),fabric:require('./fabric.cjs'),forge:require('./forge.cjs'),neoforge:require('./neoforge.cjs'),quilt:require('./quilt.cjs')};
function getLoader(id,options={}) {
  if(!Object.hasOwn(factories,id)) throw new Error('Unknown mod loader.');
  return factories[id](options);
}
module.exports = { getLoader };
