// Main World: preenche o formulario "Criar frete" da Central como um usuario faria (clica, digita, escolhe).
// Quem assina e envia a chamada e o proprio site. Este script NAO clica em "Publicar Frete".
(() => {
  if (window.__MSPA_FILL) return;
  const OURS = '#mspa-rec,#mspa-panel,#mspa-overlay,#mspa-fill';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const visible = el => el.getClientRects().length > 0;
  const waitFor = async (fn, what, ms = 10000) => {
    for (const t0 = Date.now(); ; await sleep(150)) {
      const v = fn();
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error(`nao achei ${what}`);
    }
  };

  // Texto: string (igual), {start} (comeca com) ou {re} (expressao, sem acento e minuscula).
  const test = m => { const n = typeof m === 'string' ? norm(m) : null; return t => (n !== null ? t === n : m.start ? t.startsWith(norm(m.start)) : new RegExp(m.re).test(t)); };
  const show = m => (typeof m === 'string' ? m : m.start || m.re);
  const find = m => {
    const ok = test(m);
    const hits = [...document.body.querySelectorAll('*')].filter(e => !e.closest(OURS) && visible(e) && ok(norm(e.innerText)));
    return hits.find(e => !hits.some(o => o !== e && e.contains(o))); // o mais interno
  };

  const isOn = el => {
    const radio = 'input[type=checkbox],input[type=radio]';
    const inp = el.matches(radio) ? el : el.querySelector(radio) || (el.closest('label') && el.closest('label').querySelector(radio));
    if (inp) return inp.checked;
    const a = el.closest('[aria-checked],[aria-pressed],[aria-selected]');
    const v = a && (a.getAttribute('aria-checked') || a.getAttribute('aria-pressed') || a.getAttribute('aria-selected'));
    return v === null || v === undefined ? null : v === 'true';
  };
  const click = el => {
    el.scrollIntoView({ block: 'center' });
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  };
  const setValue = (el, value) => {
    el.focus();
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, value); // sem isso o React ignora
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const inputOf = (label, tag) => {
    const sel = tag === 'textarea' ? 'textarea' : 'input:not([type=hidden]),textarea';
    const l = find(label);
    for (let n = l, i = 0; n && i < 5; n = n.parentElement, i++) {
      const f = n.querySelector(sel);
      if (f) return f;
    }
    // campo sem texto de rotulo na tela: o nome pode estar no placeholder ou no aria-label
    return [...document.querySelectorAll('input:not([type=hidden]),textarea')]
      .find(e => visible(e) && [e.placeholder, e.getAttribute('aria-label')].some(v => norm(v) === norm(label)));
  };

  let notes = [];
  const steps = {
    // Digita e, se tiver "pick", escolhe a opcao da lista que aparece (cidades vem de uma busca)
    async text(s) {
      const el = await waitFor(() => inputOf(s.label, s.tag), `o campo "${s.label}"`);
      const max = s.max || (el.maxLength > 0 ? el.maxLength : 0); // o site limita o tamanho (produto: 30)
      const value = max && s.value.length > max ? s.value.slice(0, max) : s.value;
      if (value !== s.value) notes.push(`"${s.label}" aceita ${max} caracteres: ficou "${value}"`);
      setValue(el, value);
      if (!s.pick) return;
      await sleep(1200); // a lista de sugestoes demora um pouco depois de digitar
      click(await waitFor(() => find(s.pick), `a opcao "${s.pick}"`));
      await sleep(400);
    },
    async pick(s) { // abre uma lista e escolhe (o campo pode estar desabilitado ate o anterior ser escolhido)
      let opt;
      for (let i = 0; i < 3 && !opt; i++) {
        click(await waitFor(() => find(s.open), `"${s.open}"`));
        opt = await waitFor(() => find(s.text), '', 3000).catch(() => null);
      }
      if (!opt) throw new Error(`nao achei a opcao "${s.text}" (o campo "${s.open}" abriu?)`);
      click(opt);
      await sleep(500);
    },
    async toggle(s) { // liga so se ainda nao estiver ligado (clicar de novo desligaria)
      const el = await waitFor(() => find(s.text), `"${show(s.text)}"`);
      if (isOn(el) !== true) click(el);
      await sleep(300);
    },
    async switch(s) { // interruptor ao lado de um rotulo (s.on: false = garante desligado)
      const l = await waitFor(() => find(s.label), `"${s.label}"`);
      for (let n = l, i = 0; n && i < 5; n = n.parentElement, i++) {
        const t = n.querySelector('input[type=checkbox],input[type=radio],[role=switch],[role=checkbox]');
        if (t) { if ((isOn(t) === true) !== (s.on !== false)) click(t); await sleep(300); return; }
      }
      throw new Error(`nao achei o interruptor de "${s.label}"`);
    },
  };

  const nameOf = el => {
    const own = el.closest('label');
    if (own && own.innerText.trim()) return own.innerText.trim().replace(/\s+/g, ' ').slice(0, 70);
    for (let n = el, i = 0; n && i < 5; n = n.parentElement, i++) {
      const l = n.querySelector('label,legend');
      if (l && l.innerText.trim()) return l.innerText.trim().replace(/\s+/g, ' ').slice(0, 70);
    }
    return el.name || el.id || '';
  };
  const summary = () => [...document.querySelectorAll('input,textarea,select')]
    .filter(e => !e.closest(OURS) && e.type !== 'hidden' && visible(e) && (/^(checkbox|radio)$/.test(e.type) ? e.checked : e.value))
    .map(e => ({ campo: nameOf(e), valor: /^(checkbox|radio)$/.test(e.type) ? true : e.value }));

  const fill = async list => {
    let n = 0;
    notes = [];
    try {
      for (const s of list) { await steps[s.type](s); n++; }
      const botao = find('Publicar Frete');
      if (botao) botao.scrollIntoView({ block: 'center' });
      return { ok: true, done: n, notes, summary: summary() };
    } catch (e) {
      return { ok: false, done: n, notes, step: JSON.stringify(list[n]), error: String(e.message || e), summary: summary() };
    }
  };

  const banner = (ok, text) => {
    const old = document.getElementById('mspa-fill');
    if (old) old.remove();
    const host = document.createElement('div');
    host.id = 'mspa-fill';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>div{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;font:13px system-ui,sans-serif;padding:10px 14px;
      border-radius:8px;color:#fff;max-width:640px;display:flex;gap:10px;align-items:center;background:${ok ? '#15803d' : '#b91c1c'}}button{font:inherit;cursor:pointer}</style>
      <div role="status"><span></span><button>Fechar</button></div>`;
    root.querySelector('span').textContent = text;
    root.querySelector('button').onclick = () => host.remove();
    document.documentElement.append(host);
  };
  const doFill = fill;
  const fillAndTell = async list => {
    const r = await doFill(list);
    const s = r.ok ? null : JSON.parse(r.step);
    banner(r.ok, r.ok
      ? `Master SPA: formulario preenchido (${r.done} passos). Confira tudo e clique em Publicar Frete.` + (r.notes.length ? ` Atencao: ${r.notes.join('; ')}.` : '')
      : `Master SPA: parou no passo ${r.done + 1} (${s.label || s.open || (typeof s.text === 'string' ? s.text : s.text && (s.text.start || s.text.re))}): ${r.error}. O que ja foi preenchido ficou na tela.`);
    return r;
  };

  // Clica em Publicar Frete e le o codigo que o site mostra. Uma tentativa so: nunca repete (evita frete duplicado).
  const publish = async () => {
    const btn = find('Publicar Frete');
    if (!btn) return { ok: false, error: 'nao achei o botao Publicar Frete' };
    click(btn);
    try {
      await waitFor(() => find({ re: '^frete publicado' }), '', 30000);
    } catch {
      const avisos = document.body.innerText.split('\n').map(l => l.trim()).filter(l => /^(informe|selecione|preencha|erro|ja existe)/i.test(norm(l))).slice(0, 3);
      const error = 'a confirmacao "Frete publicado" nao apareceu' + (avisos.length ? ` (o site avisou: ${avisos.join(' / ')})` : '');
      banner(false, `Master SPA: ${error}. Confira em Meus Fretes se o frete saiu.`);
      return { ok: false, error, clicou: true };
    }
    await sleep(500);
    const code = (document.body.innerText.match(/Frete\s+([A-Z]{2,4}-[A-Z0-9]{3,5})/) || [])[1] || null;
    return { ok: true, code };
  };

  window.__MSPA_FILL = fillAndTell;
  window.addEventListener('message', async ev => {
    const d = ev.data;
    if (ev.source !== window || !d || d.mspa !== 'req' || !/^(fill(-ready)?|publish)$/.test(d.cmd)) return;
    const res = d.cmd === 'fill-ready' ? { ready: !!find('Local da coleta') } : d.cmd === 'publish' ? await publish() : await fillAndTell(d.arg); // pronto = o formulario ja esta na tela
    window.postMessage({ mspa: 'res', id: d.id, res }, '*');
  });
})();
