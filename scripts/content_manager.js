// Isolated world: ponte entre o popup (chrome.runtime) e os scripts do Main World (window.postMessage).
const pending = new Map();
let seq = 0;

const save = (recId, final) => ask('export').then(data => data.error ? data : chrome.runtime.sendMessage({ cmd: 'save', data, recId, final }));

window.addEventListener('message', ev => {
  const d = ev.data;
  if (ev.source !== window || !d) return;
  // Gravacao: cada passo vai direto para o armazenamento da extensao (nao se perde se a pagina recarregar)
  if (d.mspa === 'rec-step' && d.step && d.step.recId) return void chrome.storage.local.set({ [`rec:${d.step.recId}:${d.step.t}:${Math.random()}`]: d.step });
  if (d.mspa === 'rec-stop' && d.recId) return void save(d.recId, true);
  if (d.mspa === 'session' && location.hostname === 'novacentral.fretebras.com.br') return void chrome.runtime.sendMessage({ cmd: 'fb-session', token: d.token, headers: d.headers, auth: d.auth, diag: d.diag });
  if (d.mspa !== 'res' || !pending.has(d.id)) return;
  pending.get(d.id)(d.res);
  pending.delete(d.id);
});

const ask = (cmd, arg, ms = 5000) => new Promise(ok => {
  const id = `m${++seq}-${Math.random()}`;
  pending.set(id, ok);
  window.postMessage({ mspa: 'req', id, cmd, arg }, '*');
  setTimeout(() => pending.delete(id) && ok({ error: 'Scanner nao respondeu. Recarregue a pagina (F5).' }), ms);
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const p = msg.cmd === 'export' ? save() : ask(msg.cmd, msg.arg, /^(fill|publish|close)$/.test(msg.cmd) ? 180000 : 5000); // preencher o formulario leva um bom tempo
  p.then(reply, e => reply({ error: String(e.message || e) }));
  return true;
});
