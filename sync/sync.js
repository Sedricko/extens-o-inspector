// Pagina da sincronizacao: configura a ligacao com a planilha, mostra a previa e executa as acoes uma por vez.
const $ = id => document.getElementById(id);
const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const send = (cmd, extra) => chrome.runtime.sendMessage({ cmd, ...extra });
const pausa = ms => new Promise(r => setTimeout(r, ms));
let plano = null, linhasTab = [], parar = false, rodando = false;

async function carregar() {
  const { syncCfg = {} } = await chrome.storage.local.get('syncCfg');
  $('url').value = syncCfg.url || ''; $('token').value = syncCfg.token || '';
  $('fechar').value = syncCfg.fechar || 'desativar'; $('auto').checked = !!syncCfg.auto;
  $('janela').value = syncCfg.janela || 'aba'; $('minutos').value = syncCfg.minutos || 15; $('limite').value = syncCfg.limite || 5; $('pausa-seg').value = syncCfg.pausaSeg || 10;
  await atualizar();
}
async function atualizar() {
  const { syncEstado = {}, syncLogs = [], syncHistorico = [], syncFila = 0 } = await chrome.storage.local.get(['syncEstado', 'syncLogs', 'syncHistorico', 'syncFila']);
  $('fila').textContent = syncFila ? `Faltam ${syncFila} ação(ões) (o número também aparece no ícone da extensão).` : '';
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const deHoje = syncHistorico.filter(h => h.t >= hoje.getTime());
  const conta = (tipo, ok) => deHoje.filter(h => h.tipo === tipo && (ok ? !/^(ERRO|INCERTA)/.test(h.status) : /^(ERRO|INCERTA)/.test(h.status))).length;
  $('resumo-hist').textContent = syncHistorico.length ? `Hoje: ${conta('publicar', true)} publicado(s), ${conta('fechar', true)} fechado(s), ${conta('publicar', false) + conta('fechar', false)} com erro ou incerto(s).` : 'Nada ainda.';
  $('hist').innerHTML = syncHistorico.slice(0, 100).map(h => `<tr><td>${esc(new Date(h.t).toLocaleString('pt-BR'))}</td><td>${h.tipo === 'publicar' ? 'Publicar' : h.tipo === 'renovar' ? 'Renovar' : 'Fechar'} (linha ${esc(h.linha)})</td><td>${esc(h.frete)}</td>
    <td class="${/^(ERRO|INCERTA)/.test(h.status) ? 'err' : 'ok'}">${esc(h.status)}${h.nota ? ' — ' + esc(h.nota) : ''}</td><td>${esc(h.codigo)}</td></tr>`).join('');
  $('pausa').hidden = !syncEstado.pausado;
  $('motivo').textContent = syncEstado.motivo || '';
  $('log').innerHTML = syncLogs.map(l => `<div class="${l.nivel === 'erro' ? 'err' : ''}">${new Date(l.t).toLocaleString('pt-BR')}  ${esc(l.txt)}</div>`).join('') || '<span class="mut">Nada ainda.</span>';
}
const cfgDaTela = () => ({ url: $('url').value.trim(), token: $('token').value.trim(), fechar: $('fechar').value, auto: $('auto').checked,
  minutos: Math.max(1, +$('minutos').value || 15), limite: Math.max(1, +$('limite').value || 5), pausaSeg: Math.max(5, +$('pausa-seg').value || 10), janela: $('janela').value });

$('salvar').onclick = async () => { await chrome.storage.local.set({ syncCfg: cfgDaTela() }); $('teste').textContent = 'Salvo.'; };
$('testar').onclick = async () => {
  await $('salvar').onclick();
  $('teste').textContent = 'Testando…';
  const r = await send('sync-plano');
  $('teste').textContent = r.error ? 'Erro: ' + r.error : `Ligado: ${r.total} linhas na planilha.`;
  $('teste').className = r.error ? 'err' : 'ok';
};
$('retomar').onclick = async () => { await send('sync-retomar'); atualizar(); };

function desenhar() {
  $('tab').innerHTML = linhasTab.map(t => `<tr><td>${t.linha}</td><td>${esc(t.acao)}</td><td>${esc(t.frete)}</td><td class="${t.cls || ''}">${esc(t.situacao)}</td></tr>`).join('');
  $('executar').disabled = rodando || !plano || !plano.acoes.length;
  $('parar').disabled = !rodando;
}

$('previa').onclick = async () => {
  await $('salvar').onclick();
  $('msg').textContent = 'Lendo a planilha…';
  const r = await send('sync-plano');
  if (r.error) { $('msg').textContent = ''; $('msg').className = 'err'; $('msg').textContent = r.error; return; }
  plano = r.plano;
  linhasTab = [
    ...plano.acoes.map(a => ({ linha: a.linha, acao: a.tipo === 'publicar' ? 'PUBLICAR' : a.tipo === 'renovar' ? `RENOVAR (${a.modo === 'excluir' ? 'exclui' : 'desativa'} ${a.codigo} e publica de novo)` : a.modo === 'excluir' ? 'EXCLUIR' : 'DESATIVAR', frete: a.tipo !== 'fechar' ? `${a.row.origem} → ${a.row.destino}` : a.codigo, situacao: 'aguardando' })),
    ...plano.escritas.map(e => ({ linha: e.linha, acao: 'só atualizar a planilha', frete: '', situacao: e.status + (e.codigo ? ' ' + e.codigo : '') })),
  ];
  $('msg').className = '';
  $('msg').textContent = plano.acoes.length ? `${plano.acoes.length} ação(ões) no site, ${plano.escritas.length} só na planilha.` : 'Nada para fazer no site.';
  desenhar();
};

$('executar').onclick = async () => {
  const pub = plano.acoes.filter(a => a.tipo !== 'fechar').length, fec = plano.acoes.filter(a => a.tipo !== 'publicar').length;
  if (!confirm(`Vai fazer DE VERDADE na Fretebras: publicar ${pub} frete(s) e fechar ${fec}. Continuar?`)) return;
  const ini = await send('sync-inicio');
  if (ini.error) { $('msg').textContent = ini.error; return; }
  const cfg = cfgDaTela();
  rodando = true; parar = false; desenhar();
  try {
    if (plano.escritas.length) await send('sync-escrever', { escritas: plano.escritas });
    for (const [n, acao] of plano.acoes.entries()) {
      if (parar) { $('msg').textContent = 'Parado. O restante ficou na planilha como estava.'; break; }
      const t = linhasTab[n];
      t.situacao = 'em andamento…'; desenhar();
      $('msg').textContent = `Ação ${n + 1} de ${plano.acoes.length}…`;
      const r = await send('sync-acao', { acao });
      if (r.error) { t.situacao = 'ERRO: ' + r.error; t.cls = 'err'; desenhar(); if (r.global) { $('msg').textContent = 'Parou: login ou site da Fretebras. A linha ficou como estava.'; break; } continue; }
      t.situacao = r.pulada ? 'pulada: ' + r.motivo : r.status + (r.codigo ? ' ' + r.codigo : '') + (r.texto ? ' — ' + r.texto : '');
      t.cls = r.status === 'ERRO' || r.status === 'INCERTA' ? 'err' : 'ok';
      desenhar();
      if (acao.tipo !== 'fechar' && n < plano.acoes.length - 1) await pausa(cfg.pausaSeg * 1000);
      if (n === plano.acoes.length - 1) $('msg').textContent = 'Terminou.';
    }
  } finally { await send('sync-fim'); rodando = false; desenhar(); atualizar(); }
};
$('parar').onclick = () => { parar = true; };
$('limpar-hist').onclick = async () => { if (confirm('Apagar o histórico de fretes desta tela? (a planilha não muda)')) { await chrome.storage.local.remove('syncHistorico'); atualizar(); } };
chrome.storage.onChanged.addListener(c => { if (c.syncLogs || c.syncEstado || c.syncHistorico || c.syncFila) atualizar(); });
carregar();
