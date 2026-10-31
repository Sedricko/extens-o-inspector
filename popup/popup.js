const out = document.getElementById('out');
const activeTab = async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
const send = async cmd => {
  try { return await chrome.tabs.sendMessage((await activeTab()).id, { cmd }); }
  catch { return { error: 'Sem acesso a esta aba. Recarregue a pagina (F5) e tente de novo.' }; }
};
const show = text => { out.textContent = text; };

document.getElementById('scan').onclick = async () => {
  const r = await send('scan');
  show(r.error || `${r.count} elementos (${r.react} com React). Rede: ${r.network} chamadas.`);
};
document.getElementById('hl').onclick = async () => {
  const r = await send('highlight');
  show(r.error || (r.on ? 'Destaque ligado.' : 'Destaque desligado.'));
};
document.getElementById('export').onclick = async () => {
  const r = await send('export');
  show(r.error || `Salvo em Downloads/${r.filename}`);
};
const inject = file => async () => {
  try {
    await chrome.scripting.executeScript({ target: { tabId: (await activeTab()).id }, world: 'MAIN', files: [file] });
    window.close();
  } catch (e) { show(String(e.message || e)); }
};
document.getElementById('panel').onclick = inject('scripts/inject_panel.js');
document.getElementById('rec').onclick = async () => {
  const r = await send('rec');
  show(r.error || (r.on ? 'Gravando. Use o site e clique em "Parar e salvar" na barra vermelha.' : 'Gravacao salva em Downloads/master-spa.'));
};

// Fretebras (background, funciona com a aba fechada)
const fbLine = document.getElementById('fb');
const bg = cmd => chrome.runtime.sendMessage({ cmd });
const fbRefresh = async () => {
  const s = await bg('fb-status');
  fbLine.textContent = s.active
    ? `Fretebras: sessao ativa ate ${new Date(s.until).toLocaleString('pt-BR')}` + (s.renews ? '' : ' (sem renovacao automatica)') + (s.lastTest ? ` (teste ${s.lastTest.code} publicado)` : '')
    : 'Fretebras: sem sessao. Abra a Central da Fretebras para ativar.';
};
fbRefresh();
document.getElementById('fbfill').onclick = async () => {
  show('Abrindo a aba em segundo plano e preenchendo... (pode levar ate 1 minuto)');
  const r = await bg('fb-fill');
  show(r.error || (r.ok ? `Preenchido (${r.done} passos).${(r.notes || []).length ? " Atencao: " + r.notes.join("; ") + "." : ""} A aba ficou aberta em segundo plano: clique nela (a ultima da barra) para conferir e publicar.` : `Parou no passo ${r.step}: ${r.error}. A aba ficou aberta em segundo plano; a mesma mensagem esta nela.`));
};
document.getElementById('fbpub').onclick = async () => {
  if (!confirm('Vai PUBLICAR DE VERDADE um frete (Extrema-MG -> Frutal-MG, Pallet, Carreta Sider, 25 t, a combinar, pagamento Outro, rastreador) pela sua conta. Continuar?')) return;
  show('Preenchendo e publicando em segundo plano... (pode levar ate 1 minuto)');
  const r = await bg('fb-publish-form');
  show(r.error ? (r.step ? `Parou no passo ${r.step}: ${r.error}` : r.error) : r.ok ? `Publicado: ${r.code || '(codigo nao lido)'}. A aba foi fechada. Se era so teste, exclua em Meus Fretes.` : `Parou no passo ${r.step}: ${r.error}`);
};
document.getElementById('lote').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('lote/lote.html') });
