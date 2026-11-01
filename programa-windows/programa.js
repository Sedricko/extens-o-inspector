// Bot de Fretes: UM programa com painel (janela propria) + navegador do bot minimizado em segundo plano.
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const { criar } = require('./nucleo');
const meus = require('./meus');
const { entrar } = meus;
const { criarPainel } = require('./painel');
const gravar = require('./gravar');
const { avisar } = require('./avisos');

const SITE = 'https://novacentral.fretebras.com.br/';
const VERSAO = require('./package.json').version;
const pasta = process.env.BOT_PASTA || __dirname; // o teste usa outra pasta
const arqCfg = path.join(pasta, 'config.json'), arqLog = path.join(pasta, 'bot.log');
const PADRAO = { fechar: 'excluir', minutos: 15, limite: 50, pausaSeg: 10, abas: 1, conferirZero: true, apagarTudo: true, usuario: '', senhaFretebras: '', url: '', token: '' };
const urlOk = u => /^https:\/\/script\.google(usercontent)?\.com\/.*\/exec(\?.*)?$/.test(u || '');

const estado = { fase: 'iniciando', motivo: '', pausadoUsuario: false, erroPausa: false };
const logs = [];
const log = (t, nivel) => { if (nivel === 'erro') avisar('Bot de Fretes: erro', t); const l = `[${new Date().toLocaleTimeString('pt-BR')}] ${t}`; logs.unshift(l); logs.length = Math.min(logs.length, 150); try { fs.appendFileSync(arqLog, l + '\n'); } catch {} };

let cfg = { ...PADRAO, ...(fs.existsSync(arqCfg) ? JSON.parse(fs.readFileSync(arqCfg, 'utf8')) : {}) };
const configurado = () => urlOk(cfg.url) && !!cfg.token;
// A Fretebras pede aprovacao no celular a cada login novo: o bot so tenta entrar sozinho 1 vez a cada 30 min.
let ultimoLogin = 0;
const cfgLogin = () => { if (cfg.usuario && Date.now() - ultimoLogin > 30 * 60e3) { ultimoLogin = Date.now(); return cfg; } return { ...cfg, usuario: '' }; };
let ctx = null, app = null, sessao = null, paginaVisao = null, timers = [], emRodada = false, tentativas = 0, iniciando = false;

const janela = async estadoJanela => { // minimiza ou mostra o navegador do bot
  try {
    const p = ctx.pages().find(x => !x.isClosed()); const c = await ctx.newCDPSession(p);
    const { windowId } = await c.send('Browser.getWindowForTarget');
    await c.send('Browser.setWindowBounds', { windowId, bounds: { windowState: estadoJanela } });
  } catch {}
};
const aguardaLogin = async () => { await sessao.getByText(/^Ativos/).first().waitFor({ timeout: 0 }); };

async function garanteLogin() { // entra sozinho (se tem login salvo) ou pede para voce entrar na janela
  const r = await entrar(ctx, SITE, cfgLogin(), sessao);
  if (r === 'ja-logado' || r === 'entrou') { await janela('minimized'); return true; } // login resolvido sozinho: minimiza do mesmo jeito
  estado.fase = 'login';
  estado.motivo = r === 'senha-errada' ? 'O e-mail ou a senha da Central estão incorretos. Corrija nas Configurações ou entre você mesmo na janela do navegador.' : r === 'falhou' ? 'O login automático não terminou. Se a Fretebras pediu autorização no celular, aprove; senão entre você mesmo na janela do navegador.' : 'Entre na Central na janela do navegador (só na primeira vez).';
  await janela('normal'); log(estado.motivo); avisar('Bot de Fretes: preciso de você', estado.motivo);
  await aguardaLogin(); await janela('minimized');
  return true;
}

async function iniciarBot() {
  if (iniciando || ctx) return;
  if (!configurado()) { estado.fase = 'configurar'; estado.motivo = ''; return; }
  iniciando = true; estado.fase = 'iniciando'; estado.motivo = 'Abrindo o navegador do bot...';
  try {
    // nasce minimizado: so aparece se voce clicar em "Mostrar navegador do bot" ou se ele precisar de voce (login, erro)
    ctx = await chromium.launchPersistentContext(path.join(pasta, 'perfil'), { headless: false, channel: 'chromium', viewport: null, args: ['--start-minimized'] });
    ctx.on('close', () => { if (ctx && estado.fase !== 'parado' && estado.fase !== 'gravando') { log('O navegador do bot foi fechado.'); ctx = null; app = null; estado.fase = 'parado'; estado.motivo = 'O navegador do bot foi fechado. Salve as configurações ou reabra o programa.'; avisar('Bot de Fretes: parou', estado.motivo); } });
    app = criar({ ctx, arquivoDados: path.join(pasta, 'dados.json'), escrever: log });
    await app.chrome.storage.local.set({ syncCfg: { ...cfg, auto: true } });
    await app.rodar('syncRetomar()');
    sessao = ctx.pages().find(x => !x.isClosed()) || await ctx.newPage(); // usa a aba vazia que o navegador abre, sem deixar sobra
    estado.motivo = ''; await garanteLogin();
    estado.fase = 'rodando'; estado.motivo = ''; estado.erroPausa = false; log('Login ok. O bot está rodando.');
    agendar(); rodada();
  } catch (e) { log('Erro ao iniciar: ' + e.message, 'erro'); estado.fase = 'parado'; estado.motivo = 'Erro ao iniciar: ' + e.message; ctx = null; }
  finally { iniciando = false; }
}

function agendar() {
  timers.forEach(clearInterval);
  timers = [setInterval(() => rodada(), Math.max(1, Number(cfg.minutos) || 15) * 60e3),
    setInterval(manterSessao, 10 * 60e3)]; // a cada 10 min reabre a Central: renova a sessao e entra de novo se caiu
}

async function manterSessao() {
  if (!ctx || emRodada || estado.fase !== 'rodando') return;
  try { if (!(await entrar(ctx, SITE, cfgLogin(), sessao)).match(/logado|entrou/)) { estado.fase = 'login'; estado.motivo = 'A sessão caiu: entre na janela do navegador.'; avisar('Bot de Fretes: sessão caiu', estado.motivo); await janela('normal'); await aguardaLogin(); await janela('minimized'); estado.fase = 'rodando'; estado.motivo = ''; } } catch {}
}

async function rodada() {
  if (!app || emRodada || estado.fase !== 'rodando' || estado.pausadoUsuario) return;
  emRodada = true;
  try {
    const e = (await app.chrome.storage.local.get('syncEstado')).syncEstado || {};
    if (e.pausado) {
      estado.erroPausa = true; estado.motivo = e.motivo || 'Pausado por erro.'; avisar('Bot de Fretes: pausado', estado.motivo);
      if (cfg.usuario && tentativas < 2 && Date.now() - ultimoLogin > 30 * 60e3) { // sessao caiu: tenta entrar sozinho (no maximo 2 vezes seguidas)
        tentativas++; log('Sessão caiu. Tentando entrar de novo...');
        if ((await entrar(ctx, SITE, cfgLogin(), sessao)) === 'entrou') { tentativas = 0; await app.rodar('syncRetomar()'); estado.erroPausa = false; estado.motivo = ''; emRodada = false; return rodada(); }
      }
      return;
    }
    await app.rodar('syncAuto()');
    const e2 = (await app.chrome.storage.local.get('syncEstado')).syncEstado || {};
    if (e2.pausado) { estado.erroPausa = true; estado.motivo = e2.motivo || ''; avisar('Bot de Fretes: pausado', estado.motivo); }
    estado.ultima = Date.now();
  } catch (e) { log('Erro na rodada: ' + e.message, 'erro'); }
  finally { emRodada = false; }
}

async function pararBot() {
  timers.forEach(clearInterval); timers = [];
  const c = ctx; ctx = null; app = null; sessao = null; paginaVisao = null;
  if (c) await c.close().catch(() => {});
}

let gravacao = null;
async function acao(a) {
  if (a === 'agora') { rodada(); return { ok: true }; }
  if (a === 'pausa') { estado.pausadoUsuario = !estado.pausadoUsuario; log(estado.pausadoUsuario ? 'Pausado por você.' : 'Continuando.'); return { ok: true }; }
  if (a === 'retoma') { tentativas = 0; estado.erroPausa = false; estado.motivo = ''; if (app) await app.rodar('syncRetomar()'); rodada(); return { ok: true }; }
  if (a === 'navegador') {
    if (!ctx) return { ok: true };
    try { // mostra uma aba nova ja filtrada por voce (fecha a anterior, para nao empilhar abas a cada clique)
      if (paginaVisao && !paginaVisao.isClosed()) await paginaVisao.close().catch(() => {});
      const { page, est } = await meus.abrirMeus(ctx, SITE);
      await meus.filtrarMeus(page, est);
      paginaVisao = page;
      await page.bringToFront();
    } catch (e) { log('Nao consegui abrir Meus Fretes ja filtrado: ' + e.message); }
    await janela('normal');
    return { ok: true };
  }
  if (a.startsWith('planilha-')) {
    if (!app) return { erro: 'o bot ainda nao esta rodando' };
    const nomeAcao = a.slice('planilha-'.length);
    try {
      const r = await app.rodar(`planilhaAcao(${JSON.stringify(nomeAcao)})`);
      log(`Planilha (${nomeAcao}): ${JSON.stringify(r)}`);
      return { ok: true, resultado: r };
    } catch (e) { log(`Planilha (${nomeAcao}): erro - ${e.message}`, 'erro'); return { erro: e.message }; }
  }
  if (a === 'gravar') {
    estado.fase = 'gravando'; estado.motivo = 'Faça no navegador o que quiser gravar. Depois clique em "Parar e salvar relatório".';
    await pararBot();
    ctx = await chromium.launchPersistentContext(path.join(pasta, 'perfil'), { headless: false, channel: 'chromium', viewport: null, args: ['--start-maximized'] });
    gravacao = await gravar.iniciarGravacao(ctx);
    (ctx.pages()[0] || await ctx.newPage()).goto(SITE + 'meus-fretes').catch(() => {});
    return { ok: true };
  }
  if (a === 'parar' && gravacao) {
    const arq = gravar.salvar(await gravacao(), pasta);
    log('Relatório salvo: ' + arq + '.txt e .json (mande os dois).');
    gravacao = null; const c = ctx; ctx = null; await c.close().catch(() => {});
    estado.fase = 'iniciando'; iniciarBot(); return { ok: true };
  }
  return { erro: 'ação desconhecida' };
}

async function salvarCfg(b) {
  const novo = { ...cfg };
  if (b.url !== undefined) { if (!urlOk(b.url.trim())) return { erro: 'O link precisa ser o "URL do app da Web" (começa com https://script.google.com e termina em /exec), não o link de editar a planilha.' }; novo.url = b.url.trim(); }
  if (b.token) novo.token = b.token.trim();
  if (b.usuario !== undefined) novo.usuario = b.usuario.trim();
  if (b.senhaFretebras) novo.senhaFretebras = b.senhaFretebras;
  for (const [k, mn, mx] of [['limite', 1, 50], ['abas', 1, 5], ['minutos', 1, 1440]]) if (b[k] !== undefined && b[k] !== '') novo[k] = Math.max(mn, Math.min(mx, Number(b[k]) || mn));
  if (b.fechar) novo.fechar = b.fechar === 'desativar' ? 'desativar' : 'excluir';
  if (b.apagarTudo !== undefined) novo.apagarTudo = !!b.apagarTudo;
  if (b.conferirZero !== undefined) novo.conferirZero = !!b.conferirZero;
  if (b.conferirSumidos !== undefined) novo.conferirSumidos = !!b.conferirSumidos;
  cfg = novo; fs.writeFileSync(arqCfg, JSON.stringify(cfg, null, 2));
  if (app) { await app.chrome.storage.local.set({ syncCfg: { ...cfg, auto: true } }); agendar(); }
  else if (!ctx && estado.fase !== 'gravando') iniciarBot();
  return { ok: true };
}

(async () => {
  const painel = await criarPainel({
    estado: async () => {
      const dados = (app && app.dados) || (fs.existsSync(path.join(pasta, 'dados.json')) ? JSON.parse(fs.readFileSync(path.join(pasta, 'dados.json'), 'utf8')) : {});
      const { token, senhaFretebras, ...visivel } = cfg;
      return { estado: { ...estado, fila: dados.syncFila || 0 }, cfg: visivel, historico: (dados.syncHistorico || []).slice(0, 100), logs, versao: VERSAO };
    },
    aoSalvar: salvarCfg, aoAcao: acao,
  });
  if (process.env.BOT_SO_PAINEL) { console.log('PAINEL ' + painel.url); iniciarBot(); return; } // teste
  const janelaPainel = await chromium.launchPersistentContext(path.join(pasta, 'painel-perfil'), { headless: false, viewport: null, channel: 'chromium', args: [`--app=${painel.url}`, '--window-size=1000,800'] });
  janelaPainel.on('close', async () => { await pararBot(); process.exit(0); }); // fechar o painel encerra o programa
  iniciarBot();
})().catch(e => { try { fs.appendFileSync(arqLog, 'ERRO: ' + e.stack + '\n'); } catch {} console.error(e); process.exit(1); });
