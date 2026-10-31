importScripts('fretebras.js');

// Junta os passos gravados (um por chave no storage) numa linha do tempo; "final" apaga depois de juntar.
async function recording(id, final) {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(k => k.startsWith(`rec:${id}:`));
  // mesmo milissegundo: a acao do usuario vem antes da chamada que ela dispara
  const steps = keys.map(k => all[k]).sort((a, b) => a.t - b.t || (a.type === 'request') - (b.type === 'request'));
  // Digitar manda um passo por tecla: fica so o ultimo valor de cada sequencia no mesmo campo
  // (o que aparece na tela no meio, como "3/30 caracteres", nao quebra a sequencia; clique e chamada de rede quebram).
  const typing = (s, i) => {
    if (s.type !== 'field') return false;
    for (const n of steps.slice(i + 1)) {
      if (n.type === 'field') return n.name === s.name && n.route === s.route; // id do campo muda a cada tecla em alguns sites
      if (n.type !== 'appeared' && n.type !== 'storage') return false;
    }
    return false;
  };
  const timeline = steps.filter((s, i) => !typing(s, i))
    .map(({ recId, ...s }) => ({ ...s, sec: +((s.t - id) / 1000).toFixed(1) }));
  if (final) await chrome.storage.local.remove(keys);
  return { start: new Date(+id).toISOString(), end: new Date(steps.length ? steps[steps.length - 1].t : +id).toISOString(), timeline };
}

// Salva o JSON que o content_manager manda (Export JSON ou fim da gravacao).
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.cmd !== 'save' || sender.id !== chrome.runtime.id) return;
  const recId = msg.recId || msg.data.recId;
  (recId ? recording(recId, msg.final) : Promise.resolve(null)).then(rec => {
    msg.data.recording = rec;
    download(msg, reply);
  });
  return true;
});

function download(msg, reply) {
  let host = 'pagina';
  try { host = new URL(msg.data.url).hostname || host; } catch {}
  const filename = `master-spa/${host}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  // shortcut: data: URL (service worker nao tem createObjectURL); se arquivos muito grandes falharem, trocar por offscreen document + blob.
  const url = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(msg.data, null, 2));
  chrome.downloads.download({ url, filename, saveAs: false }, id =>
    reply(chrome.runtime.lastError ? { error: chrome.runtime.lastError.message } : { ok: true, id, filename }));
}

// Fretebras: a sessao so e aceita vinda da Central; publicar/excluir so do popup (sem aba), nunca de um site.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !/^fb-/.test(msg.cmd)) return;
  const fromSite = sender.tab && sender.url && sender.url.startsWith(FB.site);
  const fromPopup = !sender.tab;
  const run = {
    'fb-session': fromSite && (() => fbSaveSession(msg)),
    'fb-status': fromPopup && fbStatus,
    'fb-test': fromPopup && fbPublishTest,
    'fb-delete': fromPopup && fbDeleteTest,
    'fb-fill': fromPopup && (() => fbFillTest()),
    'fb-publish-form': fromPopup && (() => fbFillTest(FB.site, true)),
  }[msg.cmd];
  if (!run) return;
  run().then(r => reply(r || { ok: true }), e => reply({ error: String(e.message || e) }));
  return true;
});
