async function retryDownload(operation, notify = () => {}, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await operation(); }
    catch (e) {
      if (!/Download|Aggregate|Fetch|Request/i.test(e.name) || attempt === 2) throw e;
      notify(`Reprise des téléchargements interrompus (${attempt + 2}/3)…`);
      await wait(1000 * (attempt + 1));
    }
  }
}
module.exports = { retryDownload };
