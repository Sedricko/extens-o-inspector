// Bot de fretes para Windows: navegador proprio (perfil so do bot) + a mesma logica da extensao.
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs'), readline = require('readline');
const { criar } = require('./nucleo');

const arqCfg = path.join(__dirname, 'config.json');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const pergunta = t => new Promise(r => rl.question(t, r));

(async () => {
  let cfg = fs.existsSync(arqCfg) ? JSON.parse(fs.readFileSync(arqCfg, 'utf8')) : {};
  if (!cfg.url) cfg.url = (await pergunta('Cole o link da planilha (termina em /exec): ')).trim();
  if (!cfg.token) cfg.token = (await pergunta('Senha da planilha: ')).trim();
  cfg = { fechar: 'desativar', minutos: 15, limite: 5, pausaSeg: 10, abas: 1, conferirZero: true, ...cfg, auto: true };
  fs.writeFileSync(arqCfg, JSON.stringify(cfg, null, 2));

  const ctx = await chromium.launchPersistentContext(path.join(__dirname, 'perfil'), {
    headless: false, channel: 'chromium', viewport: null, args: ['--start-maximized'],
  });
  const app = criar({ ctx, arquivoDados: path.join(__dirname, 'dados.json') });
  await app.chrome.storage.local.set({ syncCfg: cfg });
  await app.rodar('syncRetomar()'); // abrir o programa de novo = voce ja resolveu o login

  console.log('\nAbrindo a Central. Se pedir login, entre agora (so na primeira vez).');
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('https://novacentral.fretebras.com.br/meus-fretes').catch(() => {});
  await page.waitForFunction(() => /ativos/i.test(document.body.innerText), null, { timeout: 0, polling: 2000 });
  console.log('Login ok. O bot esta rodando. Para encerrar, feche esta janela.\n');

  const rodada = async () => {
    const est = JSON.parse(JSON.stringify(await app.chrome.storage.local.get('syncEstado'))).syncEstado || {};
    if (est.pausado) return console.log('Pausado: ' + est.motivo + '\nEntre na Central de novo e aperte ENTER aqui para retomar.');
    await app.rodar('syncAuto()');
  };
  rl.on('line', async () => { await app.rodar('syncRetomar()'); console.log('Retomado.'); rodada(); });
  setInterval(rodada, Math.max(1, Number(cfg.minutos) || 15) * 60e3);
  rodada();
  ctx.on('close', () => process.exit(0));
})().catch(e => { console.error('Erro:', e.message); process.exit(1); });
