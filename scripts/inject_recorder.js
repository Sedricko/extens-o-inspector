// Fase 3, Main World: grava o que o usuario faz (campos, cliques, telas), as chamadas de rede e o que aparece na tela.
// Liga/desliga pelo popup. Cada passo vai na hora para o armazenamento da extensao (content_manager), e o
// sessionStorage lembra que esta gravando: se a pagina recarregar, a gravacao continua.
(() => {
  const S = window.__MSPA;
  if (!S || window.__MSPA_RECORDER) return;

  const OURS = '#mspa-rec,#mspa-panel,#mspa-overlay';
  const SECRET = /senha|password|cvv|cartao|card/i;
  const route = () => location.pathname + location.search;
  let recId = null, nSteps = 0;
  const add = (type, data) => {
    const step = { t: Date.now(), type, route: route(), ...data, recId };
    window.postMessage({ mspa: 'rec-step', step }, '*');
    nSteps++; count();
  };

  // Nome do campo como o usuario ve: <label>, aria, placeholder ou o rotulo mais proximo acima dele.
  const fieldName = el => {
    const byId = id => { const l = document.getElementById(id); return l && l.innerText; };
    const near = () => {
      for (let n = el.parentElement, i = 0; n && i < 4; n = n.parentElement, i++) {
        const l = n.querySelector('label,legend');
        if (l && l.innerText.trim()) return l.innerText;
      }
    };
    const v = (el.labels && el.labels[0] && el.labels[0].innerText) || el.getAttribute('aria-label') ||
      (el.getAttribute('aria-labelledby') && byId(el.getAttribute('aria-labelledby'))) || el.placeholder || near() || el.name || el.id || '';
    return v.trim().replace(/\s+/g, ' ').slice(0, 80);
  };
  const isSecret = el => el.type === 'password' || SECRET.test(`${el.name} ${el.id} ${el.autocomplete}`);
  const valueOf = el => {
    if (isSecret(el)) return '***';
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked;
    if (el.localName === 'select') return el.selectedOptions[0] ? el.selectedOptions[0].text : el.value;
    if (el.isContentEditable) return el.innerText.slice(0, 500);
    return el.value;
  };
  const field = el => ({ name: fieldName(el), value: valueOf(el), tag: el.localName, inputType: el.type, selector: S.describe(el).selector });
  // Tudo que esta preenchido na tela no momento do clique (o "formulario" que o botao vai enviar).
  const filled = () => [...document.querySelectorAll('input,textarea,select,[contenteditable=""],[contenteditable=true]')]
    .filter(e => !e.closest(OURS) && e.type !== 'hidden' && e.getClientRects().length &&
      ((e.type === 'checkbox' || e.type === 'radio') ? e.checked : String(valueOf(e)).trim() !== ''))
    .map(field);

  const onClick = ev => {
    const el = ev.target.closest && ev.target.closest('button,a,[role],input,select,label,li,[onclick],[tabindex]') || ev.target;
    if (!el.closest || el.closest(OURS) || /^(input|select|textarea)$/.test(el.localName)) return; // campo vira passo "field"
    const isButton = /^(button|a)$/.test(el.localName) || /button|menuitem|option|tab/.test(el.getAttribute('role') || '');
    add('click', { target: S.describe(el), ...(isButton && { form: filled() }) });
  };
  const lastVal = new WeakMap();
  const onInput = ev => {
    const el = ev.target;
    if (!el.closest || el.closest(OURS)) return;
    const v = valueOf(el);
    if (lastVal.get(el) === v) return; // "change" depois do "input" com o mesmo valor
    lastVal.set(el, v);
    add('field', field(el)); // um passo por tecla; o background junta e deixa so o valor final
  };
  const onSubmit = ev => { if (!ev.target.closest(OURS)) add('submit', { target: S.describe(ev.target), form: filled() }); };
  const onKey = ev => { if (ev.key === 'Enter' && !ev.target.closest(OURS)) add('enter', { target: S.describe(ev.target) }); };

  // Mudanca de tela (SPA usa pushState/replaceState; voltar/avancar usa popstate)
  const H = history, push = H.pushState, replace = H.replaceState;
  let lastRoute = route();
  const nav = () => { if (route() !== lastRoute) { lastRoute = route(); add('screen', { title: document.title }); } };

  // O que aparece na tela (toast, modal, mensagem de erro): junta os textos novos a cada 600 ms.
  let shown = [], timer = null;
  const mo = new MutationObserver(muts => {
    for (const m of muts) {
      const nodes = m.type === 'characterData' ? [m.target.parentElement] : m.addedNodes; // texto novo ou texto que mudou
      for (const n of nodes) {
        if (!n || n.nodeType !== 1 || n.closest(OURS)) continue;
        const txt = (n.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 300);
        if (txt && !shown.includes(txt)) shown.push(txt);
      }
    }
    if (shown.length && !timer) timer = setTimeout(() => { add('appeared', { texts: shown.slice(0, 20) }); shown = []; timer = null; }, 600);
  });

  // O que o site guarda por dentro (localStorage/sessionStorage). Chave com cara de login sai mascarada.
  const SP = Storage.prototype, setItem = SP.setItem, removeItem = SP.removeItem;
  const where = st => (st === localStorage ? 'localStorage' : 'sessionStorage');
  const stVal = (k, v) => (/token|auth|session|senha|password|secret/i.test(k) ? '***' : String(v).slice(0, 5000));
  const mySet = function (k, v) {
    if (k !== 'mspa-rec' && this.getItem(k) !== String(v)) add('storage', { store: where(this), key: k, value: stVal(k, v) });
    return setItem.apply(this, arguments);
  };
  const myRemove = function (k) { if (k !== 'mspa-rec') add('storage', { store: where(this), key: k, removed: true }); return removeItem.apply(this, arguments); };

  const host = document.createElement('div');
  host.id = 'mspa-rec';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>div{position:fixed;left:12px;bottom:12px;z-index:2147483647;font:12px system-ui,sans-serif;background:#b91c1c;color:#fff;
    padding:8px 10px;border-radius:8px;display:flex;gap:8px;align-items:center}button{font:inherit;cursor:pointer}</style>
    <div role="status"><span></span><button>Parar e salvar</button></div>`;
  const msg = root.querySelector('span');
  const stopBtn = root.querySelector('button');
  const count = () => { msg.textContent = `● Gravando: ${nSteps} passos nesta tela`; };
  root.querySelector('button').onclick = () => stop();

  const opts = { capture: true };
  const EVENTS = [['click', onClick], ['input', onInput], ['change', onInput], ['submit', onSubmit], ['keydown', onKey]];

  const start = resumed => {
    recId = sessionStorage.getItem('mspa-rec');
    if (!recId) { recId = String(Date.now()); sessionStorage.setItem('mspa-rec', recId); }
    window.__MSPA_REC_ON = recId;
    for (const [e, f] of EVENTS) document.addEventListener(e, f, opts);
    addEventListener('popstate', nav);
    H.pushState = function () { const r = push.apply(this, arguments); nav(); return r; };
    H.replaceState = function () { const r = replace.apply(this, arguments); nav(); return r; };
    SP.setItem = mySet; SP.removeItem = myRemove;
    mo.observe(document.body, { childList: true, characterData: true, subtree: true });
    host.remove(); // pode ter sobrado de uma gravacao anterior
    if (!root.querySelector('button')) root.querySelector('div').append(stopBtn);
    document.documentElement.append(host);
    nSteps = 0; count();
    lastRoute = route();
    add('screen', { title: document.title, ...(resumed && { reloaded: true }) });
  };

  const stop = () => {
    if (!recId) return;
    for (const [e, f] of EVENTS) document.removeEventListener(e, f, opts);
    removeEventListener('popstate', nav);
    H.pushState = push; H.replaceState = replace;
    SP.setItem = setItem; SP.removeItem = removeItem;
    mo.disconnect();
    clearTimeout(timer); timer = null;
    if (shown.length) add('appeared', { texts: shown });
    shown = [];
    const id = recId;
    recId = null;
    window.__MSPA_REC_ON = null;
    sessionStorage.removeItem('mspa-rec');
    msg.textContent = 'Gravacao salva em Downloads/master-spa.';
    stopBtn.remove();
    setTimeout(() => host.remove(), 6000);
    // da tempo das ultimas chamadas chegarem ao storage antes de juntar
    setTimeout(() => window.postMessage({ mspa: 'rec-stop', recId: id }, '*'), 300);
  };

  window.__MSPA_RECORDER = { start, stop, active: () => !!recId };
  window.addEventListener('message', ev => {
    const d = ev.data;
    if (ev.source !== window || !d || d.mspa !== 'req' || d.cmd !== 'rec') return;
    if (recId) stop(); else start(false);
    window.postMessage({ mspa: 'res', id: d.id, res: { on: !!recId } }, '*');
  });
  // shortcut: a gravacao continua so na mesma aba e no mesmo site (sessionStorage); outra aba nao entra.
  if (sessionStorage.getItem('mspa-rec')) start(true);
})();
