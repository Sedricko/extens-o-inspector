// Sincronizacao com a planilha (aplicativo da web do Apps Script): publica o que esta PUBLICAR, fecha o que esta
// FECHAR/EXCLUIR/DESATIVAR e devolve STATUS/CODIGO. Manual (pagina de sincronizacao) e automatica (alarme).
const SYNC_PADRAO = { url: '', token: '', fechar: 'desativar', auto: false, minutos: 15, limite: 5, pausaSeg: 10 };
const syncCfg = async () => ({ ...SYNC_PADRAO, ...((await chrome.storage.local.get('syncCfg')).syncCfg || {}) });

async function syncLog(txt, nivel = 'info') {
  const { syncLogs = [] } = await chrome.storage.local.get('syncLogs');
  syncLogs.unshift({ t: Date.now(), txt, nivel });
  await chrome.storage.local.set({ syncLogs: syncLogs.slice(0, 80) });
}
const syncEstado = async () => (await chrome.storage.local.get('syncEstado')).syncEstado || {};
const syncEstadoSet = async patch => { const e = { ...(await syncEstado()), ...patch }; await chrome.storage.local.set({ syncEstado: e }); return e; };

async function planilhaGet(cfg) {
  if (!cfg.url || !cfg.token) throw new Error('Falta o endereco e a senha da planilha (pagina Sincronizar).');
  const r = await fetch(`${cfg.url}${cfg.url.includes('?') ? '&' : '?'}token=${encodeURIComponent(cfg.token)}`);
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error('Planilha: ' + (j.erro || 'resposta invalida (' + r.status + ')'));
  return j.linhas;
}
async function planilhaPost(cfg, atualizacoes) {
  const r = await fetch(cfg.url, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token: cfg.token, atualizacoes }) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error('Planilha: ' + (j.erro || 'resposta invalida (' + r.status + ')'));
  return j;
}

// Resultado que nao chegou na planilha fica guardado e e reenviado antes da proxima rodada.
async function syncReenviar(cfg) {
  const { syncPendentes = [] } = await chrome.storage.local.get('syncPendentes');
  if (!syncPendentes.length) return;
  try { await planilhaPost(cfg, syncPendentes); await chrome.storage.local.remove('syncPendentes'); await syncLog(`${syncPendentes.length} resultado(s) pendente(s) enviado(s) a planilha`); } catch {}
}
async function syncGravarFinal(cfg, up) {
  try { return await planilhaPost(cfg, [up]); } catch (e) {
    const { syncPendentes = [] } = await chrome.storage.local.get('syncPendentes');
    await chrome.storage.local.set({ syncPendentes: [...syncPendentes, up] });
    await syncLog(`Nao consegui gravar a linha ${up.linha} na planilha (${e.message}); vou reenviar depois.`, 'erro');
  }
}

async function syncPlano() {
  const cfg = await syncCfg();
  await syncReenviar(cfg);
  const linhas = (await planilhaGet(cfg)).map(linhaDeObjeto);
  const feitas = (await chrome.storage.local.get('lotePublicados')).lotePublicados || {};
  return { plano: planoDeSync(linhas, feitas, cfg), total: linhas.length };
}

async function syncEscrever(escritas) {
  const cfg = await syncCfg();
  if (escritas.length) await planilhaPost(cfg, escritas);
}

// Executa UMA acao: reserva a linha na planilha (se outra sincronizacao ja pegou, nao faz nada), age no site e grava o resultado.
async function syncAcao(acao, base = FB.site) {
  const cfg = await syncCfg();
  const publicar = acao.tipo === 'publicar';
  const conf = { origem: acao.row.origem, destino: acao.row.destino };
  const reservado = publicar ? 'PUBLICANDO...' : 'FECHANDO...';
  const gravar = (status, codigo) => syncGravarFinal(cfg, { linha: acao.linha, status, ...(codigo !== undefined && { codigo }), esperado: [reservado], confere: conf });

  const c = await planilhaPost(cfg, [{ linha: acao.linha, status: reservado, esperado: [acao.statusOriginal], confere: conf }]);
  if (!c.gravadas.includes(acao.linha)) return { pulada: true, motivo: 'a linha mudou na planilha ou outra sincronizacao ja pegou' };

  try {
    if (publicar) {
      const r = await fbFillTest(base, true, acao.row);
      const chave = linhaChave(acao.row);
      const { lotePublicados: feitas = {} } = await chrome.storage.local.get('lotePublicados');
      if (r.incerta) {
        feitas[chave] = { code: null, incerta: true, quando: Date.now() };
        await chrome.storage.local.set({ lotePublicados: feitas });
        await gravar('INCERTA - conferir', '');
        return { status: 'INCERTA', texto: r.error };
      }
      if (r.ok) {
        feitas[chave] = { code: r.code || null, quando: Date.now() };
        await chrome.storage.local.set({ lotePublicados: feitas }); // antes de gravar na planilha: se cair, nao republica
        await gravar('Publicado', r.code || '');
        return { status: 'Publicado', codigo: r.code, notas: r.notes };
      }
      await gravar('ERRO: ' + String(r.error || 'falhou').slice(0, 180) + (r.step ? ` (passo ${r.step.slice(0, 60)})` : ''), '');
      return { status: 'ERRO', texto: r.error };
    }
    const r = await fbClose(acao.codigo, acao.modo, base);
    if (r.ok) { await gravar(r.resultado); return { status: r.resultado }; }
    await gravar('ERRO: ' + String(r.error).slice(0, 180));
    return { status: 'ERRO', texto: r.error };
  } catch (e) {
    if (e.global) { // login/site fora do ar: devolve a linha como estava para tentar de novo depois
      await syncGravarFinal(cfg, { linha: acao.linha, status: acao.statusOriginal, esperado: [reservado], confere: conf });
      throw e;
    }
    await gravar('ERRO: ' + String(e.message || e).slice(0, 180));
    return { status: 'ERRO', texto: String(e.message || e) };
  }
}

// Rodada automatica (alarme): no maximo cfg.limite acoes por vez. Para sozinha se o login/site falhar (precisa "Retomar").
async function syncAuto(base = FB.site) {
  const cfg = await syncCfg();
  if (!cfg.auto || !cfg.url) return { motivo: 'desligado' };
  const est = await syncEstado();
  if (est.pausado) return { motivo: 'pausado' };
  if (est.rodando && Date.now() - est.rodando < 30 * 60e3) return { motivo: 'ja esta rodando' };
  await syncEstadoSet({ rodando: Date.now() });
  const feitos = [];
  try {
    const { plano } = await syncPlano();
    await syncEscrever(plano.escritas);
    for (const [n, acao] of plano.acoes.slice(0, cfg.limite).entries()) {
      const r = await syncAcao(acao, base);
      await syncLog(`linha ${acao.linha} ${acao.tipo}: ${r.pulada ? 'pulada (' + r.motivo + ')' : r.status + (r.codigo ? ' ' + r.codigo : '')}`, r.status === 'ERRO' ? 'erro' : 'info');
      feitos.push(r);
      if (acao.tipo === 'publicar' && n < Math.min(plano.acoes.length, cfg.limite) - 1) await new Promise(res => setTimeout(res, cfg.pausaSeg * 1000));
    }
    if (plano.acoes.length > cfg.limite) await syncLog(`${plano.acoes.length - cfg.limite} acao(oes) ficaram para a proxima rodada (limite ${cfg.limite})`);
  } catch (e) {
    await syncLog('Sincronizacao automatica pausada: ' + (e.message || e), 'erro');
    await syncEstadoSet({ pausado: true, motivo: String(e.message || e) });
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#b91c1c' });
  } finally {
    await syncEstadoSet({ rodando: 0, ultima: Date.now() });
  }
  return { feitos };
}

async function syncRetomar() {
  await syncEstadoSet({ pausado: false, motivo: '' });
  chrome.action.setBadgeText({ text: '' });
}

async function syncAlarme() {
  const cfg = await syncCfg();
  if (cfg.auto && cfg.url) chrome.alarms.create('sync-auto', { periodInMinutes: Math.max(1, Number(cfg.minutos) || 15) });
  else chrome.alarms.clear('sync-auto');
}
