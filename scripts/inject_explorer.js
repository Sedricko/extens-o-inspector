// Fase 3, Main World: explora a SPA sozinha em modo seguro (nada que grava no servidor sai da pagina).
// Clica em cada elemento que nao parece perigoso, anota rota, elementos e chamadas de rede, e salva o JSON no fim.
(() => {
  const S = window.__MSPA;
  if (!S) return alert('Master SPA: recarregue a pagina (F5) e tente de novo.');
  if (window.__MSPA_EXPLORER) return window.__MSPA_EXPLORER.stop(); // clicar de novo para

  const DANGER = /sair|logout|excluir|apagar|deletar|remover|desativar|cancelar|pagar|pagamento|comprar|contratar|assinar|exposi|publicar|salvar|enviar|confirmar|finalizar|denunciar|bloquear|aceitar|recusar/i;
  const MAX_CLICKS = 300, WAIT = window.__MSPA_WAIT || 900;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const route = () => location.pathname + location.search;
  const map = window.__MSPA_MAP = { start: new Date().toISOString(), origin: location.origin, done: false, clicks: 0, routes: {}, opened: [] };
  const queue = [route()];
  const tried = new Set();
  let stopped = false;

  // UI de status em Shadow DOM
  const host = document.createElement('div');
  host.id = 'mspa-explorer';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>div{position:fixed;left:12px;bottom:12px;z-index:2147483647;font:12px system-ui,sans-serif;background:#111;color:#fff;
    padding:8px 10px;border-radius:8px;display:flex;gap:8px;align-items:center;max-width:420px}button{font:inherit;cursor:pointer}</style>
    <div role="status"><span></span><button>Parar</button></div>`;
  const msg = root.querySelector('span');
  root.querySelector('button').onclick = () => { stopped = true; };
  document.documentElement.append(host);
  const show = t => { msg.textContent = t; };

  const origOpen = window.open;
  window.open = (url, target) => { map.opened.push({ from: route(), url: String(url), target }); return null; }; // nao abre aba nova

  const go = async path => {
    if (route() === path) return;
    history.pushState(null, '', path);
    dispatchEvent(new PopStateEvent('popstate', { state: null }));
    await sleep(WAIT * 2);
  };
  // Mesmo texto na mesma rota (ex.: "Editar frete" em 60 cards) conta uma vez so; numeros variam e nao contam.
  const keyOf = (path, it) => it.text ? `${path}|${it.tag}|${it.text.replace(/\d+/g, '#')}` : `${path}|${it.selector}`;
  const brief = it => ({ text: it.text, tag: it.tag, selector: it.selector, component: it.react && it.react.components[0] });
  const label = it => [it.text, it.attrs['aria-label'], it.attrs.title].filter(Boolean).join(' ');
  const queueRoute = p => { if (!map.routes[p] && !queue.includes(p)) queue.push(p); };

  const explore = async path => {
    await go(path);
    if (route() !== path) { map.routes[path] = { redirectedTo: route() }; queueRoute(route()); return; }
    const page = map.routes[path] = { title: document.title, dom: S.scan().items, actions: [] };
    while (!stopped && map.clicks < MAX_CLICKS) {
      if (route() !== path) await go(path);
      const it = S.scan().items.find(it => !tried.has(keyOf(path, it)) && !/^(input|textarea|select)$/.test(it.tag));
      if (!it) break;
      tried.add(keyOf(path, it));
      if (DANGER.test(label(it))) { page.actions.push({ ...brief(it), skipped: 'parece perigoso' }); continue; }
      if (it.tag === 'a' && it.attrs.href && !it.attrs.href.startsWith('#')) {
        const u = new URL(it.attrs.href, location.href);
        if (u.origin === location.origin) { queueRoute(u.pathname + u.search); page.actions.push({ ...brief(it), link: u.pathname + u.search }); }
        else page.actions.push({ ...brief(it), external: u.href });
        continue;
      }
      const t0 = Date.now(), els = document.body.querySelectorAll('*').length;
      map.clicks++;
      show(`Explorando ${path}: ${map.clicks} cliques, ${Object.keys(map.routes).length} telas. "${it.text.slice(0, 30)}"`);
      const r = S.act(it.i, 'click');
      await sleep(WAIT);
      const res = {
        ...brief(it),
        newElements: document.body.querySelectorAll('*').length - els,
        requests: (window.__MSPA_NET || []).filter(n => n.t >= t0).map(n => ({ method: n.method, url: n.url, status: n.status, blocked: n.blocked, reqBody: n.reqBody })),
      };
      if (r.error) res.error = r.error;
      if (route() !== path) { res.navigatedTo = route(); queueRoute(route()); }
      page.actions.push(res);
    }
    page.dom = S.scan().items; // estado final da tela, com menus e modais que abriram
  };

  const finish = () => {
    window.__MSPA_SAFE = false;
    window.open = origOpen;
    delete window.__MSPA_EXPLORER;
    map.done = true;
    map.end = new Date().toISOString();
    show(`Pronto: ${Object.keys(map.routes).length} telas, ${map.clicks} cliques. JSON salvo em Downloads/master-spa.`);
    setTimeout(() => host.remove(), 8000);
    window.postMessage({ mspa: 'save' }, '*'); // content_manager pede o export e o background salva
  };

  window.__MSPA_SAFE = true;
  window.__MSPA_EXPLORER = { stop: () => { stopped = true; } };
  // shortcut: estado so na memoria; se um clique recarregar a pagina inteira o explorador para (o que ja capturou se perde).
  (async () => {
    try {
      while (queue.length && !stopped && map.clicks < MAX_CLICKS) {
        const p = queue.shift();
        if (!map.routes[p]) await explore(p);
      }
    } catch (e) { map.error = String(e); }
    finish();
  })();
})();
