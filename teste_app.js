// Teste do programa Windows (sem extensao) com uma Central falsa: filtro "Publicado por", paginas de 15,
// fretes de colegas que NUNCA podem ser tocados, apagar tudo, contagem exata e fechar por codigo.
// Rodar: node teste_app.js
const assert = require('assert'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { chromium } = require('playwright');
const { criar } = require('./programa-windows/nucleo');

const src = fs.readFileSync(path.join(__dirname, 'teste_extensao.js'), 'utf8');
const FORM = eval(src.match(/const FORM = (`[\s\S]*?`);/)[1]);

const EU = { id: 118708, id_hashed: 'BwZE7' }, NOME = 'JOHON LENON CHAGAS DURAES';
const MEUS = `<!doctype html><meta charset="utf-8"><title>Meus fretes</title><body>
<div id="at">Ativos</div><div id="vazio"></div>
<div id="pp">Publicado por</div><div id="pan" hidden></div>
<input id="q" placeholder="Buscar frete"><label><input type="checkbox" id="all"></label>
<div id="lista"></div><div id="barra" hidden><button>Desativar</button><button>Excluir</button></div><div id="modal"></div><div id="toast"></div>
<script>
  let eu, pubs = [], filtro = null, itens = [];
  const j = async (u, o) => (await (await fetch(u, o)).json());
  const carrega = async () => {
    const r = await j('/freight-management-bff/v1/freights?disabled=false&scheduled=0' + (filtro ? '&publishers%5B%5D=' + filtro : '') + '&page=1&perPage=15&query=');
    itens = r.data;
    at.textContent = r.meta.total.enabled ? 'Ativos: ' + r.meta.total.enabled : 'Ativos';
    vazio.textContent = r.meta.total.enabled ? '' : 'Não há fretes ativos';
    desenha(q.value);
  };
  const desenha = f => { lista.innerHTML = itens.filter(i => i.freightCode.toLowerCase().includes(f.toLowerCase())).map(i => '<div><label><input type="checkbox" class="f" data-id="' + i.id + '"> ' + i.freightCode + '</label></div>').join(''); barra.hidden = true; all.checked = false; };
  (async () => { eu = (await j('/web/v1/user/me')).data; pubs = (await j('/freight-management-bff/v1/freights/publishers?freightEnabled=1&scheduled=0')).data; await carrega(); })();
  pp.onclick = () => { pan.hidden = false; pan.innerHTML = pubs.map(p => '<div><label><input type="checkbox" data-p="' + p.id + '"> ' + p.fullName + '</label></div>').join('') + '<button id="ok">Confirmar</button>'; ok.onclick = () => { const m = pan.querySelector('input:checked'); filtro = m && m.dataset.p; pan.hidden = true; pan.innerHTML = ''; carrega(); }; };
  q.addEventListener('input', () => setTimeout(() => desenha(q.value), 300));
  all.onchange = () => { for (const c of lista.querySelectorAll('.f')) c.checked = all.checked; barra.hidden = !all.checked; };
  lista.addEventListener('change', () => { barra.hidden = !lista.querySelector('.f:checked'); });
  for (const b of barra.querySelectorAll('button')) b.onclick = () => {
    const acao = b.textContent;
    modal.innerHTML = '<div><h3>' + acao + ' frete</h3><p>Tem certeza?</p><button>Cancelar</button><button id="c">' + acao + '</button></div>';
    c.onclick = async () => {
      const ids = [...lista.querySelectorAll('.f:checked')].map(x => x.dataset.id), cod = lista.querySelector('.f:checked').parentElement.textContent.trim();
      modal.innerHTML = '';
      await j('/freight-management-bff/v1/freights' + (acao === 'Excluir' ? '' : '/status'), { method: acao === 'Excluir' ? 'DELETE' : 'PATCH', body: JSON.stringify({ freightIds: ids, status: 'disable' }) });
      toast.textContent = ids.length > 1 ? 'Os fretes foram excluídos com sucesso.' : acao === 'Excluir' ? 'O frete foi excluído com sucesso.' : 'O frete ' + cod + ' foi desativado.';
      await carrega();
    };
  };
</script></body>`;

(async () => {
  const pub = [], fechou = [], eventos = [];
  const fretes = [];
  const novo = (i, quem) => fretes.push({ id: 'F' + i, freightCode: 'AA-' + String(1000 + i), freightStatus: 'enabled', publisher: quem === 'eu' ? { id: EU.id_hashed, fullName: NOME } : { id: 'oXd0Z', fullName: 'DIEGO RAFAEL' } });
  const reset = (meus, outros) => { fretes.length = 0; for (let i = 0; i < meus; i++) novo(i, 'eu'); for (let i = 0; i < outros; i++) novo(100 + i, 'outro'); eventos.length = 0; pub.length = 0; fechou.length = 0; };
  const linhas = [];
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
    const u = new URL(req.url, 'http://x'), j = o => (res.setHeader('content-type', 'application/json'), res.end(JSON.stringify(o)));
    let corpo = ''; req.on('data', d => { corpo += d; });
    req.on('end', () => {
      if (u.pathname === '/meus-fretes/cadastrar') return res.setHeader('content-type', 'text/html'), res.end(FORM);
      if (u.pathname === '/meus-fretes') return res.setHeader('content-type', 'text/html'), res.end(MEUS);
      if (u.pathname === '/web/v1/user/me') return j({ data: EU });
      if (u.pathname === '/freight-management-bff/v1/freights/publishers') return j({ data: [{ id: 340444, fullName: 'ANA' }, { id: EU.id, fullName: NOME }] });
      if (u.pathname === '/freight-management-bff/v1/freights' && req.method === 'GET') {
        const f = u.searchParams.get('publishers[]'), todos = fretes.filter(x => !f || (+f === EU.id && x.publisher.id === EU.id_hashed));
        return j({ data: todos.slice(0, 15), meta: { total: { enabled: todos.length } } });
      }
      if (u.pathname === '/freight-management-bff/v1/freights' && req.method === 'DELETE') {
        const ids = JSON.parse(corpo).freightIds; eventos.push('apagar'); fechou.push(...ids.map(id => ({ acao: 'Excluir', id })));
        for (const id of ids) fretes.splice(fretes.findIndex(x => x.id === id), 1);
        return j({ data: { errors: [], success: ids } });
      }
      if (u.pathname === '/freight-management-bff/v1/freights/status') {
        const ids = JSON.parse(corpo).freightIds; eventos.push('fechar'); fechou.push(...ids.map(id => ({ acao: 'Desativar', id })));
        for (const id of ids) fretes.splice(fretes.findIndex(x => x.id === id), 1);
        return j({ data: { errors: [], success: ids } });
      }
      if (u.pathname === '/api/pub') { pub.push(1); eventos.push('publicar'); }
      res.end('{}');
    });
  }).listen(0);
  const base = `http://127.0.0.1:${site.address().port}/`;
  const L = (st, extra = {}) => ({ origem: 'EXTREMA/MG', destino: 'FRUTAL/MG', produto: 'SYNC TESTE', valor: 'A combinar', peso: '25 Ton', paletes: '28 PAL', veiculo: 'Carreta', carroceria: 'Sider', rastreada: 'Sim', lona: 'Não', pagamento: 'Outro', observacoes: '', status: st, codigo: '', ...extra });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-'));
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, channel: 'chromium' });
  try {
    const saida = [];
    const app = criar({ ctx, arquivoDados: path.join(dir, 'dados.json'), escrever: t => saida.push(t) });
    const cfg = o => app.chrome.storage.local.set({ syncCfg: { url: `http://127.0.0.1:${planilha.address().port}/exec`, token: 't', auto: true, limite: 5, pausaSeg: 0, conferirZero: true, apagarTudo: true, ...o } });
    app.rodar(`FB.site = ${JSON.stringify(base)}; FB_TENTATIVAS = 10;`);
    const limpa = () => app.chrome.storage.local.remove(['lotePublicados', 'syncEstado', 'syncLogs']);

    // 1) contagem exata: so os meus (35), nunca os dos colegas (8)
    reset(35, 8); await cfg({});
    assert.deepStrictEqual(await app.rodar('fbContarAtivos()'), { ativos: 35 });

    // 2) apagar tudo antes de republicar: 35 meus (3 paginas) saem, os 8 dos colegas ficam, e so depois publica
    linhas.length = 0; linhas.push(L('REPUBLICAR', { idcarga: 'a1', codigo: 'OLD-1' }), L('REPUBLICAR', { idcarga: 'a2', codigo: 'OLD-2' }));
    await limpa(); await app.rodar('syncAuto()');
    assert.strictEqual(fretes.filter(x => x.publisher.id === EU.id_hashed).length, 0, 'nenhum frete meu sobrou');
    assert.strictEqual(fretes.filter(x => x.publisher.id !== EU.id_hashed).length, 8, 'os 8 dos colegas intactos: ' + saida.join(' | '));
    assert.deepStrictEqual(fechou.map(f => f.acao), Array(35).fill('Excluir'));
    assert.deepStrictEqual(linhas.map(l => l.status), ['Publicado', 'Publicado']);
    assert.strictEqual(eventos.indexOf('publicar') > eventos.lastIndexOf('apagar'), true, 'publicou so depois de apagar tudo');
    assert.ok(saida.some(l => /Apaguei 35 frete/.test(l)), saida.join('\n'));

    // 3) trava: tem frete "Publicado" na planilha que nao esta para republicar -> NAO apaga nada
    reset(5, 3); linhas.length = 0; linhas.push(L('REPUBLICAR', { idcarga: 'b1' }), L('Publicado', { idcarga: 'b2', codigo: 'AA-1000', destino: 'ITABIRITO/MG' }));
    await limpa(); await app.rodar('syncAuto()');
    assert.strictEqual(fechou.length, 0, 'nada apagado');
    assert.ok(saida.some(l => /Nao apaguei tudo: ha 1 frete/.test(l)));
    assert.strictEqual(pub.length, 0, 'e nao publicou (ainda ha fretes ativos)');

    // 4) fechar por codigo SEMPRE filtrado: o meu sai, o do colega ("Nao encontrado") nao e tocado
    reset(3, 3); linhas.length = 0; linhas.push(L('FECHAR', { codigo: 'AA-1001' }), L('EXCLUIR', { codigo: 'AA-1100', destino: 'SERRA/ES' }));
    await limpa(); await cfg({ apagarTudo: false, conferirZero: false }); await app.rodar('syncAuto()');
    assert.deepStrictEqual(fechou.map(f => f.id), ['F1'], 'so o meu foi desativado');
    assert.ok(fretes.some(x => x.id === 'F100'), 'o do colega continua la');
    assert.deepStrictEqual(linhas.map(l => l.status), ['Desativado', 'Nao encontrado']);

    console.log('OK teste_app');
  } finally { await ctx.close(); site.close(); planilha.close(); }
})().catch(e => { console.error(e); process.exit(1); });
