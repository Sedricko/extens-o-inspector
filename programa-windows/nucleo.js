// Roda a MESMA logica da extensao (fretebras.js, linhas.js, sync.js) dentro do Node.
// "chrome.*" aqui e um adaptador pequeno: guarda dados em arquivo e abre as paginas pelo Playwright.
const fs = require('fs'), path = require('path'), vm = require('vm');
const meus = require('./meus');

const achar = nome => [`logica/${nome}`, `../${nome}`, `../scripts/${nome}`].map(p => path.join(__dirname, p)).find(fs.existsSync);

function criar({ ctx, arquivoDados, escrever = console.log }) {
  const dados = fs.existsSync(arquivoDados) ? JSON.parse(fs.readFileSync(arquivoDados, 'utf8')) : {};
  const gravar = () => fs.writeFileSync(arquivoDados, JSON.stringify(dados));
  const sessao = {};
  const pegar = (obj, k) => k == null ? { ...obj } : Object.fromEntries((Array.isArray(k) ? k : typeof k === 'string' ? [k] : Object.keys(k)).filter(x => x in obj).map(x => [x, obj[x]]));
  const area = (obj, persiste) => ({
    get: async k => JSON.parse(JSON.stringify(pegar(obj, k))),
    set: async o => {
      Object.assign(obj, JSON.parse(JSON.stringify(o)));
      if (persiste) { gravar(); mostrar(o); }
    },
    remove: async k => { for (const x of [].concat(k)) delete obj[x]; if (persiste) gravar(); },
    clear: async () => { for (const x of Object.keys(obj)) delete obj[x]; },
  });
  const hora = t => new Date(t).toLocaleTimeString('pt-BR');
  const mostrar = o => { // o que a extensao mostra no painel, aqui vai para a tela
    if (o.syncLogs && o.syncLogs[0]) escrever(`[${hora(o.syncLogs[0].t)}] ${o.syncLogs[0].txt}`, o.syncLogs[0].nivel);
    if (o.syncHistorico && o.syncHistorico[0]) { const h = o.syncHistorico[0]; escrever(`[${hora(h.t)}] ${h.tipo} linha ${h.linha}: ${h.status} ${h.codigo || ''} ${h.frete || ''}`, /ERRO|INCERTA/.test(h.status) ? 'erro' : 'info'); }
    if (typeof o.syncFila === 'number') escrever(`Fila: ${o.syncFila} frete(s)`);
  };

  // abas: id -> pagina do Playwright; a conversa com fb_publisher.js e por window.postMessage, como na extensao
  const paginas = new Map(); let seq = 0;
  const pag = id => { const p = paginas.get(id); if (!p) throw new Error('aba fechada'); return p; };
  const abrir = async url => {
    const page = await ctx.newPage();
    const id = ++seq; paginas.set(id, page);
    page.goto(url).catch(() => {});
    return { id, url };
  };
  const chrome = {
    storage: { local: area(dados, true), session: area(sessao, false) },
    alarms: { create: (nome, o) => { chrome.alarms._t = setInterval(() => ouvintes.forEach(f => f({ name: nome })), o.periodInMinutes * 60e3); }, clear: () => clearInterval(chrome.alarms._t) },
    action: { setBadgeText: ({ text }) => { chrome.action.texto = text; }, setBadgeBackgroundColor: () => {} },
    tabs: {
      create: async ({ url }) => abrir(url),
      reload: async id => { await pag(id).reload().catch(() => {}); },
      remove: async id => { const p = paginas.get(id); paginas.delete(id); if (p) await p.close().catch(() => {}); },
      sendMessage: async (id, { cmd, arg }) => {
        const r = await pag(id).evaluate(({ cmd, arg }) => new Promise((ok, no) => {
          const mid = 'n' + Math.random();
          const t = setTimeout(() => no(new Error('a pagina nao respondeu')), 180000);
          const f = ev => { if (ev.data && ev.data.mspa === 'res' && ev.data.id === mid) { clearTimeout(t); removeEventListener('message', f); ok(ev.data.res); } };
          addEventListener('message', f);
          postMessage({ mspa: 'req', id: mid, cmd, arg }, '*');
        }), { cmd, arg });
        return r;
      },
    },
    windows: { create: async ({ url }) => { const t = await abrir(url); return { id: 0, tabs: [t] }; }, update: async () => {} },
  };
  const ouvintes = [];
  chrome.alarms.onAlarm = { addListener: f => ouvintes.push(f) };

  const sandbox = { chrome, console, fetch, URL, URLSearchParams, atob, btoa, setTimeout, clearTimeout, setInterval, Date, JSON, Promise, Math, Intl };
  vm.createContext(sandbox);
  for (const f of ['fretebras.js', 'linhas.js', 'sync.js']) vm.runInContext(fs.readFileSync(achar(f), 'utf8'), sandbox, { filename: f });
  const rodar = codigo => vm.runInContext(codigo, sandbox);

  // No programa, Meus Fretes e sempre aberto FILTRADO por voce (meus.js) e a contagem vem do numero exato da Central.
  sandbox.fbApagarMeus = base => meus.apagarMeus(ctx, base, escrever);
  sandbox.fbContarAtivos = (base = rodar('FB.site')) => meus.contarMeus(ctx, base);
  sandbox.fbCodigosAtivos = (base = rodar('FB.site')) => meus.codigosAtivos(ctx, base);
  sandbox.fbClose = async (codigo, acao, base = rodar('FB.site')) => {
    const { page, est } = await meus.abrirMeus(ctx, base);
    const id = ++seq; paginas.set(id, page);
    try {
      await meus.filtrarMeus(page, est);
      const r = await chrome.tabs.sendMessage(id, { cmd: 'close', arg: { codigo, acao } });
      if (r.ok) await chrome.tabs.remove(id);
      return r;
    } catch (e) { await chrome.tabs.remove(id); throw e; }
  };

  // fb_publisher.js roda dentro de cada pagina (como content script no mundo principal da pagina)
  ctx.addInitScript(fs.readFileSync(achar('fb_publisher.js'), 'utf8'));
  // anuncios e popups: fecha os que so tem botao de dispensar (popups.js) e bloqueia rastreadores de propaganda/analise
  ctx.addInitScript(fs.readFileSync(achar('popups.js'), 'utf8'));
  ctx.route(/google-analytics\.com|googletagmanager\.com|doubleclick\.net|connect\.facebook\.net|facebook\.com\/tr|clarity\.ms|hotjar\./, r => r.abort());
  ctx.on('page', p => p.on('console', m => { if (m.text().startsWith('[mspa-popup]')) escrever(m.text().replace('[mspa-popup]', 'Aviso do site ' )); }));
  return { chrome, rodar, ouvintes, dados };
}

module.exports = { criar };
