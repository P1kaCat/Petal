const validVersionId = id => typeof id === 'string' && /^[a-z0-9][a-z0-9 ._+-]{0,99}$/i.test(id) && !id.includes('..');
module.exports = { validVersionId };
