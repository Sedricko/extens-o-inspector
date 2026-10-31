// Junta os passos gravados (um por chave no storage) numa linha do tempo; "final" apaga depois de juntar.
async function recording(id, final) {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(k => k.startsWith(`rec:${id}:`));
  const steps = keys.map(k => all[k]).sort((a, b) => a.t - b.t);
  // Digitar manda um passo por tecla: fica so o ultimo valor de cada sequencia no mesmo campo.
  const timeline = steps.filter((s, i) => !(s.type === 'field' && steps[i + 1] && steps[i + 1].type === 'field' && steps[i + 1].selector === s.selector))
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
