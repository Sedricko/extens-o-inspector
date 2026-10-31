// Teste do programa completo: painel + bot. Rodar: xvfb-run -a node teste_painel.js
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const { chromium } = require('playwright');
(async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'prog-'));
  const filho = spawn(process.execPath, [path.join(__dirname, 'programa-windows', 'programa.js')], { detached: true, env: { ...process.env, BOT_PASTA: pasta, BOT_SO_PAINEL: '1' } });
  let url = ''; filho.stdout.on('data', d => { const m = String(d).match(/PAINEL (\S+)/); if (m) url = m[1]; });
  for (let i = 0; i < 100 && !url; i++) await new Promise(r => setTimeout(r, 200));
  assert.ok(url, 'painel subiu');
  const br = await chromium.launch({ channel: 'chromium' });
  try {
    const page = await br.newPage(); await page.goto(url);
    await page.getByText('Falta configurar').waitFor({ timeout: 8000 });
    assert.ok(await page.locator('#avisoCfg').isVisible(), 'aviso de configurar');
    // sem a chave, ninguem entra
    assert.strictEqual((await page.request.get(url.split('?')[0])).status(), 403);
    assert.strictEqual((await page.request.get(url.split('?')[0].replace(/\/$/, '') + '/api/estado')).status(), 403);
    // link errado (editar planilha) e recusado
    await page.fill('[name=url]', 'https://docs.google.com/spreadsheets/d/abc/edit'); await page.fill('[name=token]', 'segredo');
    await page.click('form button[type=submit]'); await page.getByText(/URL do app da Web/).waitFor();
    // link certo: salva, esconde segredos e o bot sobe
    await page.fill('[name=url]', 'https://script.google.com/macros/s/AKx/exec'); await page.fill('[name=limite]', '30');
    await page.click('form button[type=submit]'); await page.getByText('Salvo.').waitFor();
    // sem login salvo o bot NAO tenta entrar sozinho: so espera voce (o teste nao usa credenciais, a Central e real)
    await page.getByText('Aguardando login na Central').waitFor({ timeout: 60000 });
    await page.fill('[name=usuario]', 'eu@x.com'); await page.fill('[name=senhaFretebras]', 'SENHA-CENTRAL');
    await page.click('form button[type=submit]'); await page.getByText('Salvo.').waitFor();
    const cfg = JSON.parse(fs.readFileSync(path.join(pasta, 'config.json'), 'utf8'));
    assert.deepStrictEqual([cfg.token, cfg.usuario, cfg.senhaFretebras, cfg.limite, cfg.fechar, cfg.apagarTudo], ['segredo', 'eu@x.com', 'SENHA-CENTRAL', 30, 'excluir', true]);
    const estado = await page.evaluate(async () => (await fetch('/api/estado', { headers: { 'x-k': new URLSearchParams(location.search).get('k') } })).json());
    assert.ok(!JSON.stringify(estado).includes('segredo') && !JSON.stringify(estado).includes('SENHA-CENTRAL'), 'o painel nunca devolve as senhas');
    console.log('OK teste_painel'); setTimeout(() => process.exit(0), 500);
  } catch (e) { console.log('ESTADO', await (async () => { try { return fs.readFileSync(path.join(pasta, 'bot.log'), 'utf8'); } catch { return 'sem bot.log'; } })()); throw e; } finally { await br.close(); try { process.kill(-filho.pid); } catch {} }
})().catch(e => { console.error(e); process.exit(1); });
