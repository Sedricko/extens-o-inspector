/**
 * Master SPA - configura a aba FRETES do Google Sheets.
 * Como usar: na planilha, Extensoes > Apps Script > cole este codigo > Salvar > recarregue a planilha.
 * Rode uma vez "instalarMenuFretes": aparece o menu "Fretes" (nao usa onOpen, para nao brigar com o seu script).
 * Nao mexe em outras abas. Se a aba FRETES ja tiver dados, so acrescenta (nunca apaga nem sobrescreve).
 */
const FR_ABA = 'FRETES';
const FR_COLUNAS = ['ORIGEM', 'DESTINO', 'PRODUTO', 'VALOR', 'PESO', 'PALETES', 'VEÍCULO', 'CARROCERIA', 'RASTREADA', 'LONA', 'PAGAMENTO', 'OBSERVAÇÕES', 'STATUS', 'CÓDIGO', 'IDCARGA'];
const FR_LINHAS_ATE = 500;

const FR_VEICULOS = ['Carreta', 'Carreta LS', 'Truck', 'Bitruck', 'Vanderléia', 'Bitrem', 'Rodotrem', 'Bitrenzão', 'Toco', '3/4', 'Van', 'VUC'];
const FR_CARROCERIAS = ['Sider', 'Baú', 'Baú Frigorífico', 'Baú Refrigerado', 'Graneleiro', 'Grade Baixa', 'Caçamba', 'Plataforma', 'Prancha',
  'Apenas Cavalo', 'Bug Porta Container', 'Cavaqueira', 'Cegonheiro', 'Gaiola', 'Hopper', 'Munck', 'Silo', 'Tanque'];
const FR_PAGAMENTOS = ['Outro', 'Pix', 'TED', 'Crédito em cartão', 'Cheque', 'E-frete'];

// Nao usa onOpen (o seu script ja tem um): rode UMA vez "instalarMenuFretes" e o menu aparece sempre que abrir a planilha.
function instalarMenuFretes() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'criarMenuFretes').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('criarMenuFretes').forSpreadsheet(SpreadsheetApp.getActive()).onOpen().create();
  criarMenuFretes();
}

function criarMenuFretes() {
  SpreadsheetApp.getUi().createMenu('Fretes')
    .addItem('Configurar aba FRETES', 'configurarAbaFretes')
    .addItem('Importar cargas da Base agora', 'importarDaBase')
    .addSeparator()
    .addItem('Ligar importacao automatica (a cada 10 min)', 'ativarImportacaoAutomatica')
    .addItem('Desligar importacao automatica', 'desativarImportacaoAutomatica')
    .addItem('Publicar sozinho o que for importado: LIGAR', 'ligarPublicacaoAutomatica')
    .addItem('Publicar sozinho o que for importado: DESLIGAR', 'desligarPublicacaoAutomatica')
    .addSeparator()
    .addItem('Gerar 10 exemplos', 'gerarExemplos10')
    .addToUi();
}

function configurarAbaFretes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const aba = ss.getSheetByName(FR_ABA) || ss.insertSheet(FR_ABA);

  aba.getRange(1, 1, 1, FR_COLUNAS.length).setValues([FR_COLUNAS]).setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
  aba.setFrozenRows(1);
  aba.setColumnWidths(1, 2, 170);          // ORIGEM, DESTINO
  aba.setColumnWidth(3, 230);              // PRODUTO
  aba.setColumnWidths(4, 3, 100);          // VALOR, PESO, PALETES
  aba.setColumnWidths(7, 2, 130);          // VEICULO, CARROCERIA
  aba.setColumnWidths(9, 2, 90);           // RASTREADA, LONA
  aba.setColumnWidths(11, 2, 170);         // PAGAMENTO, OBSERVACOES
  aba.setColumnWidths(13, 2, 150);         // STATUS, CODIGO (a extensao devolve aqui o que publicou)

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
  lista(7, FR_VEICULOS, false);               // pode juntar com +, por isso aceita outro texto
  lista(8, FR_CARROCERIAS, false);
  lista(9, ['Sim', 'Não'], true);
  lista(10, ['Não'], true);                // LONA: so "Não" e suportado por enquanto
  lista(11, FR_PAGAMENTOS, false);            // pode juntar: Pix + Outro

  // Controle contra duplicar: publicado fica verde; linhas iguais ficam laranja
  const todas = aba.getRange(2, 1, n, FR_COLUNAS.length);
  aba.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=OR($N2<>"";LEFT($M2;8)="Publicad")').setBackground('#dcfce7').setRanges([todas]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($A2<>"";COUNTIFS($A$2:$A;$A2;$B$2:$B;$B2;$C$2:$C;$C2;$E$2:$E;$E2;$G$2:$G;$G2;$H$2:$H;$H2;$K$2:$K;$K2)>1)').setBackground('#fed7aa').setRanges([todas]).build(),
  ]);

  SpreadsheetApp.getUi().alert('Aba FRETES pronta. Preencha uma linha por frete.\n\nPara publicar: selecione as linhas (com o cabecalho e as colunas STATUS e CODIGO), copie e cole na pagina "Publicar lote" da extensao.');
}

function gerarExemplos10() {
  const aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FR_ABA);
  if (!aba) return SpreadsheetApp.getUi().alert('Rode antes "Configurar aba FRETES".');
  const t = 'TESTE - EXCLUIR';
  //            ORIGEM            DESTINO              PRODUTO VALOR         PESO       PAL      VEICULO    CARROC.  RASTR. LONA   PAGAMENTO       OBS
  const ex = [
    ['EXTREMA/MG',   'FRUTAL/MG',        t, 'A combinar', '25 Ton', '28 PAL', 'Carreta', 'Sider', 'Sim', 'Não', 'Outro',        t, '', '', ''],
    ['EXTREMA/MG',   'ITABIRITO/MG',     t, 'A combinar', '24 Ton', '26 PAL', 'Carreta', 'Sider', 'Sim', 'Não', 'Outro', t, '', '', ''],
    ['EXTREMA/MG',   'BRASILIA/DF',      t, 'A combinar', '25 Ton', '28 PAL', 'Carreta', 'Sider', 'Sim', 'Não', 'Outro', t, '', '', ''],
    ['JACAREI/SP',   'ATIBAIA/SP',       t, 'A combinar', '22 Ton', '24 PAL', 'Carreta', 'Sider', 'Sim', 'Não', 'Outro', t, '', '', ''],
    ['JAGUARIUNA/SP', 'CAMPO GRANDE/MS', t, 'A combinar', '25 Ton', '28 PAL', 'Carreta', 'Sider', 'Sim', 'Não', 'Outro', t, '', '', ''],
    ['EXTREMA/MG',   'SERRA/ES',         t, 'A combinar', '26 Ton', '29 PAL', 'Carreta', 'Sider', 'Sim', 'Não', 'Outro', t, '', '', ''],
    ['ATIBAIA/SP',   'VIANA/ES',         t, 'A combinar', '25 Ton', '28 PAL', 'Carreta', 'Baú',   'Sim', 'Não', 'Outro', t, '', '', ''],
    ['JACAREI/SP',   'FRUTAL/MG',        t, 'A combinar', '14 Ton', '16 PAL', 'Truck',   'Baú',   'Sim', 'Não', 'Outro', t, '', '', ''],
    ['ITABERA/SP',   'EXTREMA/MG',       t, 'A combinar', '25 Ton', '28 PAL', 'Carreta', 'Sider', 'Não', 'Não', 'Outro', t, '', '', ''],
    ['EXTREMA/MG',   'JACAREI/SP',       t, 'A combinar', '25 Ton', '28 PAL', 'Carreta', 'Sider', 'Sim', 'Não', 'Pix + Outro', t, '', '', ''],
  ];
  const linha = Math.max(aba.getLastRow(), 1) + 1; // sempre abaixo do que ja existe
  aba.getRange(linha, 1, ex.length, FR_COLUNAS.length).setValues(ex);
  SpreadsheetApp.getUi().alert('10 exemplos adicionados nas linhas ' + linha + ' a ' + (linha + 9) + '.\nO produto e "TESTE - EXCLUIR": se publicar, exclua depois em Meus Fretes.');
}

// UM CLIQUE no projeto da planilha: instala o menu, prepara a aba FRETES e importa as cargas ativas da Base.
// Nada e publicado: as cargas entram como REVISAR. Importacao automatica e "publicar sozinho" ficam DESLIGADOS (ligue no menu Fretes depois dos testes).
function configurarTudo() {
  instalarMenuFretes();
  configurarAbaFretes();
  PropertiesService.getScriptProperties().setProperty('FR_AUTO', 'nao');
  importarDaBase();
}
