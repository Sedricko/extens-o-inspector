// Teste sem internet: carrega a extensao no Chromium, abre pagina local "SPA" e confere scan, rede, export e painel.
// Rodar: node teste_extensao.js
const assert = require('assert');
const http = require('http');
const os = require('os'), fs = require('fs'), path = require('path');
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1'; // deixa o teste interceptar as chamadas do background
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

// Mini SPA de "criar frete": campos, select, botao que publica (POST), toast, mudanca de tela e localStorage.
const SPA = `<!doctype html><title>Criar frete</title><body><main>
<label>Origem<input id="orig"></label>
<div><label>Peso (ton)</label><div><input id="peso" type="number"></div></div>
<select id="veic" aria-label="Veiculo"><option value="">-</option><option value="2">Carreta</option></select>
<label><input id="rast" type="checkbox"> Rastreador</label>
<input id="pw" type="password" placeholder="Senha">
<button id="criar">Criar frete</button></main>
<script>
  const origEl = orig; origEl.addEventListener('input', () => { sessionStorage.setItem('sentryReplaySession', Date.now()); origEl.id = 'input-' + Math.random().toString(36).slice(2); }); // ruido e id novo a cada tecla, como na Fretebras
  document.getElementById('criar').onclick = async () => {
    const body = { origem: origEl.value, peso: +peso.value, veiculo: veic.value };
    const r = await (await fetch('/api/frete', { method: 'POST', body: JSON.stringify(body) })).json();
    localStorage.setItem('ultimoFrete', r.id);
    history.pushState(null, '', '/app/criado');
    location.href = '/app/fretes/' + r.id; // recarrega a pagina inteira, como a Fretebras faz
  };
  if (location.pathname.startsWith('/app/fretes/')) {
    document.querySelector('main').remove();
    setTimeout(() => { const t = document.createElement('div'); t.textContent = 'Frete publicado: ' + location.pathname.split('/').pop(); document.body.append(t); }, 300);
  }
</script></body>`;

(async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/api/frete') { res.setHeader('content-type', 'application/json'); return res.end('{"id":"SPMG-4BC4"}'); }
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
      await fetch('/api/t', { method: 'POST', body: JSON.stringify({ tokenFCM: 'SEGREDO3', freightCode: 'SPMG-1', code: 'SPGO-1770', zipcode: '123' }) });
      await new Promise(r => setTimeout(r, 200)); // a chamada entra no log depois de ler a resposta
      return window.__MSPA_NET.filter(n => n.url.endsWith('/api/t')).map(n => n.reqBody).join(' ');
    });
    assert.ok(!/SEGREDO/.test(masked) && masked.includes('SPMG-1') && masked.includes('SPGO-1770') && masked.includes('"123"'), masked);

    // Fase 3: gravador do que o usuario faz, sobrevivendo a recarga da pagina
    const app = await ctx.newPage();
    await app.addInitScript(() => { const a = Element.prototype.attachShadow; Element.prototype.attachShadow = function () { return a.call(this, { mode: 'open' }); }; }); // so no teste
    await app.goto(base + 'app');
    await app.waitForFunction(() => window.__MSPA_RECORDER);
    await app.bringToFront();
    assert.deepStrictEqual(await send('rec'), { on: true });
    await app.locator('input').first().pressSequentially('Jacarei');
    await app.fill('#peso', '25');
    await app.selectOption('#veic', '2');
    await app.check('#rast');
    await app.fill('#pw', 'minhasenha');
    await app.click('#criar');
    await app.waitForURL('**/app/fretes/SPMG-4BC4');
    await app.waitForSelector('text=Frete publicado: SPMG-4BC4');
    await app.waitForTimeout(800);
    await app.locator('#mspa-rec').getByText('Parar e salvar').click();
    await app.waitForTimeout(1500);
    // Playwright renomeia os downloads: le o ultimo arquivo salvo
    const files = await sw.evaluate(async () => (await chrome.downloads.search({ state: 'complete', orderBy: ['-startTime'] })).map(d => d.filename));
    assert.strictEqual(files.length, 2, 'export manual + salvamento ao parar a gravacao');
    const rec = JSON.parse(fs.readFileSync(files[0], 'utf8')).recording;
    const tl = rec.timeline;
    const fields = tl.filter(s => s.type === 'field');
    assert.deepStrictEqual(fields.filter(f => f.name === 'Origem').map(f => f.value), ['Jacarei'], 'digitacao vira um passo so');
    assert.ok(fields.some(f => f.name === 'Peso (ton)' && f.value === '25'), JSON.stringify(fields));
    assert.ok(fields.some(f => f.name === 'Veiculo' && f.value === 'Carreta'));
    assert.ok(fields.some(f => f.name === 'Rastreador' && f.value === true));
    assert.ok(!JSON.stringify(rec).includes('minhasenha'), 'senha nunca entra na gravacao');
    const click = tl.find(s => s.type === 'click' && s.target.text === 'Criar frete');
    assert.deepStrictEqual(click.form.map(f => [f.name, f.value]),
      [['Origem', 'Jacarei'], ['Peso (ton)', '25'], ['Veiculo', 'Carreta'], ['Rastreador', true], ['Senha', '***']]);
    const req = tl.find(s => s.type === 'request' && s.url.endsWith('/api/frete'));
    assert.ok(req.reqBody.includes('"origem":"Jacarei"') && req.resBody.includes('SPMG-4BC4'), JSON.stringify(req));
    assert.ok(tl.indexOf(click) < tl.indexOf(req), 'linha do tempo em ordem');
    assert.ok(tl.some(s => s.type === 'storage' && s.key === 'ultimoFrete' && s.value === 'SPMG-4BC4'));
    assert.ok(!tl.some(s => s.type === 'storage' && /sentry/.test(s.key)), 'memoria do Sentry e ruido');
    assert.ok(tl.some(s => s.type === 'screen' && s.route === '/app/criado'));
    // depois da recarga
    assert.ok(tl.some(s => s.type === 'screen' && s.route === '/app/fretes/SPMG-4BC4' && s.reloaded), 'continuou depois do F5');
    assert.ok(tl.some(s => s.type === 'appeared' && s.texts.includes('Frete publicado: SPMG-4BC4')));
    assert.deepStrictEqual(await sw.evaluate(async () => Object.keys(await chrome.storage.local.get(null))), [], 'passos apagados depois de salvar');
    assert.strictEqual(await app.evaluate(() => sessionStorage.getItem('mspa-rec')), null, 'gravador desligou');

    // Export grande (data: URL do background) continua salvando
    await app.evaluate(() => { for (let i = 0; i < 400; i++) window.__MSPA_NET.push({ url: 'x', resBody: 'x'.repeat(20000) }); });
    const big = await sw.evaluate(async () => { const [tab] = await chrome.tabs.query({ active: true }); return chrome.tabs.sendMessage(tab.id, { cmd: 'export' }); });
    assert.ok(big.ok, JSON.stringify(big));
    // Fretebras: pega a sessao quando a Central loga e publica pelo background (tudo falso, sem internet)
    const api = [];
    const jwt = exp => 'h.' + Buffer.from(JSON.stringify({ exp: Math.floor(exp / 1000) })).toString('base64url') + '.s';
    const F5 = `<!doctype html><body>Central depois do F5<script>
      localStorage.setItem('kc', JSON.stringify({ tokens: { access_token: '${jwt(Date.now() + 60e3)}', refresh_token: '${jwt(Date.now() + 20 * 864e5)}' } }));
    </script></body>`;
    await ctx.route('https://novacentral.fretebras.com.br/**', r => r.request().url().endsWith('/f5') ? r.fulfill({ contentType: 'text/html', body: F5 }) : r.fulfill({ contentType: 'text/html', body: `<!doctype html><body>Central<script>
      fetch('https://sso-external.fretebras.com.br/realms/companies/protocol/openid-connect/token', { method: 'POST', body: 'grant_type=authorization_code&code=x' })
        .then(() => { const x = new XMLHttpRequest(); x.open('GET', 'https://nca-gateway.fretebras.com.br/web/v1/home'); x.setRequestHeader('Authorization', 'Bearer APP1'); x.setRequestHeader('x-app', 'central'); x.send(); });
    </script></body>` }));
    await ctx.route('https://sso-external.fretebras.com.br/**', r => {
      const refresh = (r.request().postData() || '').includes('grant_type=refresh_token');
      api.push(refresh ? 'refresh' : 'login');
      r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(refresh ? { access_token: 'A2', expires_in: 3600 } : { access_token: 'A1', refresh_token: 'R1', expires_in: 30, refresh_expires_in: 2447186 }) });
    });
    await ctx.route('https://nca-gateway.fretebras.com.br/**', r => {
      const q = r.request(), h = q.headers(), u = new URL(q.url()).pathname, m = q.method();
      api.push(`${m} ${u} ${h.authorization} ${h['x-app']}`);
      if (!['Bearer APP1', 'Bearer A2'].includes(h.authorization)) return r.fulfill({ status: 401, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"error":"Unauthorized","status":401}' });
      const body = u === '/web/v1/user/me' ? { data: { id_hashed: 'BwZE7', company: { id_hashed: 'xO48' } } }
        : u.endsWith('/duplicated') ? { isDuplicated: false, freight: [] }
        : m === 'POST' ? { data: { id: 'T1', freightCode: 'GOSP-TEST' } }
        : m === 'DELETE' ? { data: { errors: [], success: ['T1'] } } : { data: {} };
      if (m === 'POST' && !u.endsWith('/duplicated')) api.push(q.postData());
      r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    });
    const central = await ctx.newPage();
    await central.goto('https://novacentral.fretebras.com.br/meus-fretes');
    await central.waitForTimeout(800);
    await central.close(); // daqui em diante sem aba da Fretebras
    const st = await sw.evaluate(() => fbStatus());
    assert.ok(st.active && st.until > Date.now() + 27 * 864e5, JSON.stringify(st));
    const saved = await sw.evaluate(async () => (await chrome.storage.session.get('fb')).fb);
    assert.deepStrictEqual([saved.refresh, saved.headers], ['R1', { 'x-app': 'central' }]);
    assert.deepStrictEqual(await sw.evaluate(async () => Object.keys(await chrome.storage.local.get(null))), [], 'sessao nunca vai para o disco');
    const pub = await sw.evaluate(() => fbPublishTest());
    assert.deepStrictEqual(pub, { id: 'T1', code: 'GOSP-TEST' });
    assert.ok(api.includes('POST /freight-management-bff/v1/freights Bearer APP1 central'), api.join('\n'));
    const sent = JSON.parse(api.find(a => a.startsWith('{"requestId"')));
    assert.ok(sent.requestId.startsWith('BwZE7-') && sent.freight.mainOwnerId === 'BwZE7' && sent.freight.productName === 'TESTE');
    assert.deepStrictEqual(await sw.evaluate(() => fbDeleteTest()), { deleted: 'GOSP-TEST' });
    assert.ok(api.includes('DELETE /freight-management-bff/v1/freights Bearer APP1 central'));
    // cabecalho do site venceu (aba fechada ha tempo): renova pelo refresh token do SSO
    await sw.evaluate(async () => { const { fb } = await chrome.storage.session.get('fb'); await chrome.storage.session.set({ fb: { ...fb, authExp: 0 } }); });
    await sw.evaluate(() => fbApi('GET', '/web/v1/user/me'));
    assert.ok(api.includes('refresh') && api.includes('GET /web/v1/user/me Bearer A2 central'), 'token de 30 s venceu e foi renovado');
    assert.deepStrictEqual(saved.diag, { names: ['authorization', 'x-app'], scheme: 'Bearer', sameAsSso: false, credentials: 'padrao (xhr)' });
    assert.ok(!JSON.stringify(saved.diag).includes('APP1'), 'diagnostico nao mostra o valor do login');
    // F5 com login ja feito: sem chamada ao SSO, a sessao vem do que o site guardou no navegador
    await sw.evaluate(() => chrome.storage.session.clear());
    const f5 = await ctx.newPage();
    await f5.goto('https://novacentral.fretebras.com.br/f5');   // grava o login no localStorage (como o site)
    await f5.reload();                                           // F5: a extensao le o que esta guardado
    await f5.waitForTimeout(500);
    const st5 = await sw.evaluate(() => fbStatus());
    assert.ok(st5.active && st5.renews && st5.until > Date.now() + 19 * 864e5, JSON.stringify(st5));
    await f5.close();
    await sw.evaluate(async () => { const { fb } = await chrome.storage.session.get('fb'); await chrome.storage.session.set({ fb: { ...fb, lastTest: null } }); });

    // outro site nao consegue mandar sessao falsa nem publicar
    const antes = (await sw.evaluate(async () => (await chrome.storage.session.get('fb')).fb)).refresh;
    await app.evaluate(() => window.postMessage({ mspa: 'session', token: { access_token: 'X', refresh_token: 'X', expires_in: 1, refresh_expires_in: 1 } }, '*'));
    await app.waitForTimeout(300);
    assert.strictEqual((await sw.evaluate(async () => (await chrome.storage.session.get('fb')).fb)).refresh, antes);

    console.log('OK: scan, React Fiber, rede (mascara), export, painel, gravador, export grande, sessao e publicacao Fretebras');
  } finally {
    await ctx.close(); server.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
