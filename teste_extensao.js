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

// Formulario falso "Criar frete": lista de cidades que demora, campo que aparece depois, botao ja ligado, interruptor.
const FORM = `<!doctype html><meta charset="utf-8"><title>Criar frete</title><body>
<div><label>Local da coleta</label><input id="c1"><ul id="l1"></ul></div>
<div><label>Local da entrega</label><input id="c2"><ul id="l2"></ul></div>
<div id="tipo">Tipo da carga</div><ul id="ltipo"></ul>
<div id="esp" aria-disabled="true">Espécie da carga</div><ul id="lesp"></ul>
<div><input id="prod" placeholder="Qual produto será carregado?"></div>
<div><span>Quantidade de volume</span><input id="qtd"></div>
<label id="peso">Conforme peso da carga<input type="radio" id="rpeso"></label><div id="pt"></div>
<div><span>Precisa de rastreador?</span><div role="switch" aria-checked="false" id="rast"></div></div>
<div class="v" id="vc">Carreta<br>Sugerido 5 eixos – até 26.5 ton</div>
<div class="v" id="vt">Truck<br>Sugerido 3 eixos – até 15 ton</div>
<div class="v" id="vls">Carreta LS<br>Sugerido 6 eixos – até 33 ton</div>
<div id="carr">Carregando veículo...</div>
<div class="b" id="bau" aria-pressed="false">Baú</div><div class="b" id="sider" aria-pressed="false">Sider</div>
<div><label>Observações adicionais</label><textarea id="obs"></textarea></div>
<div id="resto"></div>
<button id="pub">Publicar Frete</button>
<script>
  // a Central recarrega a pagina uma vez no inicio (login); isso corta o preenchimento no meio
  if (!sessionStorage.getItem('r')) { sessionStorage.setItem('r', '1'); setTimeout(() => location.reload(), 1500); }
  navigator.sendBeacon('/api/abre'); addEventListener('pagehide', () => navigator.sendBeacon('/api/fecha'));
  window.log = [];
  const lista = (inp, ul, nome) => inp.addEventListener('input', () => setTimeout(() => {
    ul.innerHTML = '<li>' + nome + '</li><li>Outra - XX</li>';
    ul.firstChild.onclick = () => { inp.value = nome; ul.innerHTML = ''; log.push(inp.id + '=' + nome); };
  }, 400));
  lista(c1, l1, 'Extrema - MG'); lista(c2, l2, 'Frutal - MG');
  tipo.onclick = () => { ltipo.innerHTML = '<li>Carga Geral</li>'; ltipo.firstChild.onclick = () => { ltipo.innerHTML = ''; esp.removeAttribute('aria-disabled'); log.push('tipo=Carga Geral'); }; };
  esp.onclick = () => { if (esp.hasAttribute('aria-disabled')) return; lesp.innerHTML = '<li>Caixa</li><li>Pallet</li>'; lesp.lastChild.onclick = () => { lesp.innerHTML = ''; log.push('esp=Pallet'); }; };
  rpeso.onchange = () => { pt.innerHTML = '<label>Peso total em toneladas<input id="pt1"></label>'; };
  rast.onclick = () => { rast.setAttribute('aria-checked', rast.getAttribute('aria-checked') === 'false'); };
  vt.onclick = () => log.push('Truck'); vc.onclick = () => log.push('Carreta'); vls.onclick = () => log.push('LS');
  for (const b of document.querySelectorAll('.b')) b.onclick = () => { b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'false'); };
  for (const t of ['A combinar', 'Pix', 'TED', 'Crédito em cartão', 'Cheque', 'E-frete', 'Outro', 'Plus Alta exposição Grátis Incluso no plano']) {
    const d = document.createElement('div'); d.className = 'b'; d.setAttribute('aria-pressed', 'false'); d.textContent = t;
    d.onclick = () => d.setAttribute('aria-pressed', d.getAttribute('aria-pressed') === 'false'); resto.append(d);
  }
  // a lista de veiculos recarrega 2,5 s depois do peso e apaga o que ja estava marcado (como a Fretebras faz)
  setTimeout(() => { carr.remove(); for (const b of document.querySelectorAll('.v')) b.dataset.on = ''; }, 2500);
  const voce = document.createElement('div'); voce.className = 'b'; voce.id = 'voce'; voce.setAttribute('aria-pressed', 'false'); voce.textContent = 'Você operacional2.go@trpoloni.com.br · (28) 98113-0644';
  voce.onclick = () => voce.setAttribute('aria-pressed', voce.getAttribute('aria-pressed') === 'false'); resto.append(voce);
  pub.onclick = () => { log.push('PUBLICOU'); navigator.sendBeacon('/api/pub'); setTimeout(() => { document.body.innerHTML = '<h1>Frete publicado com alta exposição</h1><p>Frete SPGO-1770 · Goiânia - GO → São Paulo - SP</p>'; }, 500); };
</script></body>`;

// Meus Fretes falso: busca por codigo, caixa de selecao, barra Desativar/Excluir e confirmacao (como a recording mostrou).
const MEUS = `<!doctype html><meta charset="utf-8"><title>Meus fretes</title><body>
<div>Ativos: 3</div><input id="q" placeholder="Buscar frete"><label><input type="checkbox" id="all"></label>
<div id="lista"></div><div id="barra" hidden><button>Desativar</button><button>Excluir</button></div><div id="modal"></div><div id="toast"></div>
<script>
  const CODIGOS = ['MGMG-27DE', 'MGMG-3401', 'SPSP-26E9', 'SPSP-26E9X'];
  const desenha = f => { lista.innerHTML = CODIGOS.filter(c => c.toLowerCase().includes(f.toLowerCase())).map(c => '<div><label><input type="checkbox" class="f"> ' + c + '</label> Extrema, MG</div>').join(''); };
  desenha('');
  q.addEventListener('input', () => setTimeout(() => desenha(q.value), 300));
  lista.addEventListener('change', () => { barra.hidden = !lista.querySelector('.f:checked'); });
  for (const b of barra.querySelectorAll('button')) b.onclick = () => {
    const acao = b.textContent;
    modal.innerHTML = '<div><h3>' + acao + ' frete</h3><p>Voce nao vera mais esse frete. Tem certeza?</p><button>' + acao + '</button></div>';
    modal.querySelector('button').onclick = () => {
      const cod = lista.querySelector('.f:checked').parentElement.textContent.trim();
      fetch('/api/fechou', { method: 'POST', body: JSON.stringify({ acao, cod }) }).then(() => { // como o site: so avisa depois da resposta
        toast.textContent = acao === 'Excluir' ? 'O frete foi excluído com sucesso.' : 'O frete ' + cod + ' foi desativado.';
      });
    };
  };
</script></body>`;

(async () => {
  const fechou = [];
  let ativosFake = 0, abertas = 0, maxAbertas = 0; // "Ativos: N" da Fretebras falsa e quantas paginas de formulario estao abertas ao mesmo tempo
  const eventos = []; // ordem em que os fretes foram fechados e publicados
  let semFormulario = false;
  const linhasPlanilha = [];
  // planilha falsa = aplicativo da web do Apps Script (senha, leitura, reserva/escrita com "esperado" e "confere")
  const nrm = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const planilha = http.createServer((req, res) => {
    const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    const url = new URL(req.url, 'http://x');
    let corpo = '';
    req.on('data', d => { corpo += d; });
    req.on('end', () => {
      if (url.pathname === '/morto') return res.writeHead(404, { 'access-control-allow-origin': '*', 'content-type': 'text/html' }).end('<html>Desculpe, nao foi possivel abrir o arquivo.</html>');
      if (url.pathname === '/login') return res.writeHead(200, { 'access-control-allow-origin': '*', 'content-type': 'text/html' }).end('<html><a href="https://accounts.google.com/ServiceLogin">Fazer login</a></html>');
      if (req.method === 'GET') {
        if (url.searchParams.get('token') !== 't') return res.writeHead(200, cors).end(JSON.stringify({ ok: false, erro: 'senha invalida' }));
        return res.writeHead(200, cors).end(JSON.stringify({ ok: true, linhas: linhasPlanilha.map((l, i) => ({ linha: i + 2, ...l })).filter(l => l.origem || l.status) }));
      }
      const b = JSON.parse(corpo);
      if (b.token !== 't') return res.writeHead(200, cors).end(JSON.stringify({ ok: false, erro: 'senha invalida' }));
      const gravadas = [], ignoradas = [];
      for (const u of b.atualizacoes) {
        const l = linhasPlanilha[u.linha - 2];
        if (!l) { ignoradas.push({ linha: u.linha }); continue; }
        if (u.esperado && !u.esperado.map(nrm).includes(nrm(l.status))) { ignoradas.push({ linha: u.linha, motivo: 'STATUS mudou' }); continue; }
        if (u.confere && (nrm(l.origem) !== nrm(u.confere.origem) || nrm(l.destino) !== nrm(u.confere.destino))) { ignoradas.push({ linha: u.linha }); continue; }
        l.status = u.status; if (u.codigo !== undefined) l.codigo = u.codigo; gravadas.push(u.linha);
      }
      res.writeHead(200, cors).end(JSON.stringify({ ok: true, gravadas, ignoradas }));
    });
  }).listen(0);
  let formBody = FORM;
  const server = http.createServer((req, res) => {
    if (req.url === '/meus-fretes/cadastrar') { res.setHeader('content-type', 'text/html'); return res.end(semFormulario ? '<!doctype html><body>Entrar</body>' : formBody); }
    if (req.url === '/meus-fretes') { res.setHeader('content-type', 'text/html'); return res.end(semFormulario ? '<!doctype html><body>Entrar</body>' : MEUS.replace('Ativos: 3', 'Ativos: ' + ativosFake)); }
    if (req.url === '/api/pub') { eventos.push('publicar'); return res.end('{}'); }
    if (req.url === '/api/abre') { abertas++; maxAbertas = Math.max(maxAbertas, abertas); return res.end('{}'); }
    if (req.url === '/api/fecha') { abertas--; return res.end('{}'); }
    if (req.url === '/api/fechou') { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => { fechou.push(JSON.parse(b)); eventos.push('fechar'); if (ativosFake > 0) ativosFake--; res.end('{}'); }); return; }
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
    await ctx.route('https://novacentral.fretebras.com.br/**', r => r.request().url().endsWith('/f5') ? r.fulfill({ contentType: 'text/html', body: F5 })
      : r.fulfill({ contentType: 'text/html', body: `<!doctype html><body>Central<script>
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

    // Preenche o formulario numa aba em segundo plano, sem publicar
        formBody = FORM;
    const fill = await sw.evaluate(b => fbFillTest(b), base);
    assert.ok(fill.ok, JSON.stringify(fill));
    const form = ctx.pages().find(p => p.url() === base + 'meus-fretes/cadastrar');
    // preencher DE NOVO a mesma pagina (cidades ja escolhidas): nao pode falhar nem escolher outra vez
    const antesLog = await form.evaluate(() => window.log.length);
    const de_novo = await sw.evaluate(async () => { // acha a aba do formulario pelo que ela responde (a extensao de teste nao ve enderecos locais)
      for (const t of await chrome.tabs.query({})) {
        const r = await chrome.tabs.sendMessage(t.id, { cmd: 'fill-ready' }).catch(() => null);
        if (r && r.ready) return chrome.tabs.sendMessage(t.id, { cmd: 'fill', arg: linhaParaPassos(LINHA_PADRAO).passos });
      }
      return { ok: false, error: 'nao achei a aba do formulario' };
    });
    assert.ok(de_novo.ok, 'segunda passada na mesma pagina: ' + JSON.stringify(de_novo));
    const logTudo = await form.evaluate(() => window.log);
    assert.ok(!logTudo.slice(antesLog).some(x => /^c[12]=/.test(x)), 'nao escolheu as cidades outra vez');
    const log = logTudo.slice(0, antesLog); // o resto das verificacoes e da primeira passada
    assert.deepStrictEqual(log.filter(x => x !== 'LS'), ['c1=Extrema - MG', 'c2=Frutal - MG', 'tipo=Carga Geral', 'esp=Pallet', 'Carreta']);
    assert.ok(!log.includes('PUBLICOU') && !log.includes('LS'), 'nao publica e nao mexe em outro veiculo');
    assert.strictEqual(await form.inputValue('#prod'), 'MATERIAL DE EMBALAGEM - PALLET', 'o padrao ja cabe em 30 caracteres');
    assert.strictEqual(await form.inputValue('#obs'), 'PALETES: 28 PAL');
    assert.strictEqual(await form.inputValue('#qtd'), '', 'nao confunde a observacao com outro campo');
    assert.deepStrictEqual(fill.notes, []);
    assert.strictEqual(await form.inputValue('#pt1'), '25');
    assert.strictEqual(await form.getAttribute('#rast', 'aria-checked'), 'true');
    assert.strictEqual(await form.getAttribute('#sider', 'aria-pressed'), 'true');
    assert.strictEqual(await form.getAttribute('#bau', 'aria-pressed'), 'false', 'so a carroceria pedida');
    assert.ok(fill.summary.some(x => x.campo === 'Local da coleta' && x.valor === 'Extrema - MG'), JSON.stringify(fill.summary));
    assert.ok(fill.summary.some(x => x.campo === 'Conforme peso da carga' && x.valor === true), JSON.stringify(fill.summary));
    assert.deepStrictEqual(await form.$$eval('#resto .b', els => els.map(e => e.getAttribute('aria-pressed'))), ['true', 'false', 'false', 'false', 'false', 'false', 'true', 'true', 'true']); // o ultimo e o "Voce"
    const ativa = await sw.evaluate(async () => (await chrome.tabs.query({ active: true })).map(t => t.url));
    assert.ok(!ativa.some(u => (u || '').endsWith('/meus-fretes/cadastrar')), 'nao tira voce da sua aba: ' + ativa);
    await form.close();
    // Linha da planilha diferente do padrao: Truck, Bau, sem rastreador e produto longo (cortado, "|" vira "-")
    const linha = { origem: 'EXTREMA/MG', destino: 'FRUTAL/MG', produto: 'MATERIAL DE EMBALAGEM | PALLET VAZIO', valor: 'A combinar', peso: '14 Ton', paletes: '', veiculo: 'Truck', carroceria: 'Baú', rastreada: 'Não', lona: 'Não', pagamento: 'Outro', observacoes: '' };
    const v = await sw.evaluate(({ b, l }) => fbFillTest(b, false, l), { b: base, l: linha });
    assert.ok(v.ok, JSON.stringify(v));
    const form2 = ctx.pages().find(p => p.url() === base + 'meus-fretes/cadastrar');
    const log2 = await form2.evaluate(() => window.log);
    assert.ok(log2.includes('Truck') && !log2.includes('Carreta'), log2.join());
    assert.strictEqual(await form2.getAttribute('#rast', 'aria-checked'), 'false', 'rastreada Nao: nao liga');
    assert.strictEqual(await form2.getAttribute('#bau', 'aria-pressed'), 'true');
    assert.strictEqual(await form2.getAttribute('#sider', 'aria-pressed'), 'false');
    assert.strictEqual(await form2.inputValue('#prod'), 'MATERIAL DE EMBALAGEM - PALLET');
    assert.ok(v.notes.length === 1 && /30 caracteres/.test(v.notes[0]), JSON.stringify(v.notes));
    assert.strictEqual(await form2.inputValue('#obs'), '', 'sem paletes nem observacao: nao escreve');
    await form2.close();
    assert.rejects(sw.evaluate(() => fbFillTest(undefined, false, { origem: 'X' })), /Linha invalida/);

    // Publicar: clica, le o codigo e fecha so a aba que abriu
    const abasAntes = ctx.pages().length;
    const publicou = await sw.evaluate(b => fbFillTest(b, true), base);
    assert.ok(publicou.ok && publicou.code === 'SPGO-1770', JSON.stringify(publicou));
    await new Promise(r => setTimeout(r, 500));
    assert.ok(!ctx.pages().some(p => p.url().endsWith('/meus-fretes/cadastrar')) && ctx.pages().length === abasAntes, 'fechou a aba do formulario e so ela');

    // quando um passo falha, diz qual
    formBody = '<!doctype html><meta charset="utf-8"><body><label>Local da coleta</label><input></body>';
    const bad = await sw.evaluate(b => fbFillTest(b), base);
    assert.ok(!bad.ok && bad.step.includes('Local da coleta') && /nao achei a opcao/.test(bad.error), JSON.stringify(bad));
    for (const p of ctx.pages().filter(p => p.url().endsWith('/cadastrar'))) await p.close();

    formBody = FORM; // o caso de erro acima deixou o formulario quebrado
    // ---- Fechar: desativar/excluir pelo codigo em Meus Fretes
    const antesFechar = ctx.pages().length;
    assert.deepStrictEqual(await sw.evaluate(b => fbClose('MGMG-27DE', 'desativar', b), base), { ok: true, resultado: 'Desativado' });
    assert.deepStrictEqual(await sw.evaluate(b => fbClose('MGMG-3401', 'excluir', b), base), { ok: true, resultado: 'Excluido' });
    assert.deepStrictEqual(fechou, [{ acao: 'Desativar', cod: 'MGMG-27DE' }, { acao: 'Excluir', cod: 'MGMG-3401' }]);
    assert.deepStrictEqual(await sw.evaluate(b => fbClose('XXXX-0000', 'excluir', b), base), { ok: true, resultado: 'Nao encontrado' });
    assert.strictEqual(fechou.length, 2, 'codigo inexistente: nao faz nada');
    const dup = await sw.evaluate(b => fbClose('SPSP-26E9', 'excluir', b), base); // "SPSP-26E9" aparece em 2 fretes: nao arrisca
    assert.ok(dup.ok === false && /achou 2 fretes/.test(dup.error), JSON.stringify(dup));
    assert.strictEqual(fechou.length, 2);
    for (const p of ctx.pages().filter(p => p.url() === base + 'meus-fretes')) await p.close();
    assert.strictEqual(ctx.pages().length, antesFechar, 'fechou so as abas que abriu');

    // ---- Plano da sincronizacao (STATUS manda; nunca republica)
    const L = (o, d, st = '', cod = '', extra = {}) => ({ origem: o, destino: d, produto: 'SYNC TESTE', valor: 'A combinar', peso: '25 Ton', paletes: '28 PAL', veiculo: 'Carreta', carroceria: 'Sider', rastreada: 'Sim', lona: 'Não', pagamento: 'Outro', observacoes: '', status: st, codigo: cod, ...extra });
    linhasPlanilha.push(
      L('EXTREMA/MG', 'FRUTAL/MG', 'PUBLICAR'),                 // 2: publica
      L('EXTREMA', 'FRUTAL/MG', 'PUBLICAR'),                    // 3: erro de validacao
      L('JACAREI/SP', 'ATIBAIA/SP', 'Publicado', 'AB-1'),       // 4: ja publicada
      L('EXTREMA/MG', 'ITABIRITO/MG', 'FECHAR', 'MGMG-27DE'),   // 5: desativa (padrao)
      L('EXTREMA/MG', 'SERRA/ES', 'EXCLUIR', 'MGMG-3401'),      // 6: exclui
      L('EXTREMA/MG', 'VIANA/ES', 'FECHAR'),                    // 7: sem codigo
      L('JACAREI/SP', 'ATIBAIA/SP', 'PUBLICAR'),                // 8: igual a linha 4 (ja publicada)
      L('EXTREMA/MG', 'JACAREI/SP', ''),                        // 9: rascunho: nada
    );
    const cfgSync = { url: `http://127.0.0.1:${planilha.address().port}/exec`, token: 't', fechar: 'desativar', auto: true, minutos: 15, limite: 2, pausaSeg: 0, conferirZero: false };
    fechou.length = 0;
    await sw.evaluate(async c => { await chrome.storage.local.remove(['lotePublicados', 'syncEstado', 'syncLogs']); await chrome.storage.local.set({ syncCfg: c }); FB.site = c.base; FB_TENTATIVAS = 6; }, { ...cfgSync, base });
    await new Promise(r => setTimeout(r, 300));
    assert.strictEqual((await sw.evaluate(() => chrome.alarms.get('sync-auto'))).periodInMinutes, 15, 'alarme criado com o automatico ligado');
    const base404 = cfgSync.url.replace('/exec', '');
    await assert.rejects(sw.evaluate(u => syncCfg().then(c => planilhaGet({ ...c, url: u })), base404 + '/morto'), /nao achou o aplicativo da web.*404/);
    await assert.rejects(sw.evaluate(u => syncCfg().then(c => planilhaGet({ ...c, url: u })), base404 + '/login'), /pediu login.*Qualquer pessoa/);
    await assert.rejects(sw.evaluate(() => syncCfg().then(c => planilhaGet({ ...c, token: 'errada' }))), /Planilha: senha invalida/);
    const { plano } = await sw.evaluate(() => syncPlano());
    assert.strictEqual(await sw.evaluate(() => chrome.action.getBadgeText({})), '3', 'contador no icone: 3 acoes na fila');
    assert.deepStrictEqual(plano.acoes.map(a => [a.linha, a.tipo, a.modo || '']), [[2, 'publicar', ''], [5, 'fechar', 'desativar'], [6, 'fechar', 'excluir']]);
    assert.deepStrictEqual(plano.escritas.map(e => [e.linha, e.status.slice(0, 40)]),
      [[3, 'ERRO: ORIGEM deve ser CIDADE/UF'], [7, 'ERRO: falta o CODIGO para fechar'], [8, 'ERRO: igual a linha 4, que ja esta publi']]);

    // reserva: se a linha mudar na planilha depois do plano, a acao nao acontece
    linhasPlanilha[0].status = 'rascunho';
    await sw.evaluate(() => syncEstadoSet({ rodando: 1 })); // rodada "antiga": cada acao feita renova o relogio (rodada longa nao e dada como travada)
    const pulou = await sw.evaluate(a => syncAcao(a), plano.acoes[0]);
    assert.ok(pulou.pulada, JSON.stringify(pulou));
    assert.ok((await sw.evaluate(() => syncEstado())).rodando > Date.now() - 20000, 'a acao renovou o relogio da rodada');
    await sw.evaluate(() => syncEstadoSet({ rodando: 0 }));
    linhasPlanilha[0].status = 'PUBLICAR';

    // rodada automatica: no maximo 2 acoes por vez (limite), reserva e devolve STATUS/CODIGO
    await sw.evaluate(() => syncAuto());
    assert.strictEqual(await sw.evaluate(() => chrome.action.getBadgeText({})), '1', 'contador: 3 na fila, 2 feitas, falta 1');
    assert.deepStrictEqual([linhasPlanilha[0].status, linhasPlanilha[0].codigo], ['Publicado', 'SPGO-1770']);
    assert.strictEqual(linhasPlanilha[3].status, 'Desativado');
    assert.strictEqual(linhasPlanilha[4].status, 'EXCLUIR', 'ficou para a proxima rodada');
    assert.match(linhasPlanilha[1].status, /^ERRO: ORIGEM/);
    assert.match(linhasPlanilha[6].status, /^ERRO: igual a linha 4/);
    await sw.evaluate(() => syncAuto());
    assert.strictEqual(linhasPlanilha[4].status, 'Excluido');
    assert.strictEqual(await sw.evaluate(() => chrome.action.getBadgeText({})), '', 'fila vazia: o contador some');
    const hist = (await sw.evaluate(() => chrome.storage.local.get('syncHistorico'))).syncHistorico;
    assert.deepStrictEqual(hist.map(h => [h.tipo, h.status, h.codigo]).reverse().slice(0, 3), [['fechar', 'Desativado', 'MGMG-27DE'], ['publicar', 'Publicado', 'SPGO-1770'], ['fechar', 'Excluido', 'MGMG-3401']], 'historico em ordem: o que fecha vem antes do que publica na mesma rodada');
    assert.strictEqual(hist.find(h => h.tipo === 'publicar').frete, 'EXTREMA/MG → FRUTAL/MG');
    const antesJson = JSON.stringify(linhasPlanilha), n = fechou.length;
    await sw.evaluate(() => syncAuto());
    assert.strictEqual(JSON.stringify(linhasPlanilha), antesJson, 'terceira rodada: nada novo, nada repetido');
    assert.strictEqual(fechou.length, n);
    assert.deepStrictEqual(fechou.map(f => f.cod), ['MGMG-27DE', 'MGMG-3401']);

    // a mesma linha (mesmo conteudo) voltando a PUBLICAR sem codigo nunca republica: a extensao lembra
    linhasPlanilha[0].status = 'PUBLICAR'; linhasPlanilha[0].codigo = '';
    await sw.evaluate(() => syncAuto());
    assert.deepStrictEqual([linhasPlanilha[0].status, linhasPlanilha[0].codigo], ['Publicado', 'SPGO-1770'], 'reconciliou com a memoria, sem publicar');

    // REPUBLICAR: o frete antigo foi apagado na Fretebras; publica de novo, ignorando o codigo antigo e a memoria da extensao
    linhasPlanilha.push(L('EXTREMA/MG', 'FRUTAL/MG', 'REPUBLICAR', 'OLD-1', { idcarga: 'rep1' }));
    await sw.evaluate(async () => { const { lotePublicados: f = {} } = await chrome.storage.local.get('lotePublicados'); f['id:rep1'] = { code: 'OLD-1', quando: 1 }; await chrome.storage.local.set({ lotePublicados: f }); });
    await sw.evaluate(() => syncAuto());
    const rep = linhasPlanilha[linhasPlanilha.length - 1];
    assert.deepStrictEqual([rep.status, rep.codigo], ['Publicado', 'SPGO-1770'], 'republicou e gravou o codigo novo (nao o OLD-1)');
    linhasPlanilha.pop();

    // RENOVAR: fecha o frete antigo (pelo codigo) e publica de novo; se nao conseguir fechar o antigo, NAO publica
    linhasPlanilha.push(L('EXTREMA/MG', 'FRUTAL/MG', 'RENOVAR', 'MGMG-27DE', { idcarga: 'ren1' }));
    const nFechou = fechou.length;
    await sw.evaluate(() => syncAuto());
    let ren = linhasPlanilha[linhasPlanilha.length - 1];
    assert.deepStrictEqual([ren.status, ren.codigo], ['Publicado', 'SPGO-1770'], 'fechou o antigo e publicou de novo');
    assert.deepStrictEqual(fechou.slice(nFechou), [{ acao: 'Desativar', cod: 'MGMG-27DE' }], 'desativou o antigo antes de publicar');
    const hRen = (await sw.evaluate(() => chrome.storage.local.get('syncHistorico'))).syncHistorico; // mais novo primeiro
    assert.deepStrictEqual([hRen[1].tipo, hRen[1].status, hRen[0].tipo, hRen[0].status], ['renovar', 'Antigo fechado', 'publicar', 'Publicado'], 'renovar: primeiro fecha o antigo, depois publica');
    linhasPlanilha.pop();
    linhasPlanilha.push(L('EXTREMA/MG', 'FRUTAL/MG', 'RENOVAR', 'SPSP-26E9', { idcarga: 'ren2' })); // esse codigo aparece em 2 fretes: nao fecha
    await sw.evaluate(() => syncAuto());
    ren = linhasPlanilha[linhasPlanilha.length - 1];
    assert.match(ren.status, /^ERRO ao fechar o antigo/); assert.strictEqual(ren.codigo, 'SPSP-26E9', 'o codigo antigo continua na linha');
    linhasPlanilha.pop();
    const sem = await sw.evaluate(() => planoDeSync([{ linha: 2, status: 'RENOVAR', codigo: '', origem: 'A/MG', destino: 'B/MG' }], {}, {}));
    assert.strictEqual(sem.escritas[0].status, 'REPUBLICAR', 'RENOVAR sem codigo antigo vira REPUBLICAR');

    // DUAS ETAPAS: fecha TUDO (um de cada vez) antes de publicar; so publica (varias abas) quando nao resta nenhum frete ativo
    await sw.evaluate(async () => { FB_ESPERA_ZERO = 300; const c = (await chrome.storage.local.get('syncCfg')).syncCfg; await chrome.storage.local.set({ syncCfg: { ...c, abas: 3, limite: 10, conferirZero: true } }); });
    const ini = linhasPlanilha.length;
    linhasPlanilha.push(
      L('EXTREMA/MG', 'FRUTAL/MG', 'RENOVAR', 'MGMG-27DE', { idcarga: 'd1' }), L('EXTREMA/MG', 'FRUTAL/MG', 'RENOVAR', 'MGMG-3401', { idcarga: 'd2' }),
      L('EXTREMA/MG', 'FRUTAL/MG', 'PUBLICAR', '', { idcarga: 'd3' }), L('EXTREMA/MG', 'FRUTAL/MG', 'PUBLICAR', '', { idcarga: 'd4' }));
    const sts = () => linhasPlanilha.slice(ini).map(r => r.status);
    ativosFake = 4; eventos.length = 0; maxAbertas = 0; // a conta tem 4 ativos: os 2 que serao fechados e 2 que a planilha nao conhece
    await sw.evaluate(() => syncAuto());
    assert.deepStrictEqual(eventos, ['fechar', 'fechar'], 'etapa 1 fechou os 2 antigos e nao publicou nada');
    assert.strictEqual(ativosFake, 2);
    assert.deepStrictEqual(sts(), ['REPUBLICAR', 'REPUBLICAR', 'PUBLICAR', 'PUBLICAR'], 'ainda ha ativos: nada foi publicado, nem as cargas novas');
    assert.ok((await sw.evaluate(() => chrome.storage.local.get('syncLogs'))).syncLogs.some(l => /Ainda ha 2 frete/.test(l.txt)));
    ativosFake = 0; eventos.length = 0; maxAbertas = 0; // agora a conta zerou
    await sw.evaluate(() => syncAuto());
    assert.deepStrictEqual(sts(), ['Publicado', 'Publicado', 'Publicado', 'Publicado']);
    assert.deepStrictEqual(eventos, ['publicar', 'publicar', 'publicar', 'publicar'], 'so publicou, nada foi fechado de novo');
    assert.ok(maxAbertas >= 2, 'as abas trabalharam ao mesmo tempo (maximo ' + maxAbertas + ')');
    assert.strictEqual(await sw.evaluate(() => chrome.action.getBadgeText({})), '', 'fila zerada');
    // ordem completa numa rodada so: fecha antes de publicar
    linhasPlanilha.push(L('EXTREMA/MG', 'FRUTAL/MG', 'RENOVAR', 'MGMG-27DE', { idcarga: 'd5' }), L('EXTREMA/MG', 'FRUTAL/MG', 'PUBLICAR', '', { idcarga: 'd6' }));
    ativosFake = 1; eventos.length = 0;
    await sw.evaluate(() => syncAuto());
    assert.deepStrictEqual(eventos, ['fechar', 'publicar', 'publicar'], 'fechar vem antes de qualquer publicacao');
    await sw.evaluate(async () => { const c = (await chrome.storage.local.get('syncCfg')).syncCfg; await chrome.storage.local.set({ syncCfg: { ...c, abas: 1, limite: 2, conferirZero: false } }); FB_ESPERA_ZERO = 3000; });
    linhasPlanilha.length = ini;

    // login/site fora do ar: pausa o automatico e devolve a linha como estava
    linhasPlanilha.push(L('EXTREMA/MG', 'FRUTAL/MG', 'PUBLICAR', '', { idcarga: 'x9' })); // mesma rota da linha 2, outra carga
    semFormulario = true;
    await sw.evaluate(() => syncAuto());
    assert.strictEqual(linhasPlanilha[8].status, 'PUBLICAR', 'liberada para tentar de novo');
    assert.strictEqual((await sw.evaluate(() => syncEstado())).pausado, true);
    assert.deepStrictEqual(await sw.evaluate(() => syncAuto()), { motivo: 'pausado' });
    semFormulario = false;
    await sw.evaluate(() => syncRetomar());
    assert.strictEqual((await sw.evaluate(() => syncEstado())).pausado, false);
    await sw.evaluate(() => syncAuto());
    assert.strictEqual(linhasPlanilha[8].status, 'Publicado');
    assert.ok((await sw.evaluate(() => chrome.storage.local.get('syncLogs'))).syncLogs.some(l => /pausada/.test(l.txt)));
    // desligar o automatico remove o alarme
    await sw.evaluate(async () => { await chrome.storage.local.set({ syncCfg: { ...(await chrome.storage.local.get('syncCfg')).syncCfg, auto: false } }); });
    await new Promise(r => setTimeout(r, 300));
    assert.strictEqual(await sw.evaluate(() => chrome.alarms.get('sync-auto')), undefined);

    // pagina de sincronizacao: previa pela planilha (nao executa nada)
    linhasPlanilha.push(L('EXTREMA/MG', 'SERRA/ES', 'PUBLICAR', '', { produto: 'OUTRO TESTE' }));
    const pg = await ctx.newPage();
    await pg.goto(`chrome-extension://${sw.url().split('/')[2]}/sync/sync.html`);
    await pg.waitForFunction(() => document.querySelector('#url').value.includes('127.0.0.1'));
    await pg.click('#previa');
    await pg.waitForFunction(() => !/^(|Lendo a planilha…)$/.test(document.querySelector('#msg').textContent), null, { timeout: 15000 }).catch(async () => { throw new Error('msg=' + await pg.textContent('#msg') + ' | teste=' + await pg.textContent('#teste')); });
    assert.match(await pg.textContent('#msg'), /ação\(ões\)/, await pg.textContent('#msg'));
    assert.match(await pg.textContent('#tab'), /EXTREMA\/MG → SERRA\/ES/);
    assert.strictEqual(await pg.isDisabled('#executar'), false);
    assert.ok((await pg.$$('#hist tr')).length >= 3 && /Hoje: \d+ publicado/.test(await pg.textContent('#resumo-hist')), 'historico aparece na pagina');
    await pg.close();
    await sw.evaluate(() => { FB.site = 'https://novacentral.fretebras.com.br/'; FB_TENTATIVAS = 80; });

    // janela minimizada: publica e fecha a janela; se falhar, a janela volta a aparecer
    await sw.evaluate(async () => { const c = (await chrome.storage.local.get('syncCfg')).syncCfg; await chrome.storage.local.set({ syncCfg: { ...c, janela: 'minimizada' } }); });
    const janelasAntes = await sw.evaluate(async () => (await chrome.windows.getAll()).length);
    const pubMin = await sw.evaluate(({ b, l }) => fbFillTest(b, true, l), { b: base, l: { origem: 'EXTREMA/MG', destino: 'FRUTAL/MG', produto: 'JANELA', valor: 'A combinar', peso: '25 Ton', paletes: '', veiculo: 'Carreta', carroceria: 'Sider', rastreada: 'Sim', lona: 'Não', pagamento: 'Outro', observacoes: '', idcarga: 'min1' } });
    assert.ok(pubMin.ok && pubMin.code === 'SPGO-1770', JSON.stringify(pubMin));
    await new Promise(r => setTimeout(r, 500));
    assert.strictEqual(await sw.evaluate(async () => (await chrome.windows.getAll()).length), janelasAntes, 'a janela minimizada foi fechada junto com a aba');
    const so = await sw.evaluate(({ b, l }) => fbFillTest(b, false, l), { b: base, l: { origem: 'EXTREMA/MG', destino: 'FRUTAL/MG', produto: 'JANELA', valor: 'A combinar', peso: '25 Ton', paletes: '', veiculo: 'Carreta', carroceria: 'Sider', rastreada: 'Sim', lona: 'Não', pagamento: 'Outro', observacoes: '', idcarga: 'min2' } });
    assert.ok(so.ok);
    const estados = await sw.evaluate(async () => (await chrome.windows.getAll()).map(w => w.state));
    assert.ok(!estados.includes('minimized'), 'so preencher: a janela volta a aparecer para voce conferir: ' + estados);
    for (const p of ctx.pages().filter(p => p.url().endsWith('/cadastrar'))) await p.close();
    await sw.evaluate(async () => { const c = (await chrome.storage.local.get('syncCfg')).syncCfg; await chrome.storage.local.set({ syncCfg: { ...c, janela: 'aba' } }); });

    // outro site nao consegue mandar sessao falsa nem publicar
    const antes = (await sw.evaluate(async () => (await chrome.storage.session.get('fb')).fb)).refresh;
    await app.evaluate(() => window.postMessage({ mspa: 'session', token: { access_token: 'X', refresh_token: 'X', expires_in: 1, refresh_expires_in: 1 } }, '*'));
    await app.waitForTimeout(300);
    assert.strictEqual((await sw.evaluate(async () => (await chrome.storage.session.get('fb')).fb)).refresh, antes);

    // Pagina do lote: pula o ja publicado e o repetido, nao duplica e devolve STATUS/CODIGO
    const extId = sw.url().split('/')[2];
    const cab = 'ORIGEM\tDESTINO\tPRODUTO\tVALOR\tPESO\tPALETES\tVEÍCULO\tCARROCERIA\tRASTREADA\tLONA\tPAGAMENTO\tOBSERVAÇÕES\tSTATUS\tCÓDIGO';
    const lin = (o, d, st = '', cod = '') => [o, d, 'TESTE', 'A combinar', '25 Ton', '28 PAL', 'Carreta', 'Sider', 'Sim', 'Não', 'Outro', '', st, cod].join('\t');
    const lista = [cab, lin('EXTREMA/MG', 'FRUTAL/MG'), lin('EXTREMA/MG', 'ITABIRITO/MG'), lin('JACAREI/SP', 'ATIBAIA/SP', 'Publicado', 'ABCD-0001'), lin('EXTREMA/MG', 'FRUTAL/MG')].join('\n');
    const lote = await ctx.newPage();
    lote.on('dialog', d => d.accept());
    await lote.goto(`chrome-extension://${extId}/lote/lote.html`);
    await lote.fill('#txt', lista);
    await lote.waitForFunction(() => document.querySelectorAll('#tab tr').length === 4);
    assert.match(await lote.textContent('#resumo'), /4 linhas: 2 para publicar, 2 puladas/);
    const sit = await lote.$$eval('#tab tr', trs => trs.map(t => t.lastElementChild.textContent));
    assert.match(sit[2], /ja publicada na planilha \(ABCD-0001\)/);
    assert.match(sit[3], /repetida \(igual a linha 1\)/);
    await lote.evaluate(() => { // simula o background: devolve um codigo por linha
      let n = 0; window.enviadas = [];
      chrome.runtime.sendMessage = async m => { window.enviadas.push(m.row.destino); return { ok: true, code: 'TEST-000' + ++n }; };
      window.copiado = ''; navigator.clipboard.writeText = async t => { window.copiado = t; };
    });
    await lote.fill('#seg', '5');
    await lote.click('#publicar');
    await lote.waitForFunction(() => document.querySelector('#msg').textContent === 'Terminou.', null, { timeout: 30000 });
    assert.deepStrictEqual(await lote.evaluate(() => window.enviadas), ['FRUTAL/MG', 'ITABIRITO/MG'], 'so as 2 linhas novas');
    await lote.click('#copiar');
    assert.strictEqual(await lote.evaluate(() => window.copiado), 'Publicado\tTEST-0001\nPublicado\tTEST-0002\nPublicado\tABCD-0001\nPublicado\tTEST-0001', 'repetida herda o codigo da igual');
    // colar a mesma lista de novo (sem STATUS/CODIGO) nao publica nada
    await lote.fill('#txt', [cab, lin('EXTREMA/MG', 'FRUTAL/MG'), lin('EXTREMA/MG', 'ITABIRITO/MG')].join('\n'));
    await lote.waitForFunction(() => /0 para publicar, 2 puladas/.test(document.querySelector('#resumo').textContent));
    assert.match((await lote.$$eval('#tab tr', t => t.map(r => r.lastElementChild.textContent)))[0], /ja publicada por esta extensao \(TEST-0001\)/);
    assert.strictEqual(await lote.isDisabled('#publicar'), true);
    // linha incerta (clicou e nao confirmou) nunca e repetida
    await lote.fill('#txt', [cab, lin('EXTREMA/MG', 'SERRA/ES')].join('\n'));
    await lote.evaluate(() => { chrome.runtime.sendMessage = async () => ({ ok: false, incerta: true, error: 'perdi a conversa' }); });
    await lote.fill('#seg', '5');
    await lote.click('#publicar');
    await lote.waitForFunction(() => /INCERTA/.test(document.querySelector('#tab').textContent));
    await lote.fill('#txt', [cab, lin('EXTREMA/MG', 'SERRA/ES')].join('\n'));
    await lote.waitForFunction(() => /pode ja estar publicada/.test(document.querySelector('#tab').textContent));
    assert.strictEqual(await lote.isDisabled('#publicar'), true);
    // linha com erro bloqueia o botao
    await lote.fill('#txt', [cab, lin('EXTREMA', 'SERRA/ES')].join('\n'));
    await lote.waitForFunction(() => /ORIGEM deve ser CIDADE\/UF/.test(document.querySelector('#tab').textContent));
    assert.strictEqual(await lote.isDisabled('#publicar'), true);
    await lote.close();

    console.log('OK: scan, React Fiber, rede (mascara), export, painel, gravador, export grande, sessao e publicacao Fretebras, lote sem duplicar, fechar, sincronizacao manual e automatica');
  } finally {
    await ctx.close(); server.close(); planilha.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
