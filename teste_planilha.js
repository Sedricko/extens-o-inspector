// Testa planilha/fretes-tudo.gs (projeto solto: sem planilha "ativa" e sem janelas) com um simulador minimo do Google. Rodar: node teste_planilha.js
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const dia = 864e5, agora = Date.now();
const sheets = {
  FRETES: [['ORIGEM', 'DESTINO', 'PRODUTO', 'VEÍCULO', 'STATUS', 'CÓDIGO']],
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
  Mot: [['idCarga', 'idDados', 'Situacao', 'CPFMotorista'], ['a4', 'x', 'FECHADO', '000.000.000-00'], ['a11', 'y', 'CANCELADO', '']],
};
const props = {}, triggers = [], logs = [];
const chain = () => new Proxy(function () {}, { get: (t, p) => (p === 'then' ? undefined : chain()), apply: () => chain() }); // formatacao: aceita qualquer chamada
const comFallback = o => new Proxy(o, { get: (t, p) => (p in t ? t[p] : chain()) });
const sheet = (store, nome) => {
  const d = store[nome];
  return comFallback({
    getName: () => nome,
    getDataRange: () => ({ getValues: () => d.map(r => r.slice()) }),
    getLastColumn: () => Math.max(...d.map(r => r.length)),
    getLastRow: () => d.length,
    getRange: (l, c, nl = 1, nc = 1) => comFallback({
      getValues: () => Array.from({ length: nl }, (_, i) => Array.from({ length: nc }, (_, j) => (d[l - 1 + i] && d[l - 1 + i][c - 1 + j] !== undefined ? d[l - 1 + i][c - 1 + j] : ''))),
      getValue: () => (d[l - 1] && d[l - 1][c - 1] !== undefined ? d[l - 1][c - 1] : ''),
      setValue: v => { (d[l - 1] = d[l - 1] || [])[c - 1] = v; },
      setValues: m => { m.forEach((row, i) => row.forEach((v, j) => { (d[l - 1 + i] = d[l - 1 + i] || [])[c - 1 + j] = v; })); return chain(); },
    }),
  });
};
const mkPlanilha = store => ({ getSheetByName: n => (store[n] ? sheet(store, n) : null), insertSheet: n => { store[n] = []; return sheet(store, n); } });
const planilha = mkPlanilha(sheets), storeBase = {}, planilhaBase = mkPlanilha(storeBase);
const ctx = vm.createContext({
  JSON, String, Number, Error, Date, Math, Set, Object, Array, isFinite, isNaN, console,
  Logger: { log: (f, ...a) => logs.push(String(f).replace(/%s/g, () => a.shift())) },
  Utilities: { getUuid: () => require('crypto').randomUUID() },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k], setProperty: (k, v) => { props[k] = v; } }) },
  // projeto solto: nao existe planilha "ativa" nem janelas (getUi); so openById
  SpreadsheetApp: { openById: id => { if (id === 'ID_BASE') return planilhaBase; if (id !== 'ID_TESTE') throw new Error('Unexpected error while getting the method or property openById'); return planilha; }, newDataValidation: () => chain(), newConditionalFormatRule: () => chain() },
  LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ setMimeType: () => t }) },
  ScriptApp: { getProjectTriggers: () => triggers, deleteTrigger: t => triggers.splice(triggers.indexOf(t), 1),
    newTrigger: fn => ({ timeBased: () => { const c = { create: () => triggers.push({ getHandlerFunction: () => fn }) }; return { everyMinutes: () => c, everyHours: () => c }; } }) },
});
// normaliza: o arquivo entregue pode vir com um FR_ID de verdade ja preenchido (para o usuario so colar); o teste
// sempre parte do marcador, para nao depender disso.
const fonte = fs.readFileSync(`${__dirname}/planilha/fretes-tudo.gs`, 'utf8')
  .replace(/^const FR_ID = '[^']*';/m, "const FR_ID = 'COLE_AQUI_O_ID_DA_PLANILHA';");
const carregar = t => vm.runInContext(t.replace(/^const /gm, 'var '), ctx);
const run = c => { const r = vm.runInContext(c, ctx); return r && typeof r === 'object' ? JSON.parse(JSON.stringify(r)) : r; }; // copia para fora do simulador
const get = t => JSON.parse(vm.runInContext('doGet', ctx)({ parameter: { token: t } }));
const post = o => JSON.parse(vm.runInContext('doPost', ctx)({ postData: { contents: JSON.stringify(o) } }));

// sem trocar o ID: a mensagem diz o que fazer
carregar(fonte);
assert.match(get('x').erro, /senha invalida|troque FR_ID/);
props.SENHA = 'x';
assert.match(get('x').erro, /troque FR_ID/);
delete props.SENHA;
carregar(fonte.replace('COLE_AQUI_O_ID_DA_PLANILHA', 'ID_TESTE'));

// ---- preparacao e senha
run('testarAcesso()'); assert.ok(logs.some(l => /Aba FRETES encontrada/.test(l)) && logs.some(l => /Aba Base encontrada/.test(l)));
run('mostrarSenha()'); const SENHA = props.SENHA; assert.ok(SENHA.length >= 60, 'cria a senha se nao existir');
run('mostrarSenha()'); assert.strictEqual(props.SENHA, SENHA, 'mostrar nao troca a senha');
run('gerarSenha()'); assert.notStrictEqual(props.SENHA, SENHA, 'gerar troca a senha'); props.SENHA = SENHA;
run('configurarAbaFretes()');
assert.deepStrictEqual(sheets.FRETES[0], ['ORIGEM', 'DESTINO', 'PRODUTO', 'VALOR', 'PESO', 'PALETES', 'VEÍCULO', 'CARROCERIA', 'RASTREADA', 'LONA', 'PAGAMENTO', 'OBSERVAÇÕES', 'STATUS', 'CÓDIGO', 'IDCARGA', 'PUBLICADO EM'], 'cabecalho completo');

// ---- aplicativo da web (senha, leitura, reserva, nao sobrescreve)
sheets.FRETES.push(['EXTREMA/MG', 'FRUTAL/MG', 'X', '', '', '', 'Carreta', '', '', '', '', '', 'PUBLICAR', '', ''], ['JACAREI/SP', 'ATIBAIA/SP', 'Y', '', '', '', 'Carreta', '', '', '', '', '', 'Publicado', 'AB-1', '']);
assert.strictEqual(get('errada').ok, false);
assert.deepStrictEqual(get(SENHA).linhas.map(l => [l.linha, l.origem, l.status, l.codigo]), [[2, 'EXTREMA/MG', 'PUBLICAR', ''], [3, 'JACAREI/SP', 'Publicado', 'AB-1']]);
const conf = { origem: 'extrema/mg', destino: 'FRUTAL/MG' };
assert.deepStrictEqual(post({ token: SENHA, atualizacoes: [{ linha: 2, status: 'PUBLICANDO...', esperado: ['publicar'], confere: conf }] }).gravadas, [2]);
assert.strictEqual(post({ token: SENHA, atualizacoes: [{ linha: 2, status: 'PUBLICANDO...', esperado: ['publicar'], confere: conf }] }).ignoradas.length, 1, 'segunda reserva recusada');
assert.strictEqual(post({ token: SENHA, atualizacoes: [{ linha: 3, status: 'x', confere: conf }] }).ignoradas[0].motivo, 'a linha nao e mais a mesma');
assert.strictEqual(post({ token: 'errada', atualizacoes: [] }).ok, false);
assert.deepStrictEqual(post({ token: SENHA, atualizacoes: [{ linha: 2, status: 'Publicado', codigo: 'MGMG-27DE', esperado: ['publicando...'], confere: conf }] }).gravadas, [2]);
assert.deepStrictEqual([sheets.FRETES[1][12], sheets.FRETES[1][13]], ['Publicado', 'MGMG-27DE']);
assert.ok(sheets.FRETES[1][15] instanceof Date, 'grava a hora em que virou Publicado');

// ---- importador Base -> FRETES (mesma regra do Autoresponder)
const CAB = sheets.FRETES[0];
const lin = (st, cod, id) => ['SERRA/ES', 'VIANA/ES', 'PAPEL', 'A combinar', '20 Ton', '', 'Carreta', 'Sider', 'Sim', 'Não', 'Outro', '', st, cod, id];
sheets.FRETES = [CAB, lin('Publicado', 'ZZ-9', 'a9'), lin('PUBLICAR', '', 'a10'), lin('Publicado', 'ZZ-11', 'a11')];
const col = (r, k) => r[CAB.indexOf(k)];
const achar = id => sheets.FRETES.find((r, i) => i > 0 && col(r, 'IDCARGA') === id);
assert.deepStrictEqual(run('importarDaBase()'), { novas: 3, fechar: 1, cancelar: 1 });
assert.ok(achar('a7'), 'FINALIZADO entra como ativa (o Autoresponder so usa FINALIZADO no arquivamento, nao na regra de ativa)');
assert.ok(sheets.Log && sheets.Log[0].join() === 'Quando,Origem,Mensagem', 'aba Log criada com cabecalho');
assert.ok(sheets.Log.some(r => r[1] === 'Planilha' && /3 nova/.test(r[2])), 'aba Log registra a importacao: ' + JSON.stringify(sheets.Log));
assert.ok(sheets.Log.some(r => r[1] === 'Bot' && /gravou 1: L2=Publicado MGMG-27DE/.test(r[2])), 'aba Log registra o que o bot gravou');
assert.strictEqual(col(achar('a11'), 'STATUS'), 'Publicado', 'Mot CANCELADO sem motorista nao fecha (so FECHADO ou motorista preenchido)');
const a1 = achar('a1');
assert.deepStrictEqual(CAB.map(k => col(a1, k)), ['EXTREMA/MG', 'FRUTAL/MG', 'EMBALAGEM', 'A combinar', '25 Ton', '28 PAL', 'Carreta LS + Vanderléia + Carreta', 'Baú + Sider', 'Sim', 'Não', 'Outro', 'NECESSARIO 6 CINTAS', 'REVISAR', '', 'a1', '']);
assert.deepStrictEqual(['PESO', 'PALETES', 'VEÍCULO', 'CARROCERIA', 'RASTREADA'].map(k => col(achar('a8'), k)), ['14 Ton', '', 'Truck', 'Bug Porta Container', 'Não']);
assert.strictEqual(col(achar('a9'), 'STATUS'), 'FECHAR', 'publicada e a carga fechou (EM PROCESSO): fechar');
assert.strictEqual(col(achar('a10'), 'STATUS'), 'Encerrada antes de publicar', 'nao publica carga que fechou antes');
assert.strictEqual(col(achar('a11'), 'STATUS'), 'Publicado', 'Mot CANCELADO nao fecha (so FECHADO), carga continua ativa');
assert.ok(!sheets.FRETES.flat().some(v => /SECRETO|CPF|000\.000/.test(String(v))), 'nao copia cliente nem dados do motorista');
const antes = JSON.stringify(sheets.FRETES);
assert.deepStrictEqual(run('importarDaBase()'), { novas: 0, fechar: 0, cancelar: 0 }, 'idempotente');
assert.strictEqual(JSON.stringify(sheets.FRETES), antes);
run('ligarPublicacaoAutomatica()');
sheets.Base.push(['a12', 'ATIVA', 'TERCEIRO', new Date(agora + dia), 'PAPEL', 'SIM', 'CAVALO TOCO', 'SIDER', '', 'SERRA', 'ES', 'VIANA', 'ES', 20000, '', 'CARGA EM ABERTO', '']);
assert.strictEqual(run('importarDaBase()').novas, 1);
assert.strictEqual(col(achar('a12'), 'STATUS'), 'PUBLICAR');
// republicarAbertas: carga ainda aberta que ja foi publicada volta como REPUBLICAR, sem o codigo antigo
assert.strictEqual(col(achar('a11'), 'STATUS'), 'Publicado');
const rep = run('republicarAbertas()');
assert.strictEqual(rep.marcadas, 1);
assert.deepStrictEqual([col(achar('a11'), 'STATUS'), col(achar('a11'), 'CÓDIGO')], ['REPUBLICAR', ''], 'a11 segue aberta: republicar');
assert.strictEqual(col(achar('a12'), 'STATUS'), 'PUBLICAR', 'o que ainda nao foi publicado nao muda');
assert.strictEqual(col(achar('a9'), 'STATUS'), 'FECHAR', 'carga que fechou nao volta');
// renovarAbertas: so renova o que esta aberto E publicado ha mais de FR_RENOVAR_HORAS; erro volta a tentar; fechadas nao voltam
const horas = h => new Date(Date.now() - h * 3600e3);
const PE = CAB.indexOf('PUBLICADO EM');
const marca = (id, st, cod, quando) => { const r = achar(id); r[CAB.indexOf('STATUS')] = st; r[CAB.indexOf('CÓDIGO')] = cod; r[PE] = quando; };
marca('a12', 'Publicado', 'Z-12', horas(2));   // aberta, publicada ha 2 h  -> RENOVAR
marca('a1', 'Publicado', 'Z-1', new Date());   // aberta, publicada agora   -> nao mexe
marca('a8', 'Publicado', 'Z-8', '');           // aberta, sem hora          -> comeca a contar
marca('a11', 'ERRO: ORIGEM deve ser CIDADE/UF', '', '');  // aberta com erro -> tenta de novo
marca('a9', 'Publicado', 'Z-9', horas(5));     // a9 fechou (EM PROCESSO)   -> nao renova (o importador marca FECHAR)
const ren = run('renovarAbertas()');
assert.deepStrictEqual([ren.renovar, ren.tentar, ren.comecou], [1, 1, 1]);
assert.deepStrictEqual([col(achar('a12'), 'STATUS'), col(achar('a1'), 'STATUS'), col(achar('a8'), 'STATUS'), col(achar('a11'), 'STATUS')], ['RENOVAR', 'Publicado', 'Publicado', 'REPUBLICAR']);
assert.ok(achar('a8')[PE] instanceof Date, 'a8 comecou a contar agora');
assert.strictEqual(col(achar('a9'), 'STATUS'), 'FECHAR', 'carga fechada: o importador marca FECHAR, nao renova');
run('ativarRenovacaoAutomatica()'); run('ativarRenovacaoAutomatica()');
assert.deepStrictEqual(triggers.map(t => t.getHandlerFunction()), ['renovarAbertas']);
run('desativarRenovacaoAutomatica()');
assert.strictEqual(triggers.length, 0);
// prepararTudo deixa a publicacao automatica DESLIGADA e nao troca a senha
sheets.Base.push(['a13', 'ATIVA', 'TERCEIRO', new Date(agora + dia), 'PAPEL', 'SIM', 'CAVALO TOCO', 'SIDER', '', 'SERRA', 'ES', 'VIANA', 'ES', 20000, '', 'CARGA EM ABERTO', '']);
run('prepararTudo()');
assert.strictEqual(props.FR_AUTO, 'nao'); assert.strictEqual(props.SENHA, SENHA);
assert.strictEqual(col(achar('a13'), 'STATUS'), 'REVISAR');
assert.ok(logs.some(l => /ENDERECO: copie em Implantar/.test(l)));
// Base e Mot em OUTRA planilha (FR_ID_BASE): a FRETES fica numa planilha so com ela
storeBase.Base = sheets.Base; storeBase.Mot = sheets.Mot; delete sheets.Base; delete sheets.Mot;
sheets.FRETES = [CAB];
carregar(fonte.replace('COLE_AQUI_O_ID_DA_PLANILHA', 'ID_TESTE'));
assert.throws(() => run('importarDaBase()'), /Base vazia ou inexistente/); // sem FR_ID_BASE procura na mesma planilha
carregar(fonte.replace('COLE_AQUI_O_ID_DA_PLANILHA', 'ID_TESTE').replace("const FR_ID_BASE = '';", "const FR_ID_BASE = 'ID_BASE';"));
run('testarAcesso()'); assert.ok(logs.some(l => /Aba Base encontrada/.test(l)));
assert.strictEqual(run('importarDaBase()').novas, 6, 'le a Base da outra planilha e escreve a FRETES na nova');
assert.deepStrictEqual(sheets.FRETES.slice(1).map(r => r[CAB.indexOf('IDCARGA')]).sort(), ['a1', 'a11', 'a12', 'a13', 'a7', 'a8']);
assert.strictEqual(storeBase.Base.length, 14, 'a planilha da Base nao e alterada');
sheets.Base = storeBase.Base; sheets.Mot = storeBase.Mot; // volta ao cenario de uma planilha so
carregar(fonte.replace('COLE_AQUI_O_ID_DA_PLANILHA', 'ID_TESTE'));
// Base vazia nao fecha nada
sheets.Base = [sheets.Base[0]];
assert.throws(() => run('importarDaBase()'), /Base vazia/);
assert.ok(sheets.FRETES.some(r => r[CAB.indexOf('IDCARGA')] === 'a11'), 'nada foi apagado');
// gatilho: liga e desliga sem duplicar
run('ativarImportacaoAutomatica()'); run('ativarImportacaoAutomatica()');
assert.strictEqual(triggers.length, 1);
run('desativarImportacaoAutomatica()');
assert.strictEqual(triggers.length, 0);

// regra sua (nao existe no Autoresponder): carga com motorista na Mot fecha mesmo sem Situacao=FECHADO (cenario isolado, do zero)
sheets.FRETES = [CAB, lin('Publicado', 'ZZ-14', 'a14')];
sheets.Base = [sheets.Base[0], ['a14', 'ATIVA', 'TERCEIRO', new Date(agora + dia), 'PAPEL', 'SIM', 'CAVALO TOCO', 'SIDER', '', 'SERRA', 'ES', 'VIANA', 'ES', 20000, '', 'CARGA EM ABERTO', '']];
sheets.Mot = [sheets.Mot[0], ['a14', 'z', 'EM ROTA', '111.111.111-11']];
assert.deepStrictEqual(run('importarDaBase()'), { novas: 0, fechar: 1, cancelar: 0 });
assert.strictEqual(col(achar('a14'), 'STATUS'), 'FECHAR', 'tem motorista na Mot, mesmo Situacao nao sendo FECHADO: fecha');

// doPost com "acao": o painel do bot chama as funcoes da planilha de longe, sem abrir o Apps Script
const r1 = post({ token: SENHA, acao: 'importarDaBase' });
assert.deepStrictEqual(r1, { ok: true, resultado: { novas: 0, fechar: 0, cancelar: 0 } });
assert.deepStrictEqual(post({ token: SENHA, acao: 'inventada' }), { ok: false, erro: 'acao desconhecida: inventada' });
assert.deepStrictEqual(post({ token: 'errada', acao: 'importarDaBase' }), { ok: false, erro: 'senha invalida' });
assert.ok(sheets.Log.some(r => r[1] === 'Bot' && /^importarDaBase:/.test(r[2])), 'acao remota tambem registra na aba Log');

console.log('OK: projeto unico (aplicativo da web + importador Base -> FRETES, sem planilha ativa e sem janelas)');
