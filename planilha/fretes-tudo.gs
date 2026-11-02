/**
 * Master SPA - TUDO num projeto so (projeto solto, sem ligar a planilha): aplicativo da web da extensao + importador Base -> FRETES.
 * Nao usa menu nem janelas: rode as funcoes pelo editor (lista ao lado de "Depuracao"); os resultados saem no Registro de execucao.
 *
 * Como usar:
 *  1) Troque FR_ID pelo ID da planilha (o trecho entre /d/ e /edit no endereco dela).
 *     Se a Base e a Mot ficam em OUTRA planilha, coloque o ID dela em FR_ID_BASE (em branco = a mesma planilha).
 *  2) Rode "prepararTudo" (aceite as permissoes): confere o acesso, prepara a aba FRETES, gera a senha e importa as cargas ativas.
 *  3) Implantar > Nova implantacao > App da Web > Executar como: Eu > Qualquer pessoa. Depois de mudar o codigo:
 *     Implantar > Gerenciar implantacoes > lapis > Nova versao (o endereco continua o mesmo).
 *  4) Cole na extensao o endereco do bloco "App da Web" (termina em /exec) e a senha.
 *
 * Funcoes: prepararTudo, importarDaBase, ativarImportacaoAutomatica / desativarImportacaoAutomatica (a cada 10 min),
 *          ativarImportacaoInstantanea / desativarImportacaoInstantanea (importa na hora quando voce edita a aba Base),
 *          ligarPublicacaoAutomatica / desligarPublicacaoAutomatica (cargas importadas entram como PUBLICAR ou REVISAR),
 *          republicarAbertas (as cargas ainda abertas que ja tinham sido publicadas voltam como REPUBLICAR, sem o codigo antigo),
 *          renovarAbertas (cargas abertas ha mais de FR_RENOVAR_HORAS viram RENOVAR) e ativar/desativarRenovacaoAutomatica,
 *          mostrarSenha, gerarSenha (troca a senha), configurarAbaFretes, testarAcesso.
 *
 * Aba "Log" (criada sozinha na primeira vez): registra, com hora, o que a importacao fez e o que o bot leu/gravou.
 * Serve para conferir se a planilha e o bot estao se comunicando.
 *
 * Regra de carga ativa (a mesma do Autoresponder): StatusOferta ATIVA, Operacao diferente de so FROTA, nao cancelada,
 * nao fechada (aba Mot com Situacao FECHADO, OU com motorista ja atribuido ali - essa segunda parte nao existe no
 * Autoresponder, e so para nao manter publicada uma carga que ja tem motorista) e coleta nao vencida (24 h).
 * Da aba Mot so le idCarga e Situacao. A extensao so enxerga a aba FRETES.
 */
const FR_ID = '1g4CWwRdXN1GQBPbPZ-bMMvm__w-qcwyDnqLrrGZ3cFQ';   // planilha onde fica a aba FRETES (a que a extensao le e escreve)
const FR_ID_BASE = '';                        // planilha onde ficam as abas Base e Mot; vazio = a mesma do FR_ID
const FR_ABA = 'FRETES';
const FR_COLUNAS = ['ORIGEM', 'DESTINO', 'PRODUTO', 'VALOR', 'PESO', 'PALETES', 'VEÍCULO', 'CARROCERIA', 'RASTREADA', 'LONA', 'PAGAMENTO', 'OBSERVAÇÕES', 'STATUS', 'CÓDIGO', 'IDCARGA', 'PUBLICADO EM'];
const FR_LINHAS_ATE = 500;
const FR_RENOVAR_HORAS = 1; // de quantas em quantas horas as cargas ABERTAS sao renovadas (1, 2, 4, 6, 8 ou 12)
const FR_IMP = { BASE: 'Base', MOT: 'Mot', MAX_NOVAS: 50, VENCE_HORAS: 24 }; // MAX_NOVAS: cargas novas por rodada (10 em 10 min)

const frNorm_ = t => String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const frChaveCol_ = h => frNorm_(h).replace(/[^a-z]/g, '');
const frJson_ = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);

function frPlanilha_() {
  if (FR_ID.indexOf('COLE_AQUI') === 0) throw new Error('troque FR_ID pelo ID da planilha');
  return SpreadsheetApp.openById(FR_ID);
}
// Planilha de onde se le a Base e a Mot (a mesma da FRETES, a menos que FR_ID_BASE esteja preenchido).
function frPlanilhaBase_() {
  return FR_ID_BASE ? SpreadsheetApp.openById(FR_ID_BASE) : frPlanilha_();
}
function frAba_() {
  const aba = frPlanilha_().getSheetByName(FR_ABA);
  if (!aba) throw new Error('a planilha nao tem a aba ' + FR_ABA + ' (rode prepararTudo)');
  return aba;
}

// Aba "Log": registro do que aconteceu, dos dois lados (importacao da Base e o que o bot leu/gravou), com hora.
// Mantem so as ultimas FR_LOG_MAX linhas; nao trava a funcao principal se der erro (log e so para conferencia).
const FR_LOG_MAX = 500;
function frLog_(origem, msg) {
  try {
    const ss = frPlanilha_();
    let aba = ss.getSheetByName('Log');
    if (!aba) { aba = ss.insertSheet('Log'); aba.getRange(1, 1, 1, 3).setValues([['Quando', 'Origem', 'Mensagem']]); }
    aba.getRange(aba.getLastRow() + 1, 1, 1, 3).setValues([[new Date(), origem, String(msg).slice(0, 500)]]);
    const sobra = aba.getLastRow() - FR_LOG_MAX;
    if (sobra > 0) aba.deleteRows(2, sobra);
  } catch (e) { Logger.log('Nao consegui gravar na aba Log: %s', e); }
}

// ===================== Preparacao =====================
function testarAcesso() {
  Logger.log('Aba %s encontrada: %s linha(s) com dados.', FR_ABA, frAba_().getLastRow());
  const base = frPlanilhaBase_().getSheetByName(FR_IMP.BASE);
  Logger.log(base ? 'Aba %s encontrada: %s linha(s).' : 'ATENCAO: a aba %s nao existe na planilha da Base.', FR_IMP.BASE, base ? base.getLastRow() : '');
}

function configurarAbaFretes() {
  const ss = frPlanilha_();
  const aba = ss.getSheetByName(FR_ABA) || ss.insertSheet(FR_ABA);
  aba.getRange(1, 1, 1, FR_COLUNAS.length).setValues([FR_COLUNAS]).setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
  aba.setFrozenRows(1);
  aba.setColumnWidths(1, 2, 170);
  aba.setColumnWidth(3, 230);
  aba.setColumnWidths(4, 3, 100);
  aba.setColumnWidths(7, 2, 130);
  aba.setColumnWidths(9, 2, 90);
  aba.setColumnWidths(11, 2, 170);
  aba.setColumnWidths(13, 4, 150);

  const n = FR_LINHAS_ATE - 1;
  const lista = (col, itens, estrito) => aba.getRange(2, col, n, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(itens, true).setAllowInvalid(!estrito).build());
  const formula = (col, f, msg) => aba.getRange(2, col, n, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireFormulaSatisfied(f).setAllowInvalid(true).setHelpText(msg).build());
  formula(1, '=OR(A2="";REGEXMATCH(A2;"^.+/[A-Za-z]{2}$"))', 'Use CIDADE/UF, por exemplo EXTREMA/MG');
  formula(2, '=OR(B2="";REGEXMATCH(B2;"^.+/[A-Za-z]{2}$"))', 'Use CIDADE/UF, por exemplo FRUTAL/MG');
  formula(3, '=LEN(C2)<=30', 'O site aceita no maximo 30 caracteres e nao aceita o caractere |');
  lista(4, ['A combinar'], true);
  formula(5, '=OR(E2="";REGEXMATCH(E2&"";"^\\s*\\d+([.,]\\d+)?"))', 'Peso em toneladas, de 1 a 50. Ex.: 25 Ton');
  lista(9, ['Sim', 'Não'], true);
  lista(10, ['Não'], true);
  // VEICULO, CARROCERIA e PAGAMENTO ficam sem lista: o importador escreve combinacoes ("Bau + Sider") e a lista as marcaria como invalidas
  aba.getRange(2, 7, n, 2).clearDataValidations();
  aba.getRange(2, 11, n, 1).clearDataValidations();
  const todas = aba.getRange(2, 1, n, FR_COLUNAS.length);
  aba.getRange(2, 16, n, 1).setNumberFormat('dd/MM/yyyy HH:mm');
  aba.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=OR($N2<>"";LEFT($M2;8)="Publicad")').setBackground('#dcfce7').setRanges([todas]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($A2<>"";COUNTIFS($A$2:$A;$A2;$B$2:$B;$B2;$C$2:$C;$C2;$E$2:$E;$E2;$G$2:$G;$G2;$H$2:$H;$H2;$K$2:$K;$K2)>1)').setBackground('#fed7aa').setRanges([todas]).build(),
  ]);
  Logger.log('Aba %s pronta (colunas, avisos e cores).', FR_ABA);
}

// Um clique: confere o acesso, prepara a aba, deixa a publicacao automatica DESLIGADA, garante a senha e importa as cargas (entram como REVISAR).
function prepararTudo() {
  testarAcesso();
  configurarAbaFretes();
  PropertiesService.getScriptProperties().setProperty('FR_AUTO', 'nao');
  mostrarSenha();
  Logger.log('Importacao: %s', JSON.stringify(importarDaBase()));
  Logger.log('ENDERECO: copie em Implantar > Gerenciar implantacoes, no bloco "App da Web" (botao Copiar). Nao use o do bloco "Biblioteca".');
}

// ===================== Senha da integracao =====================
// Mostra a senha atual; cria uma se ainda nao existir. gerarSenha troca por uma nova (a antiga para de valer).
function mostrarSenha() {
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty('SENHA')) return gerarSenha();
  Logger.log('SENHA DA INTEGRACAO (cole na extensao): %s', p.getProperty('SENHA'));
}
function gerarSenha() {
  const senha = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('SENHA', senha);
  Logger.log('SENHA DA INTEGRACAO (cole na extensao): %s', senha);
}
function frSenha_(s) {
  const certa = PropertiesService.getScriptProperties().getProperty('SENHA');
  if (!certa || String(s) !== certa) throw new Error('senha invalida');
}

// ===================== Aplicativo da web (a extensao chama) =====================
function doGet(e) {
  try {
    frSenha_(e.parameter.token);
    const vals = frAba_().getDataRange().getValues();
    const cab = vals[0].map(frChaveCol_);
    const linhas = vals.slice(1).map((r, i) => {
      const o = { linha: i + 2 };
      cab.forEach((k, j) => { if (k) o[k] = r[j] === '' || r[j] == null ? '' : String(r[j]); });
      return o;
    }).filter(o => o.origem || o.status);
    return frJson_({ ok: true, linhas });
  } catch (err) { return frJson_({ ok: false, erro: String(err.message || err) }); }
}

// atualizacoes: [{ linha, status, codigo?, esperado?: [status atuais aceitos], confere?: { origem, destino } }]
// So grava se o STATUS atual e um dos esperados e a origem/destino da linha conferem (a planilha pode ter sido reordenada).
// Acoes que o painel do bot pode chamar remotamente (controlar tudo sem abrir o Apps Script).
const FR_ACOES = {
  importarDaBase, republicarAbertas, renovarAbertas,
  ativarImportacaoAutomatica, desativarImportacaoAutomatica,
  ativarImportacaoInstantanea, desativarImportacaoInstantanea,
  ligarPublicacaoAutomatica, desligarPublicacaoAutomatica,
  ativarRenovacaoAutomatica, desativarRenovacaoAutomatica,
};

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const corpo = JSON.parse(e.postData.contents);
    frSenha_(corpo.token);
    if (corpo.acao) {
      // sem lock aqui: importarDaBase (e quem a chama) ja protege a propria escrita com o lock dela;
      // pegar o lock aqui tambem e liberar so no fim do doPost causaria um lock aninhado que a funcao
      // chamada libera cedo demais (o lock do Apps Script e por execucao, nao por chamada).
      const fn = FR_ACOES[corpo.acao];
      if (!fn) throw new Error('acao desconhecida: ' + corpo.acao);
      const resultado = fn() || {};
      frLog_('Bot', `${corpo.acao}: ${JSON.stringify(resultado)}`);
      return frJson_({ ok: true, resultado });
    }
    lock.waitLock(20000);
    const aba = frAba_();
    const cab = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0].map(frChaveCol_);
    const col = k => cab.indexOf(k) + 1;
    ['status', 'codigo', 'origem', 'destino'].forEach(k => { if (!col(k)) throw new Error('falta a coluna ' + k.toUpperCase()); });
    const gravadas = [], ignoradas = [], detalhe = [];
    const colHora = col('publicadoem'); // quando virou "Publicado": a renovacao conta a partir daqui
    (corpo.atualizacoes || []).forEach(u => {
      const linha = Number(u.linha);
      if (!(linha >= 2 && linha <= aba.getLastRow())) return ignoradas.push({ linha: u.linha, motivo: 'linha fora da planilha' });
      const atual = frNorm_(aba.getRange(linha, col('status')).getValue());
      if (u.esperado && !u.esperado.map(frNorm_).includes(atual)) return ignoradas.push({ linha, motivo: 'STATUS mudou (' + atual + ')' });
      if (u.confere && (frNorm_(aba.getRange(linha, col('origem')).getValue()) !== frNorm_(u.confere.origem) ||
                        frNorm_(aba.getRange(linha, col('destino')).getValue()) !== frNorm_(u.confere.destino)))
        return ignoradas.push({ linha, motivo: 'a linha nao e mais a mesma' });
      aba.getRange(linha, col('status')).setValue(String(u.status));
      if (u.codigo !== undefined) aba.getRange(linha, col('codigo')).setValue(String(u.codigo));
      if (colHora && frNorm_(u.status) === 'publicado') aba.getRange(linha, colHora).setValue(new Date());
      gravadas.push(linha);
      detalhe.push(`L${linha}=${u.status}${u.codigo ? ' ' + u.codigo : ''}`);
    });
    if (detalhe.length) frLog_('Bot', `gravou ${detalhe.length}: ${detalhe.join(', ')}`);
    if (ignoradas.length) frLog_('Bot', `${ignoradas.length} ignorada(s): ${ignoradas.map(i => `L${i.linha} (${i.motivo})`).join(', ')}`);
    return frJson_({ ok: true, gravadas, ignoradas });
  } catch (err) {
    return frJson_({ ok: false, erro: String(err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

// ===================== Importador Base -> FRETES =====================
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
  // Carga "fechada" (sai das ativas): Situacao=FECHADO na Mot (regra do Autoresponder), OU ja tem motorista
  // (regra sua, nao existe no Autoresponder: carga com motorista nao fica mais disponivel para novo publico).
  const fechadas = new Set();
  const mot = ss.getSheetByName(FR_IMP.MOT);
  if (mot && mot.getLastRow() > 1) {
    const mv = mot.getDataRange().getValues(), mm = frCabecalho_(mv[0]);
    const iM = frCol_(mm, ['idcarga', 'id']), iS = frCol_(mm, ['situacao', 'status']), iMot = frCol_(mm, ['cpfmotorista', 'motorista']);
    if (iM >= 0) mv.slice(1).forEach(r => {
      const id = String(r[iM]).trim();
      if (!id) return;
      if (iS >= 0 && frNorm_(r[iS]) === 'fechado') fechadas.add(id);
      else if (iMot >= 0 && String(r[iMot]).trim()) fechadas.add(id);
    });
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
      fx !== 'em processo' && !fechadas.has(id) && !vencida;
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
  if (!lock.tryLock(5000)) return { ocupado: true };
  try {
    const fretes = frAba_();
    const cargas = frLerBase_(frPlanilhaBase_());
    if (!Object.keys(cargas).length) throw new Error('a aba Base nao tem cargas: nada foi alterado');

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
    Logger.log('%s nova(s), %s para fechar, %s encerrada(s) antes de publicar.', novas.length, fechar, cancelar);
    if (novas.length || fechar || cancelar) frLog_('Planilha', `importarDaBase: ${novas.length} nova(s), ${fechar} para fechar, ${cancelar} encerrada(s) antes de publicar`);
    return { novas: novas.length, fechar, cancelar };
  } finally {
    lock.releaseLock();
  }
}

// Marca REPUBLICAR as cargas que continuam ABERTAS na Base e ja tinham sido publicadas (por exemplo, voce apagou os fretes na Fretebras).
// Limpa o CODIGO antigo; a extensao publica de novo e grava o codigo novo. Em seguida traz as cargas novas da Base.
function republicarAbertas() {
  const fretes = frAba_();
  const cargas = frLerBase_(frPlanilhaBase_());
  const cab = fretes.getRange(1, 1, 1, fretes.getLastColumn()).getValues()[0];
  const m = frCabecalho_(cab);
  ['status', 'codigo', 'idcarga'].forEach(k => { if (m[k] === undefined) throw new Error('falta a coluna ' + k.toUpperCase() + ' na aba FRETES (rode configurarAbaFretes)'); });
  const dados = fretes.getLastRow() > 1 ? fretes.getRange(2, 1, fretes.getLastRow() - 1, cab.length).getValues() : [];
  const JA_PUBLICADAS = ['publicado', 'desativado', 'excluido', 'nao encontrado', 'fechar', 'desativar', 'excluir'];
  let marcadas = 0;
  dados.forEach((r, i) => {
    const id = String(r[m.idcarga] || '').trim(), c = cargas[id], st = frNorm_(r[m.status]);
    if (!c || !c.ativa) return;                                   // carga que fechou nao volta
    if (!JA_PUBLICADAS.includes(st) && st.indexOf('erro') !== 0) return;
    fretes.getRange(i + 2, m.status + 1).setValue('REPUBLICAR');
    fretes.getRange(i + 2, m.codigo + 1).setValue('');
    marcadas++;
  });
  const novas = importarDaBase();
  Logger.log('%s carga(s) aberta(s) marcada(s) para REPUBLICAR; importacao: %s', marcadas, JSON.stringify(novas));
  if (marcadas) frLog_('Planilha', `republicarAbertas: ${marcadas} carga(s) marcada(s) para REPUBLICAR`);
  return { marcadas, importacao: novas };
}

// Renovacao das cargas ABERTAS: a cada FR_RENOVAR_HORAS, o frete publicado ha mais tempo que isso vira RENOVAR (a extensao fecha o antigo
// e publica de novo). Carga que fechou nao e renovada: o importador a marca FECHAR. Linha com ERRO volta como REPUBLICAR.
function renovarAbertas() {
  const fretes = frAba_();
  const cargas = frLerBase_(frPlanilhaBase_());
  const cab = fretes.getRange(1, 1, 1, fretes.getLastColumn()).getValues()[0];
  const m = frCabecalho_(cab);
  ['status', 'codigo', 'idcarga', 'publicadoem'].forEach(k => { if (m[k] === undefined) throw new Error('falta a coluna ' + k.toUpperCase() + ' na aba FRETES (rode configurarAbaFretes)'); });
  const dados = fretes.getLastRow() > 1 ? fretes.getRange(2, 1, fretes.getLastRow() - 1, cab.length).getValues() : [];
  const limite = Date.now() - (FR_RENOVAR_HORAS * 60 - 10) * 60e3; // 10 min de folga: o gatilho nao roda no segundo exato
  let renovar = 0, tentar = 0, comecou = 0;
  dados.forEach((r, i) => {
    const id = String(r[m.idcarga] || '').trim(), c = cargas[id], st = frNorm_(r[m.status]), linha = i + 2;
    if (!c || !c.ativa) return;
    if (st === 'publicado' && String(r[m.codigo]).trim()) {
      const t = r[m.publicadoem], ts = t instanceof Date ? t.getTime() : t ? new Date(t).getTime() : NaN;
      if (isNaN(ts)) { fretes.getRange(linha, m.publicadoem + 1).setValue(new Date()); comecou++; return; } // sem hora: comeca a contar agora
      if (ts <= limite) { fretes.getRange(linha, m.status + 1).setValue('RENOVAR'); renovar++; }
    } else if (st.indexOf('erro') === 0) {
      fretes.getRange(linha, m.status + 1).setValue('REPUBLICAR'); fretes.getRange(linha, m.codigo + 1).setValue(''); tentar++;
    }
  });
  const imp = importarDaBase(); // traz as cargas novas e marca FECHAR as que encerraram
  Logger.log('%s para RENOVAR, %s com erro para tentar de novo, %s comecaram a contar; importacao: %s', renovar, tentar, comecou, JSON.stringify(imp));
  if (renovar || tentar) frLog_('Planilha', `renovarAbertas: ${renovar} para RENOVAR, ${tentar} com erro para tentar de novo, ${comecou} comecaram a contar`);
  return { renovar, tentar, comecou, importacao: imp };
}
function ativarRenovacaoAutomatica() {
  desativarRenovacaoAutomatica();
  ScriptApp.newTrigger('renovarAbertas').timeBased().everyHours(FR_RENOVAR_HORAS).create();
  Logger.log('Renovacao automatica ligada: a cada %s hora(s).', FR_RENOVAR_HORAS);
}
function desativarRenovacaoAutomatica() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'renovarAbertas').forEach(t => ScriptApp.deleteTrigger(t));
}

function ligarPublicacaoAutomatica() { PropertiesService.getScriptProperties().setProperty('FR_AUTO', 'sim'); Logger.log('Cargas importadas entram como PUBLICAR: a extensao publica sozinha.'); }
function desligarPublicacaoAutomatica() { PropertiesService.getScriptProperties().setProperty('FR_AUTO', 'nao'); Logger.log('Cargas importadas entram como REVISAR: nada e publicado ate voce trocar o STATUS para PUBLICAR.'); }
function ativarImportacaoAutomatica() {
  desativarImportacaoAutomatica();
  ScriptApp.newTrigger('importarDaBase').timeBased().everyMinutes(10).create();
  Logger.log('Importacao automatica ligada: a cada 10 minutos.');
}
function desativarImportacaoAutomatica() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'importarDaBase').forEach(t => ScriptApp.deleteTrigger(t));
}

// Importa na hora quando voce edita a aba Base (alem do gatilho de 10 em 10 min, que fica de reforco).
// So sente edicao feita por uma pessoa na tela; se a Base for preenchida por outro script/API, isso nao dispara.
function frAoEditar(e) {
  if (!e || !e.range || e.range.getSheet().getName() !== 'Base') return;
  const prop = PropertiesService.getScriptProperties();
  const agora = Date.now(), ultimo = Number(prop.getProperty('FR_ULTIMA_IMPORT_INSTANTANEA') || 0);
  if (agora - ultimo < 15000) return; // colar varias linhas de uma vez dispara varios eventos: so roda 1x a cada 15s
  prop.setProperty('FR_ULTIMA_IMPORT_INSTANTANEA', String(agora));
  importarDaBase();
}
function ativarImportacaoInstantanea() {
  desativarImportacaoInstantanea();
  ScriptApp.newTrigger('frAoEditar').forSpreadsheet(frPlanilhaBase_()).onEdit().create();
  Logger.log('Pronto: editar a aba Base agora importa na hora, alem do gatilho de 10 em 10 min.');
}
function desativarImportacaoInstantanea() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'frAoEditar').forEach(t => ScriptApp.deleteTrigger(t));
}
