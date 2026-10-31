// Abre um Chromium proprio (perfil so do bot) com a extensao Master SPA carregada.
// Login e config ficam em ./perfil; a extensao faz todo o trabalho.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ext = path.join(__dirname, 'extensao');
const perfil = path.join(__dirname, 'perfil');
if (!fs.existsSync(path.join(ext, 'manifest.json'))) {
  console.error('Pasta "extensao" nao encontrada ao lado deste programa.'); process.exit(1);
}

(async () => {
  const ctx = await chromium.launchPersistentContext(perfil, {
    headless: false, channel: 'chromium', viewport: null,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--start-maximized'],
  });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('https://novacentral.fretebras.com.br/meus-fretes');
  const painel = await ctx.newPage();
  await painel.goto(`chrome-extension://${id}/sync/sync.html`);
  console.log('Bot aberto. Entre na Central (uma vez), use o painel "Sincronizar" e deixe esta janela aberta.');
  console.log('Para encerrar, feche a janela do navegador.');
  ctx.on('close', () => process.exit(0));
})().catch(e => { console.error('Erro:', e.message); process.exit(1); });
