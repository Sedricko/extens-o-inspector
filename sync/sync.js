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
  $('janela').value = syncCfg.janela || 'aba'; $('abas').value = syncCfg.abas || 1; $('zero').checked = syncCfg.conferirZero !== false; $('minutos').value = syncCfg.minutos || 15; $('limite').value = syncCfg.limite || 5; $('pausa-seg').value = syncCfg.pausaSeg || 10;
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
  minutos: Math.max(1, +$('minutos').value || 15), limite: Math.max(1, +$('limite').value || 5), pausaSeg: Math.max(5, +$('pausa-seg').value || 10), janela: $('janela').value, abas: Math.max(1, Math.min(5, +$('abas').value || 1)), conferirZero: $('zero').checked });

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
    const itens = plano.acoes.map((acao, i) => ({ acao, t: linhasTab[i] }));
    let parou = false;
    const concluir = (x, r) => {
      if (r.error) { x.t.situacao = 'ERRO: ' + r.error; x.t.cls = 'err'; if (r.global) { parou = true; $('msg').textContent = 'Parou: login ou site da Fretebras. A linha ficou como estava.'; } return; }
      x.t.situacao = r.pulada ? 'pulada: ' + r.motivo : r.status + (r.codigo ? ' ' + r.codigo : '') + (r.texto ? ' — ' + r.texto : '');
      x.t.cls = r.status === 'ERRO' || r.status === 'INCERTA' ? 'err' : 'ok';
    };
    // ETAPA 1 - um processo so, uma aba por vez: fecha TUDO antes de publicar qualquer coisa
    const etapa2 = itens.filter(x => x.acao.tipo === 'publicar');
    for (const x of itens.filter(x => x.acao.tipo !== 'publicar')) {
      if (parar || parou) break;
      x.t.situacao = 'fechando…'; desenhar(); $('msg').textContent = 'Etapa 1: fechando os fretes antigos, um de cada vez…';
      const r = await send('sync-acao', { acao: x.acao });
      concluir(x, r);
      if (x.acao.tipo === 'renovar' && r.continua) { x.t.situacao = 'antigo fechado; aguardando a etapa de publicar…'; x.t.cls = ''; etapa2.push({ acao: acaoDepoisDeFechar(x.acao), t: x.t }); }
      desenhar();
    }
    // CONFERENCIA - antes de publicar de novo, nao pode restar nenhum frete ativo na conta (conta todas as paginas)
    if (cfg.conferirZero && !parar && !parou && etapa2.some(x => linhaNorm(x.acao.statusOriginal) === 'republicar')) {
      $('msg').textContent = 'Conferindo se ainda resta algum frete ativo na Fretebras…';
      const c = await send('sync-ativos');
      if (c.error || c.ativos !== 0) {
        parou = true;
        $('msg').textContent = c.error ? 'Nao consegui conferir: ' + c.error : c.ativos === null ? 'Nao consegui conferir quantos fretes ativos restam: nada foi publicado.' : `Ainda há ${c.ativos} frete(s) ativo(s) na Fretebras: nada foi publicado. Feche-os ou desligue a conferência.`;
      }
    }
    // ETAPA 2 - so depois: publica, com varias abas ao mesmo tempo
    let proxima = 0;
    const trabalhador = async () => {
      while (!parar && !parou && proxima < etapa2.length) {
        const x = etapa2[proxima++];
        x.t.situacao = 'publicando…'; desenhar(); $('msg').textContent = `Etapa 2: publicando (${Math.min(proxima, etapa2.length)} de ${etapa2.length} iniciadas)…`;
        concluir(x, await send('sync-acao', { acao: x.acao }));
        desenhar();
        if (proxima < etapa2.length) await pausa(cfg.pausaSeg * 1000);
      }
    };
    if (!parar && !parou) await Promise.all(Array.from({ length: Math.min(cfg.abas, etapa2.length) }, trabalhador));
    if (!parou) $('msg').textContent = parar ? 'Parado. O restante ficou na planilha como estava.' : 'Terminou.';
  } finally { await send('sync-fim'); rodando = false; desenhar(); atualizar(); }
};
$('parar').onclick = () => { parar = true; };
$('limpar-hist').onclick = async () => { if (confirm('Apagar o histórico de fretes desta tela? (a planilha não muda)')) { await chrome.storage.local.remove('syncHistorico'); atualizar(); } };
chrome.storage.onChanged.addListener(c => { if (c.syncLogs || c.syncEstado || c.syncHistorico || c.syncFila) atualizar(); });
carregar();
