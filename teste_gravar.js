// Teste do modo GRAVAR contra o formulario falso: grava cliques/campos/rede/telas e gera o relatorio sem senha.
const assert = require('assert'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { chromium } = require('playwright');
const { iniciarGravacao, salvar } = require('./programa-windows/gravar');
const src = fs.readFileSync(path.join(__dirname, 'teste_extensao.js'), 'utf8');
const MEUS = eval(src.match(/const MEUS = (`[\s\S]*?`);/)[1]);
const LOGIN = '<!doctype html><meta charset="utf-8"><title>Entrar</title><input id="u" placeholder="E-mail"><input id="p" type="password" placeholder="Senha"><button id="e" onclick="fetch(\'/api/login\',{method:\'POST\',body:JSON.stringify({user:u.value,senha:p.value,access_token:\'eyJabcdefghijk.abcdefghijk.abcdefghijk\'})})">Entrar</button>';
(async () => {
  const srv = http.createServer((req, res) => { res.setHeader('content-type', req.url === '/login' ? 'text/html' : req.url === '/meus-fretes' ? 'text/html' : 'application/json'); res.end(req.url === '/login' ? LOGIN : req.url === '/meus-fretes' ? MEUS : '{"ok":true}'); }).listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grav-'));
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, channel: 'chromium' });
  try {
    const parar = await iniciarGravacao(ctx);
    const page = await ctx.newPage();
    await page.goto(base + '/login');
    await page.fill('#u', 'joao@x.com'); await page.fill('#p', 'SEGREDO123'); await page.click('#e');
    await page.waitForTimeout(500);
    await page.goto(base + '/meus-fretes');
    await page.fill('#q', 'MGMG-27DE'); await page.waitForTimeout(700);
    await page.check('.f'); await page.click('text=Desativar'); await page.waitForTimeout(300);
    await page.click('#modal button'); await page.waitForTimeout(800);
    const arq = salvar(await parar(), dir);
    const txt = fs.readFileSync(arq + '.txt', 'utf8'), json = fs.readFileSync(arq + '.json', 'utf8');
    assert.ok(/CLIQUE em "Entrar"/.test(txt), txt);
    assert.ok(/CAMPO "E-mail" = "joao@x.com"/.test(txt), txt);
    assert.ok(/CAMPO "Senha" = "\*\*\*"/.test(txt), txt);
    assert.ok(/APARECEU: .*Tem certeza/.test(txt), txt);
    assert.ok(/REDE POST .*\/api\/fechou/.test(txt), txt);
    assert.ok(!/SEGREDO123|eyJabcdefghijk/.test(txt + json), 'nenhum segredo no relatorio');
    assert.ok(/Desativar/.test(txt) && /TELAS ABERTAS/.test(txt));
    console.log('OK teste_gravar');
  } finally { await ctx.close(); srv.close(); }
})().catch(e => { console.error(e); process.exit(1); });
