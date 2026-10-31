// Fretebras pelo background: guarda a sessao (so na memoria do navegador, chrome.storage.session), renova o
// token e chama a API do mesmo jeito que o site. Funciona com a aba fechada enquanto o Chrome estiver aberto.
const FB = {
  site: 'https://novacentral.fretebras.com.br/',
  api: 'https://nca-gateway.fretebras.com.br',
  sso: 'https://sso-external.fretebras.com.br/realms/companies/protocol/openid-connect/token',
  client: 'central-assinante',
};

const fbGet = async () => (await chrome.storage.session.get('fb')).fb || {};
// Uma gravacao por vez: token e cabecalhos chegam juntos e um apagaria o outro.
let fbQueue = Promise.resolve();
const fbSet = patch => (fbQueue = fbQueue.then(async () => {
  const fb = { ...(await fbGet()), ...patch };
  await chrome.storage.session.set({ fb });
  return fb;
}));
// Validade de dentro do JWT (campo exp); 0 se nao for JWT.
const jwtExp = tok => {
  try { return JSON.parse(atob(String(tok).replace(/^Bearer /, '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000 || 0; } catch { return 0; }
};
const fromToken = t => ({
  access: t.access_token,
  ...(t.refresh_token && { refresh: t.refresh_token }), // a renovacao pode nao mandar outro: fica o anterior
  accessExp: t.expires_in ? Date.now() + t.expires_in * 1000 : jwtExp(t.access_token),
  ...((t.refresh_expires_in || jwtExp(t.refresh_token)) && {
    refreshExp: t.refresh_expires_in ? Date.now() + t.refresh_expires_in * 1000 : jwtExp(t.refresh_token),
  }),
});

async function fbSaveSession(msg) {
  if (msg.token) await fbSet(fromToken(msg.token));
  if (msg.headers) await fbSet({ headers: msg.headers, diag: msg.diag });
  if (msg.auth) await fbSet({ auth: msg.auth, authExp: jwtExp(msg.auth) || Date.now() + 10 * 60e3 }); // sem JWT: 10 min desde que o site usou
}

async function fbStatus() {
  const fb = await fbGet();
  const until = Math.max(fb.refresh ? fb.refreshExp || 0 : 0, fb.auth ? fb.authExp || 0 : 0);
  return { active: Date.now() < until, until, renews: !!fb.refresh, lastTest: fb.lastTest || null, diag: fb.diag || null };
}

async function fbToken() {
  let fb = await fbGet();
  const authOk = fb.auth && Date.now() < fb.authExp - 60e3;
  if (!fb.refresh) {
    if (authOk) return fb; // so o cabecalho do site: vale ate vencer, sem renovar
    throw new Error('Sem sessao. Abra a Central da Fretebras (e faca login se pedir).');
  }
  if (Date.now() > fb.accessExp - 60e3 && !authOk) {
    if (Date.now() > fb.refreshExp) throw new Error('Sessao vencida. Abra a Central e faca login de novo.');
    const r = await fetch(FB.sso, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: FB.client, refresh_token: fb.refresh }),
    });
    if (!r.ok) throw new Error(`Nao consegui renovar a sessao (${r.status}). Abra a Central e faca login de novo.`);
    fb = await fbSet(fromToken(await r.json()));
  }
  return fb;
}

async function fbApi(method, path, body) {
  const fb = await fbToken();
  // Primeiro o cabecalho que o proprio site usa; se a API recusar (401), tenta o token do SSO.
  const auths = [...new Set([fb.auth && Date.now() < fb.authExp ? fb.auth : null, fb.access && `Bearer ${fb.access}`].filter(Boolean))];
  let r, text;
  for (const authorization of auths) {
    r = await fetch(FB.api + path, {
      method,
      credentials: 'include', // manda tambem os cookies do site, se a API usar
      headers: { ...fb.headers, authorization, ...(body && { 'content-type': 'application/json' }) },
      body: body && JSON.stringify(body),
    });
    text = await r.text();
    if (r.status !== 401) break;
  }
  if (!r.ok) {
    const d = fb.diag ? ` [site usa: ${fb.diag.scheme}, mesmo token do SSO: ${fb.diag.sameAsSso ? 'sim' : 'nao'}, cabecalhos: ${fb.diag.names.join(', ')}, credentials: ${fb.diag.credentials}]` : ' [ainda nao vi o site chamar a API: de F5 na Central]';
    throw new Error(`${method} ${path} respondeu ${r.status}: ${text.slice(0, 120)}${d}`);
  }
  return text ? JSON.parse(text) : null;
}

// Frete de teste: o mesmo formato do GOSP-CD75 gravado (Goiania -> Sao Paulo, Carreta, a combinar), produto "TESTE".
const testFreight = user => ({
  requestId: `${user}-${Date.now()}`,
  freight: {
    templateUuid: null, scheduled: { scheduledTo: null }, branchId: null, isPrivate: false, speciesId: 12,
    productTypeId: 'geral', productType: 'geral', productName: 'TESTE', product: {},
    observation: 'TESTE - SERA EXCLUIDO', ownerIds: [user], isComplement: false, isAggregation: false, mainOwnerId: user,
    negotiationType: null,
    measures: { totalGrossWeight: 25, unitMeasurementId: 1, quantity: null, cubicWeight: null, cubicMeter: null, length: null, width: null, height: null },
    hasInsurance: false, category: 'plus', isLot: false, companyShipperId: null,
  },
  transport: {
    isNational: true,
    origin: { zipcode: '74001959', cityId: 2476, description: 'Goiânia - GO', coordinate: { lat: -16.6800181, lon: -49.2546986 } },
    destination: { zipcode: '01001000', cityId: 5214, description: 'São Paulo - SP', coordinate: { lat: -23.5503099, lon: -46.6342009 } },
    vehicleTypeIds: [2], vehicleBodyAcronyms: ['Bf', 'Sd', 'Br', 'Ba'], hasTracking: true, hasTarpaulin: false,
    isVehicleComposition: true, isHighPerformance: false, isEmptyReturn: false,
    collectDate: null, collectDateEnd: null, deliveryDate: null, deliveryDateEnd: null,
  },
  payment: {
    hasPrice: false, price: null, unitMeasurementId: null, includesToll: false, paymentOptionIds: [1, 8, 3, 4, 5, 6],
    advancePayment: 70, minimumPrice: null, decision: null,
  },
  suggestedPricing: { toll: null, antt: null },
  consumption: { extra: false, freightHighlightId: null },
  vehicles: [{ id: 2, axles: 5, freight_value: 6789.46, capacity: 26.5 }],
});

const FREIGHTS = '/freight-management-bff/v1/freights';

async function fbPublishTest() {
  const me = (await fbApi('GET', '/web/v1/user/me')).data;
  const f = testFreight(me.id_hashed);
  const dup = await fbApi('POST', `${FREIGHTS}/duplicated`, {
    cargo: f.freight.productName, origin: f.transport.origin.cityId, destination: f.transport.destination.cityId,
    speciesId: f.freight.speciesId, companyId: me.company.id_hashed, type: 'plus', freightId: '', price: null,
  });
  if (dup.isDuplicated) throw new Error('Ja existe um frete de teste igual ativo. Exclua o anterior antes.');
  const r = (await fbApi('POST', FREIGHTS, f)).data;
  await fbSet({ lastTest: { id: r.id, code: r.freightCode } });
  return { id: r.id, code: r.freightCode };
}

async function fbDeleteTest() {
  const { lastTest } = await fbGet();
  if (!lastTest) throw new Error('Nenhum frete de teste para excluir.');
  const r = (await fbApi('DELETE', FREIGHTS, { freightIds: [lastTest.id] })).data;
  if (!r.success.includes(lastTest.id)) throw new Error('A Fretebras nao excluiu: ' + JSON.stringify(r.errors));
  await fbSet({ lastTest: null });
  return { deleted: lastTest.code };
}

// Preenche o formulario "Criar frete" numa aba em segundo plano a partir de uma linha da planilha (padrao: LINHA_PADRAO).
// A aba fica aberta, sem tomar o foco; com publish=true clica em Publicar, le o codigo e fecha so essa aba.
// Abre a pagina da Fretebras: aba em segundo plano (padrao) ou janela MINIMIZADA (opcao da pagina Sincronizar).
async function fbAbrir(url) {
  const cfg = typeof syncCfg === 'function' ? await syncCfg() : {};
  if (cfg.janela === 'minimizada') {
    const w = await chrome.windows.create({ url, state: 'minimized', focused: false });
    return { tab: w.tabs[0], janela: w.id };
  }
  return { tab: await chrome.tabs.create({ url, active: false }) };
}
// Se algo falhou (ou a aba e para voce conferir), a janela minimizada volta a aparecer, sem tomar o foco.
async function fbRestaurar(a) {
  if (a.janela) await chrome.windows.update(a.janela, { state: 'normal', focused: false }).catch(() => {});
}

let FB_TENTATIVAS = 80; // x 500 ms; so o teste automatico muda

async function fbFillTest(base = FB.site, publish = false, row = null) { // base: so o teste automatico muda
  const { passos, erros } = linhaParaPassos(row || LINHA_PADRAO);
  if (erros.length) throw new Error('Linha invalida: ' + erros.join('; '));
  const aberta = await fbAbrir(base + 'meus-fretes/cadastrar');
  const tab = aberta.tab;
  const ask = (cmd, arg) => chrome.tabs.sendMessage(tab.id, { cmd, arg });
  let last;
  // Abrir o endereco direto passa pelo login da Fretebras e a pagina recarrega: se isso cortar a conversa, tenta de novo.
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) { await chrome.tabs.reload(tab.id).catch(() => {}); await new Promise(r => setTimeout(r, 2500)); } // outra tentativa comeca com a pagina limpa
    let ready = false;
    for (let i = 0; i < FB_TENTATIVAS && !ready; i++) { // espera o formulario aparecer
      ready = !!((await ask('fill-ready').catch(() => null)) || {}).ready;
      if (!ready) await new Promise(r => setTimeout(r, 500));
    }
    if (!ready) break;
    try {
      const r = await ask('fill', passos); // a aba fica em segundo plano: nao tira voce da sua aba
      if (!publish || !r.ok) { await fbRestaurar(aberta); return r; } // so preencher, ou falhou: a janela volta a aparecer
      // Publicar: uma tentativa so. Se a conversa cair depois do clique, nao ha como saber se saiu: nao repete.
      let p;
      try { p = await ask('publish'); } catch (e) { await fbRestaurar(aberta); return { ok: false, incerta: true, done: r.done, error: 'perdi a conversa com a pagina depois de clicar em Publicar: confira em Meus Fretes se o frete saiu (nao tentei de novo)' }; }
      if (p.ok) chrome.tabs.remove(tab.id).catch(() => {}); // deu certo: fecha so a aba que a extensao abriu
      return { ...r, ...p, incerta: !!p.clicou && !p.ok }; // clicou e nao confirmou: pode ter saido
    } catch (e) { last = e; }
  }
  const err = new Error('Nao consegui preencher: ' + (last ? last.message : 'o formulario nao apareceu (a Central pediu login?).') + ' A aba ficou aberta em segundo plano.');
  err.global = !last; // formulario nunca apareceu: problema de login/site, nao da linha
  await fbRestaurar(aberta);
  throw err;
}

// Desativa ou exclui na Fretebras o frete com esse CODIGO (aba em segundo plano; fecha so se deu certo).
async function fbClose(codigo, acao, base = FB.site) {
  const aberta = await fbAbrir(base + 'meus-fretes');
  const tab = aberta.tab;
  const ask = (cmd, arg) => chrome.tabs.sendMessage(tab.id, { cmd, arg });
  let ready = false;
  for (let i = 0; i < FB_TENTATIVAS && !ready; i++) {
    ready = !!((await ask('close-ready').catch(() => null)) || {}).ready;
    if (!ready) await new Promise(r => setTimeout(r, 500));
  }
  if (!ready) {
    const err = new Error('Meus Fretes nao carregou (a Central pediu login?). A aba ficou aberta em segundo plano.');
    err.global = true;
    await fbRestaurar(aberta);
    throw err;
  }
  let r;
  try { r = await ask('close', { codigo, acao }); } catch (e) { await fbRestaurar(aberta); throw new Error('perdi a conversa com a pagina ao fechar ' + codigo + ': confira em Meus Fretes'); }
  if (r.ok) chrome.tabs.remove(tab.id).catch(() => {}); else await fbRestaurar(aberta);
  return r;
}

// Quantos fretes ATIVOS existem na conta (o numero "Ativos: N" de Meus Fretes soma todas as paginas).
// A tela mostra um numero provisorio enquanto a lista carrega: so vale quando duas leituras seguidas dao o mesmo valor.
let FB_ESPERA_ZERO = 3000; // ms entre leituras; so o teste automatico muda
async function fbContarAtivos(base = FB.site) {
  const aberta = await fbAbrir(base + 'meus-fretes');
  const tab = aberta.tab;
  const ask = (cmd, arg) => chrome.tabs.sendMessage(tab.id, { cmd, arg });
  const dorme = ms => new Promise(r => setTimeout(r, ms));
  let ready = false;
  for (let i = 0; i < FB_TENTATIVAS && !ready; i++) {
    ready = !!((await ask('close-ready').catch(() => null)) || {}).ready;
    if (!ready) await dorme(500);
  }
  if (!ready) {
    const err = new Error('Meus Fretes nao carregou (a Central pediu login?). A aba ficou aberta.');
    err.global = true;
    await fbRestaurar(aberta);
    throw err;
  }
  let anterior = null, ativos = null;
  for (let i = 0; i < 8 && ativos === null; i++) {
    await dorme(FB_ESPERA_ZERO);
    const r = await ask('count').catch(() => null);
    const n = r && typeof r.ativos === 'number' ? r.ativos : null;
    if (n !== null && n === anterior) ativos = n; // duas leituras iguais seguidas
    anterior = n;
  }
  chrome.tabs.remove(tab.id).catch(() => {});
  return { ativos };
}
