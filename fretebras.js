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
const fromToken = t => ({
  access: t.access_token,
  ...(t.refresh_token && { refresh: t.refresh_token }), // a renovacao pode nao mandar outro: fica o anterior
  accessExp: Date.now() + t.expires_in * 1000,
  ...(t.refresh_expires_in && { refreshExp: Date.now() + t.refresh_expires_in * 1000 }),
});

async function fbSaveSession(msg) {
  if (msg.token) await fbSet(fromToken(msg.token));
  if (msg.headers) await fbSet({ headers: msg.headers, diag: msg.diag });
  if (msg.auth) await fbSet({ auth: msg.auth, authAt: Date.now() });
}

async function fbStatus() {
  const fb = await fbGet();
  if (!fb.refresh) return { active: false };
  return { active: Date.now() < fb.refreshExp, until: fb.refreshExp, lastTest: fb.lastTest || null, diag: fb.diag || null };
}

async function fbToken() {
  let fb = await fbGet();
  if (!fb.refresh) throw new Error('Sem sessao. Abra a Central da Fretebras (e faca login se pedir).');
  if (Date.now() > fb.accessExp - 60e3) {
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
  const auths = [...new Set([fb.auth, `Bearer ${fb.access}`].filter(Boolean))];
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
