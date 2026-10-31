/**
 * Master SPA - API da planilha (aplicativo da web), em um projeto SEPARADO do da planilha.
 * Como usar (projeto novo em script.google.com/create):
 *  1) Cole este codigo e troque FRAPI_PLANILHA_ID pelo ID da planilha (o trecho entre /d/ e /edit no endereco dela).
 *  2) Rode "testarAcesso" e aceite as permissoes (Revisar permissoes). O Registro de execucao mostra quantas linhas a aba FRETES tem.
 *  3) Rode "gerarSenha": a senha aparece no Registro de execucao. Cole na extensao.
 *  4) Implantar > Nova implantacao > App da Web > Executar como: Eu > Quem pode acessar: Qualquer pessoa.
 *     Depois de mudar o codigo: Implantar > Gerenciar implantacoes > lapis > Nova versao (o endereco continua o mesmo).
 * A extensao so enxerga a aba FRETES. Nada deste projeto toca a aba Mot nem a Base.
 */
const FRAPI_PLANILHA_ID = 'COLE_AQUI_O_ID_DA_PLANILHA';
const FRAPI_ABA = 'FRETES';

const frApiNorm_ = t => String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const frApiChave_ = h => frApiNorm_(h).replace(/[^a-z]/g, '');
const frApiJson_ = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);

function frApiAba_() {
  if (FRAPI_PLANILHA_ID.indexOf('COLE_AQUI') === 0) throw new Error('troque FRAPI_PLANILHA_ID pelo ID da planilha');
  const aba = SpreadsheetApp.openById(FRAPI_PLANILHA_ID).getSheetByName(FRAPI_ABA);
  if (!aba) throw new Error('a planilha nao tem a aba ' + FRAPI_ABA);
  return aba;
}

function frApiSenha_(s) {
  const certa = PropertiesService.getScriptProperties().getProperty('SENHA');
  if (!certa || String(s) !== certa) throw new Error('senha invalida');
}

// Rode uma vez: autoriza o acesso a planilha e confirma que o ID esta certo.
function testarAcesso() {
  Logger.log('Aba %s encontrada: %s linha(s) com dados.', FRAPI_ABA, frApiAba_().getLastRow());
}

// Rode para gerar a senha (gerar de novo troca a senha: a antiga para de valer).
function gerarSenha() {
  const senha = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('SENHA', senha);
  Logger.log('SENHA DA INTEGRACAO (cole na extensao): %s', senha);
}

function doGet(e) {
  try {
    frApiSenha_(e.parameter.token);
    const vals = frApiAba_().getDataRange().getValues();
    const cab = vals[0].map(frApiChave_);
    const linhas = vals.slice(1).map((r, i) => {
      const o = { linha: i + 2 };
      cab.forEach((k, j) => { if (k) o[k] = r[j] === '' || r[j] == null ? '' : String(r[j]); });
      return o;
    }).filter(o => o.origem || o.status);
    return frApiJson_({ ok: true, linhas });
  } catch (err) { return frApiJson_({ ok: false, erro: String(err.message || err) }); }
}

// atualizacoes: [{ linha, status, codigo?, esperado?: [status atuais aceitos], confere?: { origem, destino } }]
// So grava se o STATUS atual e um dos esperados e a origem/destino da linha conferem (a planilha pode ter sido reordenada).
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const corpo = JSON.parse(e.postData.contents);
    frApiSenha_(corpo.token);
    lock.waitLock(20000);
    const aba = frApiAba_();
    const cab = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0].map(frApiChave_);
    const col = k => cab.indexOf(k) + 1;
    ['status', 'codigo', 'origem', 'destino'].forEach(k => { if (!col(k)) throw new Error('falta a coluna ' + k.toUpperCase()); });
    const gravadas = [], ignoradas = [];
    (corpo.atualizacoes || []).forEach(u => {
      const linha = Number(u.linha);
      if (!(linha >= 2 && linha <= aba.getLastRow())) return ignoradas.push({ linha: u.linha, motivo: 'linha fora da planilha' });
      const atual = frApiNorm_(aba.getRange(linha, col('status')).getValue());
      if (u.esperado && !u.esperado.map(frApiNorm_).includes(atual)) return ignoradas.push({ linha, motivo: 'STATUS mudou (' + atual + ')' });
      if (u.confere && (frApiNorm_(aba.getRange(linha, col('origem')).getValue()) !== frApiNorm_(u.confere.origem) ||
                        frApiNorm_(aba.getRange(linha, col('destino')).getValue()) !== frApiNorm_(u.confere.destino)))
        return ignoradas.push({ linha, motivo: 'a linha nao e mais a mesma' });
      aba.getRange(linha, col('status')).setValue(String(u.status));
      if (u.codigo !== undefined) aba.getRange(linha, col('codigo')).setValue(String(u.codigo));
      gravadas.push(linha);
    });
    return frApiJson_({ ok: true, gravadas, ignoradas });
  } catch (err) {
    return frApiJson_({ ok: false, erro: String(err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}
