// Fase 3, Main World: grava o que o usuario faz (campos, cliques, telas), as chamadas de rede e o que aparece na tela.
// Clicar de novo (ou em "Parar e salvar") encerra, monta a linha do tempo em __MSPA_REC e salva o JSON.
(() => {
  const S = window.__MSPA;
  if (!S) return alert('Master SPA: recarregue a pagina (F5) e tente de novo.');
  if (window.__MSPA_RECORDER) return window.__MSPA_RECORDER.stop();

  const OURS = '#mspa-rec,#mspa-panel,#mspa-overlay';
  const SECRET = /senha|password|cvv|cartao|card/i;
  const route = () => location.pathname + location.search;
  const t0 = Date.now();
  const steps = [];
  const add = (type, data) => { const s = { t: Date.now(), type, route: route(), ...data }; steps.push(s); count(); return s; };

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
    const d = S.describe(el);
    const step = add('click', { target: d });
    if (/^(button|a)$/.test(el.localName) || /button|menuitem|option|tab/.test(el.getAttribute('role') || '')) step.form = filled();
  };
  let lastInput = null;
  const lastVal = new WeakMap();
  const onInput = ev => {
    const el = ev.target;
    if (!el.closest || el.closest(OURS)) return;
    const v = valueOf(el);
    if (lastVal.get(el) === v) return; // "change" depois do "input" com o mesmo valor
    lastVal.set(el, v);
    // Digitar gera um evento por tecla: junta tudo num passo so por campo.
    if (lastInput && lastInput.el === el && steps[steps.length - 1] === lastInput.step) { Object.assign(lastInput.step, field(el), { t: Date.now() }); return; }
    lastInput = { el, step: add('field', field(el)) };
  };
  const onSubmit = ev => { if (!ev.target.closest(OURS)) add('submit', { target: S.describe(ev.target), form: filled() }); };
  const onKey = ev => { if (ev.key === 'Enter' && !ev.target.closest(OURS)) add('enter', { target: S.describe(ev.target) }); };

  // Mudanca de tela (SPA usa pushState/replaceState; voltar/avancar usa popstate)
  const H = history, push = H.pushState, replace = H.replaceState;
  let lastRoute = route();
  const nav = () => { if (route() !== lastRoute) { lastRoute = route(); add('screen', { title: document.title }); } };
  H.pushState = function () { const r = push.apply(this, arguments); nav(); return r; };
  H.replaceState = function () { const r = replace.apply(this, arguments); nav(); return r; };

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
  SP.setItem = function (k, v) {
    if (this.getItem(k) !== String(v)) add('storage', { store: where(this), key: k, value: stVal(k, v) });
    return setItem.apply(this, arguments);
  };
  SP.removeItem = function (k) { add('storage', { store: where(this), key: k, removed: true }); return removeItem.apply(this, arguments); };

  const host = document.createElement('div');
  host.id = 'mspa-rec';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>div{position:fixed;left:12px;bottom:12px;z-index:2147483647;font:12px system-ui,sans-serif;background:#b91c1c;color:#fff;
    padding:8px 10px;border-radius:8px;display:flex;gap:8px;align-items:center}button{font:inherit;cursor:pointer}</style>
    <div role="status"><span></span><button>Parar e salvar</button></div>`;
  const msg = root.querySelector('span');
  const count = () => { msg.textContent = `● Gravando: ${steps.length} passos`; };
  root.querySelector('button').onclick = () => stop();

  const opts = { capture: true };
  const stop = () => {
    document.removeEventListener('click', onClick, opts);
    document.removeEventListener('input', onInput, opts);
    document.removeEventListener('change', onInput, opts);
    document.removeEventListener('submit', onSubmit, opts);
    document.removeEventListener('keydown', onKey, opts);
    H.pushState = push; H.replaceState = replace;
    SP.setItem = setItem; SP.removeItem = removeItem;
    removeEventListener('popstate', nav);
    mo.disconnect();
    clearTimeout(timer);
    if (shown.length) add('appeared', { texts: shown });
    delete window.__MSPA_RECORDER;
    const end = Date.now();
    const net = (window.__MSPA_NET || []).filter(n => n.t >= t0 && n.t <= end).map(n => ({ ...n, type: 'request', via: n.type }));
    window.__MSPA_REC = {
      start: new Date(t0).toISOString(), end: new Date(end).toISOString(), url: location.href,
      timeline: [...steps, ...net].sort((a, b) => a.t - b.t).map(s => ({ ...s, sec: +((s.t - t0) / 1000).toFixed(1) })),
    };
    msg.textContent = `Salvo: ${steps.length} passos e ${net.length} chamadas em Downloads/master-spa.`;
    root.querySelector('button').remove();
    setTimeout(() => host.remove(), 6000);
    window.postMessage({ mspa: 'save' }, '*'); // content_manager pede o export e o background salva
  };

  document.addEventListener('click', onClick, opts);
  document.addEventListener('input', onInput, opts);
  document.addEventListener('change', onInput, opts);
  document.addEventListener('submit', onSubmit, opts);
  document.addEventListener('keydown', onKey, opts);
  addEventListener('popstate', nav);
  mo.observe(document.body, { childList: true, characterData: true, subtree: true });
  document.documentElement.append(host);
  window.__MSPA_RECORDER = { stop };
  add('screen', { title: document.title });
  // shortcut: so na memoria da aba; se a pagina recarregar inteira a gravacao se perde (SPA normal nao recarrega).
})();
