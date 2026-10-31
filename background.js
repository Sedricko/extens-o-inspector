importScripts('fretebras.js', 'scripts/linhas.js', 'sync.js');

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

// Fretebras: a sessao so e aceita vinda da Central; publicar so do popup ou da pagina do lote (nunca de um site).
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !/^(fb|sync)-/.test(msg.cmd)) return;
  const fromSite = sender.tab && sender.url && sender.url.startsWith(FB.site);
  const own = (sender.url || '').startsWith(chrome.runtime.getURL('')) || !sender.tab; // popup ou pagina da extensao
  const run = {
    'fb-session': fromSite && (() => fbSaveSession(msg)),
    'fb-status': own && fbStatus,
    'fb-test': own && fbPublishTest,
    'fb-delete': own && fbDeleteTest,
    'fb-fill': own && (() => fbFillTest()),
    'fb-publish-form': own && (() => fbFillTest(FB.site, true)),
    'fb-row': own && (() => fbFillTest(FB.site, !!msg.publish, msg.row)),
    'sync-plano': own && syncPlano,
    'sync-escrever': own && (() => syncEscrever(msg.escritas)),
    'sync-acao': own && (() => syncAcao(msg.acao)),
    'sync-agora': own && syncAuto,
    'sync-retomar': own && syncRetomar,
    'sync-inicio': own && (async () => { // trava para a rodada automatica nao rodar junto com a manual
      const e = await syncEstado();
      if (e.rodando && Date.now() - e.rodando < 30 * 60e3) throw new Error('Outra sincronizacao esta rodando.');
      await syncEstadoSet({ rodando: Date.now() });
    }),
    'sync-fim': own && (() => syncEstadoSet({ rodando: 0, ultima: Date.now() })),
  }[msg.cmd];
  if (!run) return;
  run().then(r => reply(r || { ok: true }), e => reply({ error: String(e.message || e), global: !!e.global }));
  return true;
});

// Rodada automatica: o alarme acorda a extensao enquanto o Chrome estiver aberto.
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'sync-auto') syncAuto(); });
chrome.storage.onChanged.addListener(c => { if (c.syncCfg) syncAlarme(); });
syncAlarme(); // os alarmes podem sumir quando o Chrome reinicia: recria sempre que a extensao acorda
