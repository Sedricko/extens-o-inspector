// Testa os scripts do Google Sheets (planilha/*.gs) com um simulador minimo do Google. Rodar: node teste_planilha.js
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const dia = 864e5, agora = Date.now();
const sheets = {
  FRETES: [
    ['ORIGEM', 'DESTINO', 'PRODUTO', 'VEÍCULO', 'STATUS', 'CÓDIGO'],
    ['JACAREI/SP', 'ATIBAIA/SP', 'Y', 'Carreta', 'Publicado', 'AB-1'],
  ],
  Base: [
    ['idCarga', 'StatusOferta', 'Operacao', 'DtHrCarregamento', 'TpProduto', 'CargaRastreada', 'TpVeiculo', 'TpCarroceria', 'QtdPallets', 'CidadeOrigem', 'UfOrigem', 'CidadeDestino', 'UfDestino', 'PesoCarga', 'Observacoes', 'fx_StatusCarga', 'Cliente'],
    ['a1', 'ATIVA', 'FROTA , TERCEIRO , AGREGADO', new Date(agora + dia), 'EMBALAGEM', 'SIM', 'CAVALO TRUCADO , CAVALO TOCO', 'BAÚ , SIDER', 28, 'EXTREMA', 'MG', 'FRUTAL', 'MG', 25000, 'NECESSARIO 6 CINTAS', 'CARGA EM ABERTO', 'CLIENTE SECRETO'],
    ['a2', 'ATIVA', 'FROTA', new Date(agora + dia), 'PAPEL', 'SIM', 'CAVALO TOCO', 'SIDER', '', 'SERRA', 'ES', 'VIANA', 'ES', 20000, '', 'CARGA EM ABERTO', ''],
    ['a3', 'ATIVA', 'TERCEIRO', new Date(agora + dia), 'PAPEL', 'SIM', 'CAVALO TOCO', 'SIDER', '', 'SERRA', 'ES', 'VIANA', 'ES', 20000, '', 'EM PROCESSO', ''],
    ['a4', 'ATIVA', 'TERCEIRO', new Date(agora + dia), 'PAPEL', 'SIM', 'CAVALO TOCO', 'SIDER', '', 'SERRA', 'ES', 'VIANA', 'ES', 20000, '', 'CARGA EM ABERTO', ''],
    ['a5', 'ATIVA', 'TERCEIRO', new Date(agora - 3 * dia), 'PAPEL', 'SIM', 'CAVALO TOCO', 'SIDER', '', 'SERRA', 'ES', 'VIANA', 'ES', 20000, '', 'CARGA EM ABERTO', ''],
    ['a6', 'CANCELADA', 'TERCEIRO', new Date(agora + dia), 'PAPEL', 'SIM', 'CAVALO TOCO', 'SIDER', '', 'SERRA', 'ES', 'VIANA', 'ES', 20000, '', 'CANCELADA', ''],
    ['a7', 'ATIVA', 'TERCEIRO', new Date(agora + dia), 'PAPEL', 'SIM', 'CAVALO TOCO', 'SIDER', '', 'SERRA', 'ES', 'VIANA', 'ES', 20000, '', 'FINALIZADO', ''],
    ['a8', 'ATIVA', 'TERCEIRO', '2099-01-01 10:00:00.28', 'BEBIDA', 'NÃO', 'TRUCK', "PORTA CONTAINER 40'", '', 'JACAREI', 'SP', 'ATIBAIA', 'SP', 14000, '', 'CARGA EM ABERTO', ''],
    ['a9', 'ATIVA', 'TERCEIRO', new Date(agora + dia), 'PAPEL', 'SIM', 'CAVALO TOCO', 'SIDER', '', 'SERRA', 'ES', 'VIANA', 'ES', 20000, '', 'EM PROCESSO', ''],
    ['a10', 'ATIVA', 'TERCEIRO', new Date(agora + dia), 'PAPEL', 'SIM', 'CAVALO TOCO', 'SIDER', '', 'SERRA', 'ES', 'VIANA', 'ES', 20000, '', 'EM PROCESSO', ''],
    ['a11', 'ATIVA', 'TERCEIRO', new Date(agora + dia), 'PAPEL', 'SIM', 'CAVALO TOCO', 'SIDER', '', 'SERRA', 'ES', 'VIANA', 'ES', 20000, '', 'CARGA EM ABERTO', ''],
  ],
  Mot: [['idCarga', 'idDados', 'Situacao', 'CPFMotorista'], ['a4', 'x', 'FECHADO', '000.000.000-00'], ['a11', 'y', 'CANCELADO', '1']],
};
const props = { SENHA: 'segredo' };
const triggers = [];
const planilha = {
  getSheetByName: n => (sheets[n] ? sheet(n) : null),
  toast() {},
};
const sheet = nome => {
  const d = sheets[nome];
  return {
    getName: () => nome,
    getDataRange: () => ({ getValues: () => d.map(r => r.slice()) }),
    getLastColumn: () => Math.max(...d.map(r => r.length)),
    getLastRow: () => d.length,
    getRange: (l, c, nl = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nl }, (_, i) => Array.from({ length: nc }, (_, j) => (d[l - 1 + i] && d[l - 1 + i][c - 1 + j] !== undefined ? d[l - 1 + i][c - 1 + j] : ''))),
      getValue: () => (d[l - 1] && d[l - 1][c - 1] !== undefined ? d[l - 1][c - 1] : ''),
      setValue: v => { (d[l - 1] = d[l - 1] || [])[c - 1] = v; },
      setValues: m => m.forEach((row, i) => row.forEach((v, j) => { (d[l - 1 + i] = d[l - 1 + i] || [])[c - 1 + j] = v; })),
    }),
  };
};
const ctx = vm.createContext({
  JSON, String, Number, Error, Date, Math, Set, Object, Array, isFinite, isNaN, console,
  Utilities: { getUuid: () => 'u-u' },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k], setProperty: (k, v) => { props[k] = v; } }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => planilha, getActive: () => planilha, getUi: () => ({ alert() {} }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ setMimeType: () => t }) },
  ScriptApp: { getProjectTriggers: () => triggers, deleteTrigger: t => triggers.splice(triggers.indexOf(t), 1),
    newTrigger: fn => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => triggers.push({ getHandlerFunction: () => fn }) }) }) }) },
});
// o usuario cola os arquivos no mesmo projeto: aqui os 3 (o do usuario nao entra; so conferimos que nao ha nomes repetidos entre os nossos)
for (const f of ['fretes-config.gs', 'fretes-importar.gs']) vm.runInContext(fs.readFileSync(`${__dirname}/planilha/${f}`, 'utf8').replace(/^const /gm, 'var '), ctx);
const run = c => { const r = vm.runInContext(c, ctx); return r && typeof r === 'object' ? JSON.parse(JSON.stringify(r)) : r; }; // copia para fora do simulador

// ---- aplicativo da web (senha, leitura, reserva, nao sobrescreve)
const get = t => JSON.parse(run('doGet')({ parameter: { token: t } }));
const post = o => JSON.parse(run('doPost')({ postData: { contents: JSON.stringify(o) } }));
sheets.FRETES.splice(1, 0, ['EXTREMA/MG', 'FRUTAL/MG', 'X', 'Carreta', 'PUBLICAR', '']);
assert.strictEqual(get('errada').ok, false);
assert.deepStrictEqual(get('segredo').linhas.map(l => [l.linha, l.origem, l.status, l.codigo]), [[2, 'EXTREMA/MG', 'PUBLICAR', ''], [3, 'JACAREI/SP', 'Publicado', 'AB-1']]);
const conf = { origem: 'extrema/mg', destino: 'FRUTAL/MG' };
assert.deepStrictEqual(post({ token: 'segredo', atualizacoes: [{ linha: 2, status: 'PUBLICANDO...', esperado: ['publicar'], confere: conf }] }).gravadas, [2]);
assert.strictEqual(post({ token: 'segredo', atualizacoes: [{ linha: 2, status: 'PUBLICANDO...', esperado: ['publicar'], confere: conf }] }).ignoradas.length, 1, 'segunda reserva recusada');
assert.strictEqual(post({ token: 'segredo', atualizacoes: [{ linha: 3, status: 'x', confere: conf }] }).ignoradas[0].motivo, 'a linha nao e mais a mesma');
assert.deepStrictEqual(post({ token: 'segredo', atualizacoes: [{ linha: 2, status: 'Publicado', codigo: 'MGMG-27DE', esperado: ['publicando...'], confere: conf }] }).gravadas, [2]);
assert.deepStrictEqual([sheets.FRETES[1][4], sheets.FRETES[1][5]], ['Publicado', 'MGMG-27DE']);
sheets.FRETES.splice(1, 1); // volta ao estado inicial

// ---- importador Base -> FRETES (mesma regra do Autoresponder)
// 1) aba FRETES sem a coluna IDCARGA: o importador cria
sheets.FRETES = [['ORIGEM', 'DESTINO', 'PRODUTO', 'STATUS', 'CÓDIGO']];
run('importarDaBase()');
assert.strictEqual(sheets.FRETES[0][5], 'IDCARGA', 'cria a coluna IDCARGA');
assert.deepStrictEqual(sheets.FRETES.slice(1).map(r => r[5]).sort(), ['a1', 'a11', 'a8'], 'so as cargas ativas');

// 2) cenario completo
const CAB = ['ORIGEM', 'DESTINO', 'PRODUTO', 'VALOR', 'PESO', 'PALETES', 'VEÍCULO', 'CARROCERIA', 'RASTREADA', 'LONA', 'PAGAMENTO', 'OBSERVAÇÕES', 'STATUS', 'CÓDIGO', 'IDCARGA'];
const lin = (st, cod, id) => ['SERRA/ES', 'VIANA/ES', 'PAPEL', 'A combinar', '20 Ton', '', 'Carreta', 'Sider', 'Sim', 'Não', 'Outro', '', st, cod, id];
sheets.FRETES = [CAB, lin('Publicado', 'ZZ-9', 'a9'), lin('PUBLICAR', '', 'a10'), lin('Publicado', 'ZZ-11', 'a11')];
const col = (r, k) => r[CAB.indexOf(k)];
const achar = id => sheets.FRETES.find((r, i) => i > 0 && col(r, 'IDCARGA') === id);
let r = run('importarDaBase()');
assert.deepStrictEqual(r, { novas: 2, fechar: 1, cancelar: 1 });
const a1 = achar('a1');
assert.deepStrictEqual(CAB.map(k => col(a1, k)), ['EXTREMA/MG', 'FRUTAL/MG', 'EMBALAGEM', 'A combinar', '25 Ton', '28 PAL', 'Carreta LS + Vanderléia + Carreta', 'Baú + Sider', 'Sim', 'Não', 'Outro', 'NECESSARIO 6 CINTAS', 'REVISAR', '', 'a1']);
const a8 = achar('a8');
assert.deepStrictEqual(['PESO', 'PALETES', 'VEÍCULO', 'CARROCERIA', 'RASTREADA'].map(k => col(a8, k)), ['14 Ton', '', 'Truck', 'Bug Porta Container', 'Não']);
assert.strictEqual(col(achar('a9'), 'STATUS'), 'FECHAR', 'publicada e a carga fechou (EM PROCESSO): fechar');
assert.strictEqual(col(achar('a10'), 'STATUS'), 'Encerrada antes de publicar', 'nao publica carga que fechou antes');
assert.strictEqual(col(achar('a11'), 'STATUS'), 'Publicado', 'Mot CANCELADO nao fecha (so FECHADO), carga continua ativa');
assert.ok(!sheets.FRETES.flat().some(v => /SECRETO|CPF|000\.000/.test(String(v))), 'nao copia cliente nem dados do motorista');
// 3) idempotente: rodar de novo nao duplica nem muda nada
const antes = JSON.stringify(sheets.FRETES);
assert.deepStrictEqual(run('importarDaBase()'), { novas: 0, fechar: 0, cancelar: 0 });
assert.strictEqual(JSON.stringify(sheets.FRETES), antes);
// 4) publicacao automatica ligada: carga nova entra como PUBLICAR
run('ligarPublicacaoAutomatica()');
sheets.Base.push(['a12', 'ATIVA', 'TERCEIRO', new Date(agora + dia), 'PAPEL', 'SIM', 'CAVALO TOCO', 'SIDER', '', 'SERRA', 'ES', 'VIANA', 'ES', 20000, '', 'CARGA EM ABERTO', '']);
assert.strictEqual(run('importarDaBase()').novas, 1);
assert.strictEqual(col(achar('a12'), 'STATUS'), 'PUBLICAR');
// 5) Base vazia nao fecha nada (protecao)
sheets.Base = [sheets.Base[0]];
assert.throws(() => run('importarDaBase()'), /Base vazia/);
assert.strictEqual(col(achar('a11'), 'STATUS'), 'Publicado');
// 6) trigger: liga e desliga sem duplicar
run('ativarImportacaoAutomatica()'); run('ativarImportacaoAutomatica()');
assert.strictEqual(triggers.length, 1);
run('desativarImportacaoAutomatica()');
assert.strictEqual(triggers.length, 0);
console.log('OK: aplicativo da web da planilha e importador Base -> FRETES (regra do Autoresponder, fechar, sem duplicar)');
