// Sincronizacao com a planilha (aplicativo da web do Apps Script): publica o que esta PUBLICAR, fecha o que esta
// FECHAR/EXCLUIR/DESATIVAR e devolve STATUS/CODIGO. Manual (pagina de sincronizacao) e automatica (alarme).
const SYNC_PADRAO = { url: '', token: '', fechar: 'desativar', auto: false, minutos: 15, limite: 5, pausaSeg: 10, janela: 'aba' };
const syncCfg = async () => ({ ...SYNC_PADRAO, ...((await chrome.storage.local.get('syncCfg')).syncCfg || {}) });

async function syncLog(txt, nivel = 'info') {
  const { syncLogs = [] } = await chrome.storage.local.get('syncLogs');
  syncLogs.unshift({ t: Date.now(), txt, nivel });
  await chrome.storage.local.set({ syncLogs: syncLogs.slice(0, 80) });
}
const syncEstado = async () => (await chrome.storage.local.get('syncEstado')).syncEstado || {};
const syncEstadoSet = async patch => { const e = { ...(await syncEstado()), ...patch }; await chrome.storage.local.set({ syncEstado: e }); return e; };

// Chama o aplicativo da web e, se a resposta nao for do nosso script, explica o que o Google respondeu.
async function planilhaChamar(url, init) {
  const r = await fetch(url, init);
  const txt = await r.text();
  let j; try { j = JSON.parse(txt); } catch {}
  if (j && typeof j.ok === 'boolean') return j;
  if (/accounts\.google\.com|ServiceLogin/i.test(txt)) throw new Error('o Google pediu login: em Implantar > Gerenciar implantacoes, "Quem pode acessar" precisa ser "Qualquer pessoa"');
  if (r.status === 404 || /nao foi possivel abrir|unable to open|n\u00e3o foi poss\u00edvel abrir/i.test(txt))
    throw new Error('o Google nao achou o aplicativo da web nesse endereco (404). Use o "URL do app da Web" de uma implantacao ativa (termina em /exec) e confira se "Quem pode acessar" e "Qualquer pessoa"');
  throw new Error(`resposta inesperada do Google (${r.status}): ${txt.replace(/\s+/g, ' ').slice(0, 80)}`);
}
async function planilhaGet(cfg) {
  if (!cfg.url || !cfg.token) throw new Error('Falta o endereco e a senha da planilha (pagina Sincronizar).');
  const j = await planilhaChamar(`${cfg.url}${cfg.url.includes('?') ? '&' : '?'}token=${encodeURIComponent(cfg.token)}`);
  if (!j.ok) throw new Error('Planilha: ' + (j.erro || 'resposta invalida'));
  return j.linhas;
}
async function planilhaPost(cfg, atualizacoes) {
  const j = await planilhaChamar(cfg.url, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token: cfg.token, atualizacoes }) });
  if (!j.ok) throw new Error('Planilha: ' + (j.erro || 'resposta invalida'));
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
  const plano = planoDeSync(linhas, feitas, cfg);
  await syncBadge(plano.acoes.length); // contador no icone: quantas acoes faltam
  return { plano, total: linhas.length };
}

// Contador no icone da extensao (fila de acoes). O "!" de pausa tem prioridade.
async function syncBadge(n) {
  await chrome.storage.local.set({ syncFila: n });
  if ((await syncEstado()).pausado) return;
  chrome.action.setBadgeText({ text: n > 0 ? String(n) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
}

// Historico de fretes publicados/fechados (mais novo primeiro).
async function syncHistoria(item) {
  const { syncHistorico = [] } = await chrome.storage.local.get('syncHistorico');
  syncHistorico.unshift({ t: Date.now(), ...item });
  await chrome.storage.local.set({ syncHistorico: syncHistorico.slice(0, 300) });
}

async function syncEscrever(escritas) {
  const cfg = await syncCfg();
  if (escritas.length) await planilhaPost(cfg, escritas);
}

// Executa UMA acao: reserva a linha na planilha (se outra sincronizacao ja pegou, nao faz nada), age no site e grava o resultado.
// Executa UMA acao, desconta do contador do icone e registra no historico.
async function syncAcao(acao, base = FB.site) {
  const r = await syncAcaoFeita(acao, base); // lanca se o login/site cair: nesse caso nada e descontado nem registrado
  const { syncFila = 0 } = await chrome.storage.local.get('syncFila');
  await syncBadge(Math.max(0, syncFila - 1));
  if ((await syncEstado()).rodando) await syncEstadoSet({ rodando: Date.now() }); // "estou vivo": uma rodada longa nao e dada como travada
  if (!r.pulada) await syncHistoria({
    tipo: acao.tipo, linha: acao.linha, status: r.status, nota: r.texto || '',
    frete: acao.tipo === 'publicar' ? `${acao.row.origem} → ${acao.row.destino}` : acao.codigo,
    codigo: r.codigo || (acao.tipo === 'fechar' ? acao.codigo : ''),
  });
  return r;
}

async function syncAcaoFeita(acao, base) {
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
  const { syncFila = 0 } = await chrome.storage.local.get('syncFila');
  await syncBadge(syncFila);
}

async function syncAlarme() {
  const cfg = await syncCfg();
  if (cfg.auto && cfg.url) chrome.alarms.create('sync-auto', { periodInMinutes: Math.max(1, Number(cfg.minutos) || 15) });
  else chrome.alarms.clear('sync-auto');
}
