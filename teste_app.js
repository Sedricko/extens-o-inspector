// Teste do programa Windows (sem extensao): formulario e Meus Fretes falsos + planilha falsa.
// Rodar: node teste_app.js
const assert = require('assert'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { chromium } = require('playwright');
const { criar } = require('./programa-windows/nucleo');

const src = fs.readFileSync(path.join(__dirname, 'teste_extensao.js'), 'utf8');
const pega = nome => eval(src.match(new RegExp('const ' + nome + ' = (`[\\s\\S]*?`);'))[1]);
const FORM = pega('FORM'), MEUS = pega('MEUS');

(async () => {
  const fechou = [], publicou = [];
  const linhas = [
    { origem: 'EXTREMA/MG', destino: 'FRUTAL/MG', produto: 'SYNC TESTE', valor: 'A combinar', peso: '25 Ton', paletes: '28 PAL', veiculo: 'Carreta', carroceria: 'Sider', rastreada: 'Sim', lona: 'Não', pagamento: 'Outro', observacoes: '', status: 'PUBLICAR', codigo: '' },
    { origem: 'EXTREMA/MG', destino: 'ITABIRITO/MG', status: 'FECHAR', codigo: 'MGMG-27DE' },
  ];
  const planilha = http.createServer((req, res) => {
    const h = { 'content-type': 'application/json' };
    let corpo = ''; req.on('data', d => { corpo += d; });
    req.on('end', () => {
      if (req.method === 'GET') return res.writeHead(200, h).end(JSON.stringify({ ok: true, linhas: linhas.map((l, i) => ({ linha: i + 2, ...l })) }));
      const gravadas = [];
      for (const u of JSON.parse(corpo).atualizacoes) {
        const l = linhas[u.linha - 2];
        if (u.esperado && !u.esperado.map(s => s.toLowerCase()).includes(String(l.status).toLowerCase())) continue;
        l.status = u.status; if (u.codigo !== undefined) l.codigo = u.codigo; gravadas.push(u.linha);
      }
      res.writeHead(200, h).end(JSON.stringify({ ok: true, gravadas, ignoradas: [] }));
    });
  }).listen(0);
  const site = http.createServer((req, res) => {
    if (req.url === '/meus-fretes/cadastrar') return res.setHeader('content-type', 'text/html'), res.end(FORM);
    if (req.url === '/meus-fretes') return res.setHeader('content-type', 'text/html'), res.end(MEUS);
    if (req.url === '/api/pub') publicou.push(1);
    if (req.url === '/api/fechou') { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => { fechou.push(JSON.parse(b)); res.end('{}'); }); return; }
    res.end('{}');
  }).listen(0);
  const base = `http://127.0.0.1:${site.address().port}/`;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-'));
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, channel: 'chromium' });
  const saida = [];
  try {
    const app = criar({ ctx, arquivoDados: path.join(dir, 'dados.json'), escrever: t => saida.push(t) });
    await app.chrome.storage.local.set({ syncCfg: { url: `http://127.0.0.1:${planilha.address().port}/exec`, token: 't', auto: true, limite: 5, pausaSeg: 0, conferirZero: false } });
    app.rodar(`FB.site = ${JSON.stringify(base)}; FB_TENTATIVAS = 10;`);
    await app.rodar('syncAuto()');
    assert.strictEqual(linhas[0].status, 'Publicado', JSON.stringify(linhas[0]) + saida.join('\n'));
    assert.ok(/^[A-Z]{2,4}-[A-Z0-9]{3,5}$/.test(linhas[0].codigo), 'codigo lido do site: ' + linhas[0].codigo);
    assert.strictEqual(linhas[1].status, 'Desativado');
    assert.deepStrictEqual(fechou, [{ acao: 'Desativar', cod: 'MGMG-27DE' }]);
    assert.strictEqual(publicou.length, 1);
    await new Promise(r => setTimeout(r, 800));
    assert.strictEqual(ctx.pages().length, 1, 'abas do bot fechadas: ' + ctx.pages().map(p => p.url()));
    await app.rodar('syncAuto()');
    assert.strictEqual(publicou.length, 1, 'segunda rodada nao repete');
    assert.ok(saida.some(l => /Publicado/.test(l)), 'historico aparece na tela');
    assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'dados.json'))).syncHistorico.length >= 2, 'dados em arquivo');
    console.log('OK teste_app');
  } finally { await ctx.close(); site.close(); planilha.close(); }
})().catch(e => { console.error(e); process.exit(1); });
