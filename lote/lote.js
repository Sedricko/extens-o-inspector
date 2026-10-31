// Pagina do lote: valida as linhas da planilha e manda uma por vez ao background (que abre a aba da Central em segundo plano).
// Nao duplica: pula o que a planilha ja marcou como publicado, o que esta extensao ja publicou e linhas repetidas.
const $ = id => document.getElementById(id);
let linhas = [], erros = [], pular = [], status = [], feitas = {}, rodando = false, parar = false;
const pausa = ms => new Promise(r => setTimeout(r, ms));
const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const guardar = () => chrome.storage.local.set({ lotePublicados: feitas });

async function ler() {
  feitas = (await chrome.storage.local.get('lotePublicados')).lotePublicados || {};
  try { linhas = $('txt').value.trim() ? linhasDeTexto($('txt').value) : []; } catch { linhas = []; }
  erros = linhas.map(l => linhaParaPassos(l).erros);
  const vistas = new Map();
  pular = linhas.map((l, i) => {
    const k = linhaChave(l), f = feitas[k];
    let motivo = '';
    if (linhaJaPublicada(l)) motivo = `ja publicada na planilha${l.codigo ? ' (' + l.codigo + ')' : ''}`;
    else if (f) motivo = f.incerta ? 'pode ja estar publicada (publicacao incerta): confira em Meus Fretes' : `ja publicada por esta extensao (${f.code || 'sem codigo'})`;
    else if (vistas.has(k)) motivo = `repetida (igual a linha ${vistas.get(k) + 1})`;
    vistas.set(k, vistas.get(k) ?? i);
    return motivo;
  });
  status = linhas.map(() => ({ txt: '', cls: '' }));
  desenhar();
}

const publicaveis = () => linhas.map((_, i) => i).filter(i => !pular[i] && !erros[i].length);

function desenhar() {
  $('tab').innerHTML = linhas.map((l, i) => {
    const st = status[i];
    const sit = pular[i] ? `<span>pulada: ${esc(pular[i])}</span>`
      : erros[i].length ? `<span class="err">${esc(erros[i].join('; '))}</span>`
      : `<span class="${st.cls}">${esc(st.txt || 'pronta')}</span>`;
    return `<tr><td>${i + 1}</td><td>${esc(l.origem)} → ${esc(l.destino)}</td><td>${esc(l.produto)}</td><td>${esc(l.peso)}</td>
      <td>${esc(l.veiculo)} / ${esc(l.carroceria)}</td><td>${esc(l.pagamento)}</td><td>${sit}</td></tr>`;
  }).join('');
  const ruins = linhas.filter((_, i) => !pular[i] && erros[i].length).length;
  const ok = publicaveis().length;
  $('resumo').textContent = linhas.length
    ? `${linhas.length} linhas: ${ok} para publicar, ${pular.filter(Boolean).length} puladas${ruins ? `, ${ruins} com erro (corrija para publicar)` : ''}`
    : '';
  const pode = ok && !ruins && !rodando;
  $('testar').disabled = !pode;
  $('publicar').disabled = !pode;
  $('parar').disabled = !rodando;
  $('copiar').disabled = !linhas.length;
}

async function enviar(i, publicar) {
  status[i] = { txt: publicar ? 'publicando…' : 'preenchendo…', cls: '' };
  desenhar();
  const r = await chrome.runtime.sendMessage({ cmd: 'fb-row', row: linhas[i], publish: publicar });
  if (r.incerta) { // clicou em Publicar e nao confirmou: guarda como incerta para nunca repetir
    feitas[linhaChave(linhas[i])] = { code: null, incerta: true, quando: Date.now() };
    await guardar();
    status[i] = { txt: 'INCERTA: confira em Meus Fretes (nao vou repetir)', cls: 'err' };
  } else if (r.error) status[i] = { txt: 'ERRO: ' + r.error, cls: 'err' };
  else if (!r.ok) status[i] = { txt: `ERRO no passo ${r.step || ''}: ${r.error}`, cls: 'err' };
  else if (publicar) {
    feitas[linhaChave(linhas[i])] = { code: r.code || null, quando: Date.now() };
    await guardar(); // antes da proxima linha: se a pagina cair, nao republica
    status[i] = { txt: `publicado ${r.code || '(codigo nao lido)'}${(r.notes || []).length ? ' — ' + r.notes.join('; ') : ''}`, cls: 'ok', code: r.code };
  } else status[i] = { txt: 'preenchido (aba aberta em segundo plano)', cls: 'ok' };
  desenhar();
  return status[i].cls === 'ok';
}

async function rodar(publicar, so) {
  rodando = true; parar = false; desenhar();
  const lista = so == null ? publicaveis() : [so];
  for (const [n, i] of lista.entries()) {
    if (parar) { $('msg').textContent = 'Parado. As linhas restantes não foram publicadas.'; break; }
    $('msg').textContent = `Linha ${i + 1} (${n + 1} de ${lista.length})…`;
    const ok = await enviar(i, publicar);
    if (!ok && !$('cont').checked) { $('msg').textContent = `Parou na linha ${i + 1}. As seguintes não foram publicadas.`; break; }
    if (publicar && n < lista.length - 1) await pausa(Math.max(5, +$('seg').value || 10) * 1000);
    if (n === lista.length - 1) $('msg').textContent = 'Terminou.';
  }
  rodando = false; desenhar();
}

$('txt').oninput = ler;
$('testar').onclick = () => rodar(false, publicaveis()[0]);
$('publicar').onclick = () => {
  if (confirm(`Vai PUBLICAR DE VERDADE ${publicaveis().length} fretes pela sua conta, um a cada ${$('seg').value} segundos. Continuar?`)) rodar(true);
};
$('parar').onclick = () => { parar = true; };
$('esquecer').onclick = async () => {
  if (!confirm('A extensao vai esquecer o que ja publicou. Linhas ainda sem CODIGO na planilha poderao ser publicadas de novo (duplicando). Continuar?')) return;
  await chrome.storage.local.remove('lotePublicados'); ler();
};
// Uma linha por frete, na ordem da lista: STATUS<tab>CODIGO. Cole nas colunas STATUS e CÓDIGO a partir da primeira linha de dados.
$('copiar').onclick = async () => {
  const txt = linhas.map((l, i) => {
    const f = feitas[linhaChave(l)];
    if (status[i].code) return `Publicado\t${status[i].code}`;
    if (linhaJaPublicada(l)) return `${l.status || 'Publicado'}\t${l.codigo || ''}`;
    if (f && !f.incerta) return `Publicado\t${f.code || ''}`;
    if (f && f.incerta) return 'INCERTA - conferir\t';
    return `${status[i].cls === 'err' ? status[i].txt : l.status || ''}\t${l.codigo || ''}`;
  }).join('\n');
  await navigator.clipboard.writeText(txt);
  $('msg').textContent = 'Copiado. Na planilha, clique na célula STATUS da primeira linha de dados e cole.';
};
ler();
