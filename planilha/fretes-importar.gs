/**
 * Master SPA - importa as cargas da aba Base para a aba FRETES (uma linha por idCarga) e marca para FECHAR as que encerraram.
 * Usa a MESMA regra do seu Autoresponder:
 *   ATIVA   = StatusOferta ATIVA, Operacao diferente de so FROTA, nao cancelada, nao fechada, nao vencida
 *   FECHADA = aba Mot com situacao FECHADO para o idCarga, ou fx_StatusCarga EM PROCESSO
 *   VENCIDA = coleta (DtHrCarregamento) ha mais de 24 horas
 * Cole este arquivo no MESMO projeto do Apps Script (junto com fretes-config.gs e o seu codigo). Nao usa nomes do seu codigo.
 *
 * Fluxo: carga ativa nova -> linha em FRETES com STATUS PUBLICAR (ou REVISAR, se a publicacao automatica estiver desligada)
 *        -> a extensao publica e escreve Publicado + CODIGO -> quando a carga encerra, este script troca para FECHAR
 *        -> a extensao desativa/exclui na Fretebras.
 */
const frNorm_ = t => String(t == null ? '' : t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const frChaveCol_ = h => frNorm_(h).replace(/[^a-z]/g, '');
const FR_IMP = { BASE: 'Base', MOT: 'Mot', MAX_NOVAS: 10, VENCE_HORAS: 24, MAX_PESO_TON: 50 };

function frCabecalho_(linha) {
  const m = {};
  linha.forEach((h, i) => { const k = frChaveCol_(h); if (k && m[k] === undefined) m[k] = i; });
  return m;
}
const frCol_ = (m, nomes) => { for (const n of nomes) if (m[n] !== undefined) return m[n]; return -1; };

function frData_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (!v) return null;
  const s = String(v).trim();
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2}))?/);
  if (br) return new Date(+br[3], +br[2] - 1, +br[1], +(br[4] || 0), +(br[5] || 0));
  const d = new Date(s.replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}

function frVeiculo_(raw) { // mesma traducao do seu formatarVeiculo, com os nomes do site da Fretebras
  const nomes = [];
  const add = (...n) => n.forEach(x => { if (nomes.indexOf(x) < 0) nomes.push(x); });
  String(raw || '').split(',').forEach(p => {
    const t = p.toLowerCase().trim();
    if (!t) return;
    if (t.includes('rodotrem')) add('Rodotrem');
    else if (t.includes('bitrem')) add('Bitrem');
    else if (t.includes('bi-truck') || t.includes('bitruck')) add('Bitruck');
    else if (t.includes('truck')) add('Truck');
    else if (t.includes('vanderl') || t.includes('carreta ls') || t.includes('cavalo trucado')) add('Carreta LS', 'Vanderléia');
    else if (t.includes('cavalo toco') || t.includes('carreta')) add('Carreta');
    else if (t.includes('3/4')) add('3/4');
    else if (t.includes('van')) add('Van');
    else if (t.includes('toco')) add('Toco');
    else add(p.trim());
  });
  return nomes.join(' + ');
}

function frCarroceria_(raw) {
  const nomes = [];
  String(raw || '').split(',').forEach(p => {
    const t = frNorm_(p);
    if (!t) return;
    const n = t.includes('container') ? 'Bug Porta Container' : t.includes('frigorifico') ? 'Baú Frigorífico' : t.includes('refrigerado') ? 'Baú Refrigerado'
      : t === 'bau' ? 'Baú' : t === 'sider' ? 'Sider' : t === 'grade baixa' ? 'Grade Baixa' : t === 'graneleiro' ? 'Graneleiro'
      : t === 'cacamba' ? 'Caçamba' : t === 'plataforma' ? 'Plataforma' : t === 'prancha' ? 'Prancha' : p.trim();
    if (nomes.indexOf(n) < 0) nomes.push(n);
  });
  return nomes.join(' + ');
}

function frPeso_(v) { // kg -> "25 Ton"
  const kg = typeof v === 'number' ? v : Number(String(v || '').replace(/\./g, '').replace(',', '.'));
  if (!isFinite(kg) || kg <= 0) return '';
  return (Math.round(kg / 100) / 10) + ' Ton';
}

// Le Base e Mot e devolve { id: { ativa, linha } } com a linha ja no formato da aba FRETES.
function frLerBase_(ss) {
  const base = ss.getSheetByName(FR_IMP.BASE);
  if (!base || base.getLastRow() < 2) throw new Error('aba Base vazia ou inexistente');
  const v = base.getDataRange().getValues();
  const m = frCabecalho_(v[0]);
  const c = nomes => frCol_(m, nomes);
  const iId = c(['idcarga', 'id']);
  if (iId < 0) throw new Error('a aba Base nao tem a coluna idCarga');
  const col = {
    status: c(['statusoferta', 'status']), fx: c(['fxstatuscarga', 'statuscarga']), oper: c(['operacao']), coleta: c(['dthrcarregamento', 'carregamento']),
    prod: c(['tpproduto', 'produto']), rast: c(['cargarastreada', 'rastreada']), veic: c(['tpveiculo', 'veiculo']), carr: c(['tpcarroceria', 'carroceria']),
    pal: c(['qtdpallets', 'pallets']), co: c(['cidadeorigem']), uo: c(['uforigem']), cd: c(['cidadedestino']), ud: c(['ufdestino']),
    peso: c(['pesocarga', 'peso']), obs: c(['observacoes', 'observacao', 'obs']),
  };
  const fechadas = new Set();
  const mot = ss.getSheetByName(FR_IMP.MOT);
  if (mot && mot.getLastRow() > 1) {
    const mv = mot.getDataRange().getValues(), mm = frCabecalho_(mv[0]);
    const iM = frCol_(mm, ['idcarga', 'id']), iS = frCol_(mm, ['situacao', 'status']);
    if (iM >= 0 && iS >= 0) mv.slice(1).forEach(r => { if (String(r[iM]).trim() && frNorm_(r[iS]) === 'fechado') fechadas.add(String(r[iM]).trim()); });
  }
  const agora = Date.now(), cargas = {};
  v.slice(1).forEach(r => {
    const id = String(r[iId] || '').trim();
    if (!id) return;
    const g = i => (i < 0 || r[i] == null ? '' : r[i]);
    const status = frNorm_(g(col.status)), fx = frNorm_(g(col.fx));
    const coleta = frData_(g(col.coleta));
    const vencida = coleta && coleta.getTime() < agora - FR_IMP.VENCE_HORAS * 3600e3;
    const ativa = status === 'ativa' && frNorm_(g(col.oper)) !== 'frota' && status !== 'cancelada' && fx !== 'cancelada' &&
      fx !== 'finalizado' && fx !== 'em processo' && !fechadas.has(id) && !vencida;
    const rast = frNorm_(g(col.rast));
    const pal = Number(g(col.pal)) || 0;
    cargas[id] = {
      ativa,
      linha: {
        origem: `${String(g(col.co)).trim()}/${String(g(col.uo)).trim()}`.toUpperCase(),
        destino: `${String(g(col.cd)).trim()}/${String(g(col.ud)).trim()}`.toUpperCase(),
        produto: String(g(col.prod)).trim() || 'CARGA GERAL', valor: 'A combinar', peso: frPeso_(g(col.peso)), paletes: pal > 0 ? pal + ' PAL' : '',
        veiculo: frVeiculo_(g(col.veic)), carroceria: frCarroceria_(g(col.carr)), rastreada: rast === 'sim' ? 'Sim' : 'Não', lona: 'Não',
        pagamento: 'Outro', observacoes: String(g(col.obs)).trim().slice(0, 400), idcarga: id,
      },
    };
  });
  return cargas;
}

function importarDaBase() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const fretes = ss.getSheetByName(FR_ABA);
    if (!fretes) throw new Error('rode antes "Configurar aba FRETES"');
    const cargas = frLerBase_(ss);
    if (!Object.keys(cargas).length) throw new Error('a aba Base nao tem cargas: nada foi alterado');

    // coluna IDCARGA na aba FRETES (cria se faltar)
    let cab = fretes.getRange(1, 1, 1, fretes.getLastColumn()).getValues()[0];
    let m = frCabecalho_(cab);
    if (m.idcarga === undefined) { fretes.getRange(1, cab.length + 1).setValue('IDCARGA'); cab = cab.concat('IDCARGA'); m = frCabecalho_(cab); }
    ['status', 'codigo', 'origem', 'destino'].forEach(k => { if (m[k] === undefined) throw new Error('falta a coluna ' + k.toUpperCase() + ' na aba FRETES'); });
    const dados = fretes.getLastRow() > 1 ? fretes.getRange(2, 1, fretes.getLastRow() - 1, cab.length).getValues() : [];
    const conhecidos = new Set(dados.map(r => String(r[m.idcarga] || '').trim()).filter(Boolean));

    // 1) cargas ativas novas entram (ate FR_IMP.MAX_NOVAS por vez; as demais ficam para a proxima rodada)
    const auto = PropertiesService.getScriptProperties().getProperty('FR_AUTO') === 'sim';
    const novas = Object.keys(cargas).filter(id => cargas[id].ativa && !conhecidos.has(id)).slice(0, FR_IMP.MAX_NOVAS);
    if (novas.length) {
      const linhas = novas.map(id => cab.map(h => {
        const k = frChaveCol_(h);
        return k === 'status' ? (auto ? 'PUBLICAR' : 'REVISAR') : (cargas[id].linha[k] !== undefined ? cargas[id].linha[k] : '');
      }));
      fretes.getRange(fretes.getLastRow() + 1, 1, linhas.length, cab.length).setValues(linhas);
    }

    // 2) o que ja estava na aba e a carga encerrou
    let fechar = 0, cancelar = 0;
    dados.forEach((r, i) => {
      const id = String(r[m.idcarga] || '').trim();
      if (!id) return;
      const c = cargas[id];
      if (c && c.ativa) return;
      const st = frNorm_(r[m.status]), linha = i + 2;
      if (st === 'publicado' && String(r[m.codigo]).trim()) { fretes.getRange(linha, m.status + 1).setValue('FECHAR'); fechar++; }
      else if (st === 'publicar' || st === 'revisar') { fretes.getRange(linha, m.status + 1).setValue('Encerrada antes de publicar'); cancelar++; }
    });
    ss.toast(`${novas.length} nova(s), ${fechar} para fechar, ${cancelar} encerrada(s) antes de publicar.`, 'Fretes', 6);
    return { novas: novas.length, fechar, cancelar };
  } finally {
    lock.releaseLock();
  }
}

function ligarPublicacaoAutomatica() { PropertiesService.getScriptProperties().setProperty('FR_AUTO', 'sim'); SpreadsheetApp.getUi().alert('Cargas importadas entram como PUBLICAR: a extensao publica sozinha.'); }
function desligarPublicacaoAutomatica() { PropertiesService.getScriptProperties().setProperty('FR_AUTO', 'nao'); SpreadsheetApp.getUi().alert('Cargas importadas entram como REVISAR: nada e publicado ate voce trocar o STATUS para PUBLICAR.'); }
function ativarImportacaoAutomatica() {
  desativarImportacaoAutomatica();
  ScriptApp.newTrigger('importarDaBase').timeBased().everyMinutes(10).create();
  SpreadsheetApp.getUi().alert('Importacao automatica ligada: a cada 10 minutos.');
}
function desativarImportacaoAutomatica() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'importarDaBase').forEach(t => ScriptApp.deleteTrigger(t));
}
