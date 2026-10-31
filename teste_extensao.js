// Teste sem internet: carrega a extensao no Chromium, abre pagina local "SPA" e confere scan, rede, export e painel.
// Rodar: node teste_extensao.js
const assert = require('assert');
const http = require('http');
const os = require('os'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');

const PAGE = `<!doctype html><title>SPA teste</title><body>
<button id="b1">Salvar</button><input id="nome" placeholder="Nome"><div id="fake" style="width:50px;height:20px">React</div>
<a href="#x">Link</a><div style="display:none"><button>escondido</button></div>
<script>
  function MeuBotao() {}
  const el = document.getElementById('fake');
  el.__reactFiber$abc = { memoizedProps: { onClick() { window.clicou = 1; }, children: 'x' }, return: { type: 'div', return: { type: MeuBotao, return: null } } };
  el.onclick = () => { window.clicou = 1; };
  let digitado = ''; document.getElementById('nome').addEventListener('input', e => { digitado = e.target.value; window.digitado = digitado; });
  fetch('/api/dados', { method: 'POST', body: JSON.stringify({ usuario: 'a', senha: 'segredo' }) });
  const x = new XMLHttpRequest(); x.open('GET', '/api/xhr'); x.send();
</script></body>`;

// Mini SPA com rotas (pushState), modal, botao que grava (POST) e botao perigoso.
const SPA = `<!doctype html><title>SPA rotas</title><body><nav><a href="/app">Inicio</a> <a href="/app/b">Pagina B</a> <a href="https://fora.example/x">Fora</a></nav><main></main>
<script>
  const main = document.querySelector('main');
  const render = () => {
    if (location.pathname === '/app/b') main.innerHTML = '<button id="nb">Na pagina B</button>';
    else main.innerHTML = '<button id="abrir">Abrir modal</button><button id="ex">Excluir tudo</button><button id="gr">Gravar rascunho</button><button id="nova">Nova aba</button>';
    const $ = id => document.getElementById(id);
    if ($('abrir')) {
      $('abrir').onclick = () => { const d = document.createElement('div'); d.innerHTML = '<button id="dm">Dentro do modal</button>'; main.append(d); $('dm').onclick = () => { window.dentro = 1; }; };
      $('ex').onclick = () => { window.excluiu = 1; };
      $('gr').onclick = () => fetch('/api/gravar', { method: 'POST', body: JSON.stringify({ rascunho: 1 }) }).catch(() => { window.bloqueado = 1; });
      $('nova').onclick = () => window.open('https://fora.example/nova');
    }
  };
  document.querySelector('nav').onclick = e => { const a = e.target.closest('a'); if (a && a.origin === location.origin) { e.preventDefault(); history.pushState(null, '', a.href); render(); } };
  addEventListener('popstate', render);
  render();
</script></body>`;

(async () => {
  let gravacoes = 0;
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/gravar') gravacoes++;
    if (req.url.startsWith('/app')) { res.setHeader('content-type', 'text/html'); return res.end(SPA); }
    if (req.url.startsWith('/api')) { res.setHeader('content-type', 'application/json'); return res.end('{"ok":true}'); }
    res.setHeader('content-type', 'text/html'); res.end(PAGE);
  }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}/`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mspa-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    headless: true, channel: 'chromium', acceptDownloads: true,
    args: [`--disable-extensions-except=${__dirname}`, `--load-extension=${__dirname}`],
  });
  try {
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
    const page = await ctx.newPage();
    await page.goto(base);
    await page.waitForFunction(() => window.__MSPA && window.__MSPA_NET.length >= 2);

    // popup -> content_manager -> main world (mesmo caminho do botao)
    const send = cmd => sw.evaluate(async cmd => {
      const [tab] = await chrome.tabs.query({ active: true });
      return chrome.tabs.sendMessage(tab.id, { cmd });
    }, cmd);

    const scan = await send('scan');
    assert.strictEqual(scan.count, 4, JSON.stringify(scan)); // b1, nome, fake (React), link; escondido fica fora
    assert.strictEqual(scan.react, 1);
    assert.strictEqual(scan.network, 2);

    assert.deepStrictEqual(await send('highlight'), { on: true });
    assert.strictEqual(await page.locator('#mspa-overlay > div').count(), 4);

    const dom = await page.evaluate(() => window.__MSPA.lastScan.items);
    const fake = dom.find(i => i.attrs.id === 'fake');
    assert.deepStrictEqual(fake.react.components, ['MeuBotao']);
    assert.deepStrictEqual(fake.react.handlers, ['onClick']);
    assert.strictEqual(dom.find(i => i.attrs.id === 'nome').selector, '#nome');

    const net = await page.evaluate(() => window.__MSPA_NET);
    const post = net.find(n => n.method === 'POST');
    assert.ok(post.reqBody.includes('"senha":"***"') && !post.reqBody.includes('segredo'), post.reqBody);
    assert.ok(net.find(n => n.type === 'xhr').resBody.includes('ok'));

    const exp = await send('export');
    assert.ok(exp.ok && /^master-spa\/127\.0\.0\.1-.*\.json$/.test(exp.filename), JSON.stringify(exp));

    // Fase 2: no uso real o popup injeta via executeScript (activeTab do clique); o teste nao tem esse clique.
    await page.evaluate(() => { const a = Element.prototype.attachShadow; Element.prototype.attachShadow = function () { return a.call(this, { mode: 'open' }); }; }); // so no teste: closed nao deixa o Playwright ver
    await page.addScriptTag({ path: path.join(__dirname, 'scripts/inject_panel.js') });
    const panel = page.locator('#mspa-panel');
    await panel.locator('input.v').fill('Maria');
    await panel.locator('li', { hasText: 'Nome' }).getByText('Digitar').click();
    await panel.locator('li', { hasText: 'React' }).getByText('Clicar').click();
    assert.strictEqual(await page.evaluate(() => window.digitado), 'Maria');
    assert.strictEqual(await page.evaluate(() => window.clicou), 1);
    await panel.locator('input.f').fill('meubotao');
    assert.strictEqual(await panel.locator('li').count(), 1);

    // Mascara codigo e tokens do login, sem pegar campos como freightCode/zipcode
    const masked = await page.evaluate(async () => {
      await fetch('/api/t', { method: 'POST', body: 'grant_type=x&code=SEGREDO1&code_verifier=SEGREDO2' });
      await fetch('/api/t', { method: 'POST', body: JSON.stringify({ tokenFCM: 'SEGREDO3', freightCode: 'SPMG-1', zipcode: '123' }) });
      return window.__MSPA_NET.slice(-2).map(n => n.reqBody).join(' ');
    });
    assert.ok(!/SEGREDO/.test(masked) && masked.includes('SPMG-1') && masked.includes('"123"'), masked);

    // Fase 3: explorador em modo seguro
    const app = await ctx.newPage();
    await app.goto(base + 'app');
    await app.waitForFunction(() => window.__MSPA);
    await app.evaluate(() => { window.__MSPA_WAIT = 150; });
    await app.addScriptTag({ path: path.join(__dirname, 'scripts/inject_explorer.js') });
    await app.waitForFunction(() => window.__MSPA_MAP && window.__MSPA_MAP.done, null, { timeout: 30000 });
    const map = await app.evaluate(() => window.__MSPA_MAP);
    assert.deepStrictEqual(Object.keys(map.routes).sort(), ['/app', '/app/b'], JSON.stringify(Object.keys(map.routes)));
    const acts = map.routes['/app'].actions;
    const find = t => acts.find(a => a.text === t);
    assert.strictEqual(find('Excluir tudo').skipped, 'parece perigoso');
    assert.strictEqual(await app.evaluate(() => window.excluiu), undefined);
    assert.strictEqual(await app.evaluate(() => window.dentro), 1, 'clicou dentro do modal');
    const gr = find('Gravar rascunho').requests[0];
    assert.ok(gr.blocked && gr.method === 'POST' && gr.reqBody.includes('rascunho'), JSON.stringify(gr));
    assert.strictEqual(gravacoes, 0, 'POST nao pode chegar no servidor');
    assert.strictEqual(find('Fora').external, 'https://fora.example/x');
    assert.strictEqual(map.opened[0].url, 'https://fora.example/nova');
    assert.ok(map.routes['/app/b'].actions.some(a => a.text === 'Na pagina B' && !a.skipped));
    assert.strictEqual(await app.evaluate(() => window.__MSPA_SAFE), false, 'modo seguro desliga no fim');
    await app.waitForTimeout(500);
    // Playwright renomeia os downloads; conta os concluidos
    const salvos = await sw.evaluate(async () => (await chrome.downloads.search({ state: 'complete' })).length);
    assert.strictEqual(salvos, 2, 'export manual + salvamento automatico do explorador');
    assert.strictEqual(await app.evaluate(() => fetch('/api/gravar', { method: 'POST' }).then(r => r.status)), 200);
    assert.strictEqual(gravacoes, 1);

    // Export grande (data: URL do background) continua salvando
    await app.evaluate(() => { for (let i = 0; i < 400; i++) window.__MSPA_NET.push({ url: 'x', resBody: 'x'.repeat(20000) }); });
    const big = await sw.evaluate(async () => { const [tab] = await chrome.tabs.query({ active: true }); return chrome.tabs.sendMessage(tab.id, { cmd: 'export' }); });
    assert.ok(big.ok, JSON.stringify(big));
    console.log('OK: scan, React Fiber, rede (mascara), export, painel, explorador em modo seguro, export grande');
  } finally {
    await ctx.close(); server.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
