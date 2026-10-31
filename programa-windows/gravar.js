// Modo GRAVAR: o programa grava tudo que voce faz no site (cliques, campos, telas, chamadas, mensagens)
// e, ao apertar ENTER, gera o relatorio para me mandar. Usa o mesmo gravador da extensao.
const fs = require('fs'), path = require('path');

const achar = nome => [`logica/${nome}`, `../scripts/${nome}`].map(p => path.join(__dirname, p)).find(fs.existsSync);
const ler = nome => fs.readFileSync(achar(nome), 'utf8');
const esconde = s => String(s).replace(/eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/g, '***').replace(/Bearer\s+[\w.~+/=-]{12,}/g, 'Bearer ***');

async function iniciarGravacao(ctx) {
  const passos = [];
  await ctx.exposeBinding('mspaPasso', (_src, p) => { passos.push(p); });
  // 1) liga a gravacao da aba antes da pagina carregar; 2) o gravador e o mapeador entram quando o corpo da pagina existe
  await ctx.addInitScript(`try { if (!sessionStorage.getItem('mspa-rec')) sessionStorage.setItem('mspa-rec', String(Date.now())); } catch {}`);
  await ctx.addInitScript(ler('inject_network.js'));
  const depois = src => `(() => { const run = () => { ${src}\n }; document.readyState === 'loading' ? addEventListener('DOMContentLoaded', run) : run(); })();`;
  await ctx.addInitScript(depois(ler('inject_scanner.js')));
  await ctx.addInitScript(depois(ler('inject_recorder.js')));
  await ctx.addInitScript(`addEventListener('message', ev => { const d = ev.data; if (ev.source === window && d && d.mspa === 'rec-step' && window.mspaPasso) window.mspaPasso(d.step); });`);

  return async function parar() {
    const telas = [];
    for (const p of ctx.pages()) {
      telas.push(await p.evaluate(() => ({
        url: location.href, titulo: document.title,
        texto: document.body.innerText.replace(/\s+/g, ' ').slice(0, 4000),
        campos: [...document.querySelectorAll('input,textarea,select')].filter(e => e.type !== 'hidden').slice(0, 60)
          .map(e => ({ tipo: e.type || e.localName, nome: (e.labels && e.labels[0] && e.labels[0].innerText) || e.getAttribute('aria-label') || e.placeholder || e.name || e.id || '' })),
        botoes: [...document.querySelectorAll('button,[role=button],a')].map(e => (e.innerText || e.getAttribute('aria-label') || '').trim()).filter(Boolean).slice(0, 80),
      })).catch(() => null));
    }
    const ord = [...passos].sort((a, b) => a.t - b.t || (a.type === 'request') - (b.type === 'request'));
    const digitando = (s, i) => { // digitar manda um passo por tecla: fica so o ultimo valor do campo
      if (s.type !== 'field') return false;
      for (const n of ord.slice(i + 1)) {
        if (n.type === 'field') return n.name === s.name && n.route === s.route;
        if (n.type !== 'appeared' && n.type !== 'storage') return false;
      }
      return false;
    };
    const t0 = ord.length ? ord[0].t : Date.now();
    const linha = ord.filter((s, i) => !digitando(s, i)).map(({ recId, ...s }) => ({ ...s, sec: +((s.t - t0) / 1000).toFixed(1) }));
    return { gravadoEm: new Date().toISOString(), passos: linha.length, telas: telas.filter(Boolean), linhaDoTempo: linha };
  };
}

// Texto curto e legivel (o que eu leio primeiro); o JSON completo vai junto.
function resumo(rel) {
  const L = [`RELATORIO DA GRAVACAO - ${rel.gravadoEm}`, `${rel.passos} passos`, ''];
  for (const s of rel.linhaDoTempo) {
    const alvo = s.target && (s.target.text || s.target.selector) || '';
    const base = `${String(s.sec).padStart(6)}s `;
    if (s.type === 'click') L.push(`${base}CLIQUE em "${String(alvo).slice(0, 60)}"`);
    else if (s.type === 'field') L.push(`${base}CAMPO "${s.name}" = ${JSON.stringify(s.value)}`);
    else if (s.type === 'screen') L.push(`${base}TELA ${s.route} ${s.title || ''}`);
    else if (s.type === 'appeared') L.push(`${base}APARECEU: ${(s.texts || []).join(' | ').slice(0, 200)}`);
    else if (s.type === 'request') L.push(`${base}REDE ${s.method || ''} ${s.url} -> ${s.status || ''}`);
    else L.push(`${base}${s.type.toUpperCase()} ${alvo}`);
  }
  L.push('', 'TELAS ABERTAS NO FIM:');
  for (const t of rel.telas) L.push(`- ${t.url}\n  botoes: ${t.botoes.slice(0, 30).join(' | ')}\n  campos: ${t.campos.map(c => c.nome || c.tipo).join(' | ')}`);
  return L.join('\n');
}

function salvar(rel, pasta) {
  const nome = 'relatorio-' + new Date().toISOString().replace(/[:.]/g, '-');
  const json = esconde(JSON.stringify(rel, (k, v) => (typeof v === 'string' && v.length > 4000 ? v.slice(0, 4000) + '…' : v), 2));
  fs.writeFileSync(path.join(pasta, nome + '.json'), json);
  fs.writeFileSync(path.join(pasta, nome + '.txt'), esconde(resumo(rel)));
  return path.join(pasta, nome);
}

module.exports = { iniciarGravacao, salvar };

if (require.main === module) {
  const { chromium } = require('playwright');
  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  (async () => {
    const ctx = await chromium.launchPersistentContext(path.join(__dirname, 'perfil'), { headless: false, channel: 'chromium', viewport: null, args: ['--start-maximized'] });
    const parar = await iniciarGravacao(ctx);
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto('https://novacentral.fretebras.com.br/meus-fretes').catch(() => {});
    console.log('\nGRAVANDO. Faca no navegador o que combinamos (entrar, filtrar seus fretes, apagar 1 ou 2 de teste).');
    console.log('Senhas nao sao gravadas. Quando terminar, volte aqui e aperte ENTER.\n');
    rl.once('line', async () => {
      const arq = salvar(await parar(), __dirname);
      console.log('\nRelatorio salvo:\n  ' + arq + '.txt\n  ' + arq + '.json\nMande esses dois arquivos para mim.');
      await ctx.close(); process.exit(0);
    });
  })().catch(e => { console.error('Erro:', e.message); process.exit(1); });
}
