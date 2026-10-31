// Meus Fretes SEMPRE filtrado por voce ("Publicado por"), conferido pela resposta da propria lista do site.
// Se a lista trouxer um frete de outra pessoa, o bot para: nunca fecha/apaga nada que nao seja seu.
const sleep = ms => new Promise(r => setTimeout(r, ms));
const global = msg => Object.assign(new Error(msg), { global: true });

async function abrirMeus(ctx, base) {
  const page = await ctx.newPage();
  const est = { n: 0, lista: null, eu: null, publicadores: null, apagou: null };
  page.on('response', async r => {
    try {
      const u = r.url(), m = r.request().method();
      if (m === 'GET' && /\/freight-management-bff\/v1\/freights\?/.test(u)) { est.lista = { url: decodeURIComponent(u), json: await r.json() }; est.n++; }
      else if (m === 'GET' && /\/web\/v1\/user\/me$/.test(u)) est.eu = (await r.json()).data;
      else if (m === 'GET' && /\/freights\/publishers\?/.test(u)) est.publicadores = (await r.json()).data;
      else if (m === 'DELETE' && /\/v1\/freights$/.test(u)) est.apagou = { corpo: r.request().postDataJSON(), res: (await r.json()).data };
    } catch {}
  });
  await page.goto(base + 'meus-fretes').catch(() => {});
  return { page, est };
}

const soMeus = est => !!(est.lista && est.eu && est.lista.url.includes(`publishers[]=${est.eu.id}`) &&
  est.lista.json.data.every(f => f.publisher && f.publisher.id === est.eu.id_hashed));

async function novaLista(est, antes, ms = 20000) {
  for (const t0 = Date.now(); est.n <= antes; await sleep(150)) if (Date.now() - t0 > ms) throw new Error('a lista de fretes nao recarregou');
}

// Deixa a lista filtrada so por voce. Lanca erro "global" (login/site) se a tela nao carregar.
async function filtrarMeus(page, est) {
  try { await page.getByText(/^Ativos/).first().waitFor({ timeout: 60000 }); }
  catch { throw global('Meus Fretes nao carregou (a Central pediu login?).'); }
  for (let i = 0; i < 80 && !(est.eu && est.publicadores && est.lista); i++) await sleep(250);
  if (!est.eu || !est.publicadores) throw global('nao consegui identificar o seu usuario na Central');
  if (soMeus(est)) return est.eu; // o site ja abriu filtrado por voce
  const nome = (est.publicadores.find(p => p.id === est.eu.id) || {}).fullName;
  if (!nome) throw new Error('voce nao aparece na lista "Publicado por"');
  const antes = est.n;
  const publicado = page.getByText('Publicado por', { exact: true }).first();
  if (!(await publicado.isVisible().catch(() => false))) { // abre a barra de filtros
    for (const alvo of [page.getByText(/^filtr/i).first(), page.getByLabel(/filtro/i).first(), page.locator('#root > div:nth-of-type(2) > div:nth-of-type(5) > div > div:nth-of-type(1) > div:nth-of-type(2) > div > div > div:nth-of-type(1) > div:nth-of-type(3) > div:nth-of-type(1) > span > div > div')]) {
      if (await alvo.isVisible().catch(() => false)) { await alvo.click(); await sleep(600); }
      if (await publicado.isVisible().catch(() => false)) break;
    }
  }
  await publicado.click();
  await page.getByText(nome, { exact: true }).first().click();
  await page.getByText('Confirmar', { exact: true }).first().click();
  await novaLista(est, antes);
  if (!soMeus(est)) throw new Error('o filtro "so meus" nao ficou certo: nao fiz nada');
  return est.eu;
}

// Quantos fretes ATIVOS seus existem (numero exato da propria Central, so os seus).
async function contarMeus(ctx, base) {
  const { page, est } = await abrirMeus(ctx, base);
  try {
    await filtrarMeus(page, est);
    return { ativos: est.lista.json.meta.total.enabled };
  } finally { await page.close().catch(() => {}); }
}

// Exclui TODOS os seus fretes ativos, pagina por pagina, ate nao sobrar nenhum.
async function apagarMeus(ctx, base, escrever = () => {}) {
  const { page, est } = await abrirMeus(ctx, base);
  let apagados = 0;
  try {
    await filtrarMeus(page, est);
    for (let volta = 0; volta < 200; volta++) {
      if (!soMeus(est)) throw new Error('a lista deixou de ser so sua: parei sem apagar');
      const ids = est.lista.json.data.map(f => f.id);
      if (!ids.length) return { apagados };
      const marcar = page.locator('label:has(input[type=checkbox])').first();
      await marcar.click();
      await page.getByText('Excluir', { exact: true }).first().waitFor({ timeout: 10000 });
      const marcados = await page.locator('input[type=checkbox]:checked').count();
      if (marcados < ids.length) throw new Error(`marquei ${marcados} de ${ids.length} fretes: parei sem apagar`);
      est.apagou = null; const antes = est.n;
      await page.getByText('Excluir', { exact: true }).first().click();
      await page.getByText(/^Excluir frete/).first().waitFor({ timeout: 10000 });
      await page.getByText('Excluir', { exact: true }).last().click();
      for (let i = 0; i < 120 && !est.apagou; i++) await sleep(250);
      if (!est.apagou) throw new Error('a Central nao confirmou a exclusao');
      const { corpo, res } = est.apagou;
      if (!corpo.freightIds.every(id => ids.includes(id))) throw new Error('a exclusao incluiu fretes fora da sua lista!');
      if (res.errors && res.errors.length) throw new Error('a Central recusou excluir: ' + JSON.stringify(res.errors).slice(0, 120));
      apagados += res.success.length;
      escrever(`Excluidos ${apagados} frete(s) seus ate agora...`);
      await novaLista(est, antes);
    }
    throw new Error('muitas paginas: parei por seguranca');
  } finally { await page.close().catch(() => {}); }
}

// Login automatico (so se usuario e senha estiverem no config.json; senao entre voce mesmo na janela).
async function entrar(ctx, base, cfg, pagina) {
  const page = pagina || ctx.pages().find(p => !p.isClosed()) || await ctx.newPage();
  await page.goto(base + 'meus-fretes').catch(() => {});
  const ativos = page.getByText(/^Ativos/).first(), user = page.locator('#username, input[name=username]').first();
  for (let i = 0; i < 120; i++) {
    if (await ativos.isVisible().catch(() => false)) return 'ja-logado';
    if (await user.isVisible().catch(() => false)) break;
    await sleep(500);
  }
  if (!(await user.isVisible().catch(() => false))) return 'aguardando';
  if (!cfg.usuario || !cfg.senhaFretebras) return 'manual';
  await user.fill(cfg.usuario);
  await page.locator('#password, input[name=password]').first().fill(cfg.senhaFretebras);
  const manter = page.locator('input[name=rememberMe]').first();
  if (await manter.count()) await manter.check({ force: true }).catch(() => {});
  await page.locator('#kc-login, button[type=submit], input[type=submit]').first().click();
  // ate 3 min: pode haver aprovacao no celular. Senha errada aparece como aviso na propria tela de login.
  const erro = page.locator('#input-error, .alert-error, .kc-feedback-text, [class*=error]').filter({ hasText: /./ }).first();
  for (const t0 = Date.now(); Date.now() - t0 < 180000; await sleep(1000)) {
    if (await ativos.isVisible().catch(() => false)) return 'entrou';
    if (await user.isVisible().catch(() => false) && await erro.isVisible().catch(() => false)) return 'senha-errada';
  }
  return 'falhou';
}

module.exports = { abrirMeus, filtrarMeus, contarMeus, apagarMeus, entrar };
