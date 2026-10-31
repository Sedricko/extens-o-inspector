// Bot de fretes para Windows: navegador proprio (perfil so do bot) + a mesma logica da extensao.
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs'), readline = require('readline');
const { criar } = require('./nucleo');
const { entrar } = require('./meus');
const SITE = 'https://novacentral.fretebras.com.br/';

const arqCfg = path.join(__dirname, 'config.json');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const pergunta = t => new Promise(r => rl.question(t, r));

(async () => {
  let cfg = fs.existsSync(arqCfg) ? JSON.parse(fs.readFileSync(arqCfg, 'utf8')) : {};
  const urlOk = u => /^https:\/\/script\.google(usercontent)?\.com\/.*\/exec(\?.*)?$/.test(u || '');
  while (!urlOk(cfg.url)) {
    if (cfg.url) console.log('Esse link nao serve: precisa ser o "URL do app da Web" do Apps Script (comeca com https://script.google.com e termina em /exec), nao o link de editar a planilha.');
    cfg.url = (await pergunta('Cole o link do app da web (termina em /exec): ')).trim();
  }
  if (!cfg.token) cfg.token = (await pergunta('Senha da planilha: ')).trim();
  if (cfg.usuario === undefined) { // opcional: login automatico (fica so neste computador, no config.json)
    cfg.usuario = (await pergunta('E-mail de login da Central (Enter para entrar voce mesmo): ')).trim();
    cfg.senhaFretebras = cfg.usuario ? (await pergunta('Senha da Central: ')).trim() : '';
  }
  cfg = { fechar: 'excluir', minutos: 15, limite: 50, pausaSeg: 10, abas: 1, conferirZero: true, apagarTudo: true, ...cfg, auto: true };
  fs.writeFileSync(arqCfg, JSON.stringify(cfg, null, 2));

  const ctx = await chromium.launchPersistentContext(path.join(__dirname, 'perfil'), {
    headless: false, channel: 'chromium', viewport: null, args: ['--start-maximized'],
  });
  const app = criar({ ctx, arquivoDados: path.join(__dirname, 'dados.json') });
  await app.chrome.storage.local.set({ syncCfg: cfg });
  await app.rodar('syncRetomar()'); // abrir o programa de novo = voce ja resolveu o login

  console.log('\nAbrindo a Central...');
  const login = async () => {
    const r = await entrar(ctx, SITE, cfg);
    if (r === 'manual' || r === 'aguardando' || r === 'falhou') {
      console.log(r === 'falhou' ? 'O login automatico nao funcionou. Entre voce mesmo na janela.' : 'Entre na Central na janela do navegador (so na primeira vez).');
      const page = ctx.pages()[0];
      await page.getByText(/^Ativos/).first().waitFor({ timeout: 0 });
    }
  };
  await login();
  console.log('Login ok. O bot esta rodando. Para encerrar, feche esta janela.\n');

  let tentativas = 0;
  const rodada = async () => {
    const est = JSON.parse(JSON.stringify(await app.chrome.storage.local.get('syncEstado'))).syncEstado || {};
    if (est.pausado) {
      if (cfg.usuario && tentativas < 2) { // sessao caiu: tenta entrar sozinho (no maximo 2 vezes seguidas)
        tentativas++; console.log('Sessao caiu. Tentando entrar de novo...');
        if ((await entrar(ctx, SITE, cfg)) === 'entrou') { tentativas = 0; await app.rodar('syncRetomar()'); return rodada(); }
      }
      return console.log('Pausado: ' + est.motivo + '\nEntre na Central de novo e aperte ENTER aqui para retomar.');
    }
    await app.rodar('syncAuto()');
  };
  rl.on('line', async () => { tentativas = 0; await app.rodar('syncRetomar()'); console.log('Retomado.'); rodada(); });
  setInterval(rodada, Math.max(1, Number(cfg.minutos) || 15) * 60e3);
  rodada();
  ctx.on('close', () => process.exit(0));
})().catch(e => { console.error('Erro:', e.message); process.exit(1); });
