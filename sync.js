// Sincronizacao com a planilha (aplicativo da web do Apps Script): publica o que esta PUBLICAR, fecha o que esta
// FECHAR/EXCLUIR/DESATIVAR e devolve STATUS/CODIGO. Manual (pagina de sincronizacao) e automatica (alarme).
const SYNC_PADRAO = { url: '', token: '', fechar: 'desativar', auto: false, minutos: 15, limite: 5, pausaSeg: 10, janela: 'aba', abas: 1, conferirZero: true, apagarTudo: false, conferirSumidos: false };
const syncCfg = async () => ({ ...SYNC_PADRAO, ...((await chrome.storage.local.get('syncCfg')).syncCfg || {}) });

// Varias abas trabalham ao mesmo tempo: cada assunto (log, estado, fila, historico, memoria) grava um de cada vez, para um nao apagar o outro.
const syncFilas = {};
const syncSerial = (nome, fn) => (syncFilas[nome] = (syncFilas[nome] || Promise.resolve()).then(fn, fn));

const syncLog = (txt, nivel = 'info') => syncSerial('log', async () => {
  const { syncLogs = [] } = await chrome.storage.local.get('syncLogs');
  syncLogs.unshift({ t: Date.now(), txt, nivel });
  await chrome.storage.local.set({ syncLogs: syncLogs.slice(0, 80) });
});
const syncEstado = async () => (await chrome.storage.local.get('syncEstado')).syncEstado || {};
const syncEstadoSet = patch => syncSerial('estado', async () => { const e = { ...(await syncEstado()), ...patch }; await chrome.storage.local.set({ syncEstado: e }); return e; });
// Lembra o que a extensao publicou (protege contra publicar duas vezes se a gravacao na planilha falhar).
const syncMemoria = (chave, valor) => syncSerial('memoria', async () => {
  const { lotePublicados: f = {} } = await chrome.storage.local.get('lotePublicados');
  f[chave] = valor;
  await chrome.storage.local.set({ lotePublicados: f });
});

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
// Chama uma funcao do Apps Script de longe (o painel do bot controla a planilha sem abrir o editor).
async function planilhaAcao(acao) {
  const cfg = await syncCfg();
  if (!cfg.url || !cfg.token) throw new Error('Falta o endereco e a senha da planilha (pagina Sincronizar).');
  const j = await planilhaChamar(cfg.url, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token: cfg.token, acao }) });
  if (!j.ok) throw new Error('Planilha: ' + (j.erro || 'resposta invalida'));
  return j.resultado;
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
  return { plano, total: linhas.length, linhas };
}

// Contador no icone da extensao (fila de acoes). O "!" de pausa tem prioridade.
async function syncBadge(n) {
  await chrome.storage.local.set({ syncFila: n });
  if ((await syncEstado()).pausado) return;
  chrome.action.setBadgeText({ text: n > 0 ? String(n) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
}

// Historico de fretes publicados/fechados (mais novo primeiro).
const syncHistoria = item => syncSerial('historico', async () => {
  const { syncHistorico = [] } = await chrome.storage.local.get('syncHistorico');
  syncHistorico.unshift({ t: Date.now(), ...item });
  await chrome.storage.local.set({ syncHistorico: syncHistorico.slice(0, 300) });
});

async function syncEscrever(escritas) {
  const cfg = await syncCfg();
  if (escritas.length) await planilhaPost(cfg, escritas);
}

// Executa UMA acao: reserva a linha na planilha (se outra sincronizacao ja pegou, nao faz nada), age no site e grava o resultado.
// Executa UMA acao, desconta do contador do icone e registra no historico.
async function syncAcao(acao, base = FB.site) {
  const r = await syncAcaoFeita(acao, base); // lanca se o login/site cair: nesse caso nada e descontado nem registrado
  if (!r.continua) await syncSerial('fila', async () => { // o antigo fechado de um RENOVAR ainda tem a publicacao pela frente: nao desconta
    const { syncFila = 0 } = await chrome.storage.local.get('syncFila');
    await syncBadge(Math.max(0, syncFila - 1));
  });
  if ((await syncEstado()).rodando) await syncEstadoSet({ rodando: Date.now() }); // "estou vivo": uma rodada longa nao e dada como travada
  if (!r.pulada) await syncHistoria({
    tipo: acao.tipo, linha: acao.linha, status: r.status, nota: r.texto || '',
    frete: acao.tipo !== 'fechar' ? `${acao.row.origem} → ${acao.row.destino}` : acao.codigo,
    codigo: r.codigo || (acao.tipo === 'fechar' ? acao.codigo : ''),
  });
  return r;
}

async function syncAcaoFeita(acao, base) {
  const cfg = await syncCfg();
  const renovar = acao.tipo === 'renovar';
  const publicar = acao.tipo === 'publicar';
  const conf = { origem: acao.row.origem, destino: acao.row.destino };
  const reservado = renovar ? 'RENOVANDO...' : publicar ? 'PUBLICANDO...' : 'FECHANDO...';
  const gravar = (status, codigo) => syncGravarFinal(cfg, { linha: acao.linha, status, ...(codigo !== undefined && { codigo }), esperado: [reservado], confere: conf });

  const c = await planilhaPost(cfg, [{ linha: acao.linha, status: reservado, esperado: [acao.statusOriginal], confere: conf }]);
  if (!c.gravadas.includes(acao.linha)) return { pulada: true, motivo: 'a linha mudou na planilha ou outra sincronizacao ja pegou' };

  try {
    if (renovar) { // etapa 1: fecha o frete antigo. Se nao conseguir, nao publica (evita duplicar). Se conseguir, a linha vira REPUBLICAR e a etapa 2 a publica.
      const f = await fbClose(acao.codigo, acao.modo, base);
      if (!f.ok) { await gravar('ERRO ao fechar o antigo: ' + String(f.error).slice(0, 150)); return { status: 'ERRO', texto: f.error }; }
      await gravar('REPUBLICAR', '');
      return { status: 'Antigo fechado', texto: f.resultado, continua: true };
    }
    if (publicar) {
      const r = await fbFillTest(base, true, acao.row);
      const chave = linhaChave(acao.row);
      if (r.incerta) {
        await syncMemoria(chave, { code: null, incerta: true, quando: Date.now() });
        await gravar('INCERTA - conferir', '');
        return { status: 'INCERTA', texto: r.error };
      }
      if (r.ok) {
        await syncMemoria(chave, { code: r.code || null, quando: Date.now() }); // antes de gravar na planilha: se cair, nao republica
        await gravar('Publicado', r.code || '');
        return { status: 'Publicado', codigo: r.code, notas: r.notes };
      }
      await gravar('ERRO: ' + String(r.error || 'falhou').slice(0, 150) + (r.step ? ` (passo ${r.step.slice(0, 60)})` : ''), '');
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
    let { plano, linhas } = await syncPlano();
    await syncEscrever(plano.escritas);

    // CONFERE COM O FRETEBRAS DE VERDADE (so no programa Windows): carga "Publicado" na planilha que ja nao
    // esta mais ativa la (por exemplo, a propria Fretebras desativou sozinha) vira REPUBLICAR. So age quando
    // da para ver TODOS os fretes ativos numa pagina so (senao, podia marcar sumido um que so nao apareceu).
    if (cfg.conferirSumidos && typeof fbCodigosAtivos === 'function') {
      const r = await fbCodigosAtivos(base);
      if (!r.completo) await syncLog(`Nao conferi fretes sumidos do Fretebras: ${r.total} ativo(s), mais do que cabe numa pagina (pulei desta vez).`, 'erro');
      else {
        const sumidos = linhas.filter(l => /^publicad/.test(linhaNorm(l.status)) && l.codigo && !r.codigos.has(l.codigo));
        if (sumidos.length) {
          await syncEscrever(sumidos.map(l => ({ linha: l.linha, status: 'REPUBLICAR', codigo: '', esperado: [l.status], confere: { origem: l.origem, destino: l.destino } })));
          await syncLog(`${sumidos.length} frete(s) sumiram do Fretebras (nao estao mais ativos la) e foram marcados REPUBLICAR.`);
          ({ plano, linhas } = await syncPlano()); // recalcula ja com os REPUBLICAR novos, para entrarem nesta mesma rodada
        }
      }
    }

    const lista = plano.acoes.slice(0, cfg.limite);
    const registrar = (acao, r) => { feitos.push(r); return syncLog(`linha ${acao.linha} ${acao.tipo}: ${r.pulada ? 'pulada (' + r.motivo + ')' : r.status + (r.codigo ? ' ' + r.codigo : '')}`, r.status === 'ERRO' ? 'erro' : 'info'); };

    // ETAPA 1 - um processo so, uma aba por vez: fecha TUDO que tem que ser fechado antes de publicar qualquer coisa
    const etapa2 = lista.filter(a => a.tipo === 'publicar');
    for (const a of lista.filter(a => a.tipo !== 'publicar')) {
      const r = await syncAcao(a, base); // se o login/site cair aqui, lanca e a etapa 2 nem comeca
      await registrar(a, r);
      if (a.tipo === 'renovar' && r.continua) etapa2.push(acaoDepoisDeFechar(a));
    }

    // APAGAR TUDO (so no programa Windows): exclui todos os SEUS fretes ativos de uma vez, antes de republicar.
    // So roda se ha REPUBLICAR na fila, se cabe tudo no limite da rodada e se nenhum frete "Publicado" ficaria sem republicar.
    if (cfg.apagarTudo && typeof fbApagarMeus === 'function' && etapa2.some(a => linhaNorm(a.statusOriginal) === 'republicar')) {
      const pend = plano.acoes.filter(a => a.tipo === 'renovar' || linhaNorm(a.statusOriginal) === 'republicar').length;
      const vivas = linhas.filter(l => /^publicad/.test(linhaNorm(l.status)) && l.codigo).length;
      if (vivas) await syncLog(`Nao apaguei tudo: ha ${vivas} frete(s) "Publicado" na planilha que nao estao para republicar (use RENOVAR/republicarAbertas para todos).`, 'erro');
      else if (pend > cfg.limite) await syncLog(`Nao apaguei tudo: ${pend} cargas para republicar e o limite da rodada e ${cfg.limite}. Aumente o limite.`, 'erro');
      else { const r = await fbApagarMeus(base); await syncLog(`Apaguei ${r.apagados} frete(s) seu(s) antes de republicar.`); }
    }

    // CONFERENCIA - antes de publicar de novo (REPUBLICAR/RENOVAR), nao pode restar nenhum frete ativo na conta (conta todas as paginas)
    if (cfg.conferirZero && etapa2.some(a => linhaNorm(a.statusOriginal) === 'republicar')) {
      const c = await fbContarAtivos(base);
      if (c.ativos !== 0) {
        await syncLog(c.ativos === null ? 'Nao consegui conferir quantos fretes ativos restam: nao publiquei nada nesta rodada.' : `Ainda ha ${c.ativos} frete(s) ativo(s) na Fretebras: nao publiquei nada. Feche-os (ou desligue a conferencia na pagina Sincronizar).`, 'erro');
        etapa2.length = 0;
      }
    }

    // ETAPA 2 - so depois: publica, com varias abas ao mesmo tempo (cada uma pega a proxima carga da fila)
    let proxima = 0, parar = false;
    const abas = Math.max(1, Math.min(5, Number(cfg.abas) || 1));
    const trabalhador = async () => {
      while (!parar && proxima < etapa2.length) {
        const acao = etapa2[proxima++];
        let r;
        try { r = await syncAcao(acao, base); } catch (e) { parar = true; throw e; } // login/site caiu: ninguem pega acao nova
        await registrar(acao, r);
        if (proxima < etapa2.length) await new Promise(res => setTimeout(res, cfg.pausaSeg * 1000));
      }
    };
    const fim = await Promise.allSettled(Array.from({ length: Math.min(abas, etapa2.length) }, trabalhador));
    const falhou = fim.find(x => x.status === 'rejected');
    if (falhou) throw falhou.reason; // espera todas terminarem antes de pausar
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
