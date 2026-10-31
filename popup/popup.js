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
document.getElementById('fbtest').onclick = async () => {
  if (!confirm('Vai PUBLICAR DE VERDADE 1 frete de teste (Goiania-GO -> Sao Paulo-SP, produto TESTE). Depois exclua com o outro botao. Continuar?')) return;
  show('Publicando...');
  const r = await bg('fb-test');
  show(r.error || `Publicado: ${r.code}. Confira em Meus Fretes e depois clique em Excluir frete de teste.`);
  fbRefresh();
};
document.getElementById('fbdel').onclick = async () => {
  const r = await bg('fb-delete');
  show(r.error || `Excluido: ${r.deleted}.`);
  fbRefresh();
};
document.getElementById('fbfill').onclick = async () => {
  show('Abrindo a aba em segundo plano e preenchendo... (pode levar ate 1 minuto)');
  const r = await bg('fb-fill');
  show(r.error || (r.ok ? `Preenchido (${r.done} passos). Confira na aba que abriu e clique em Publicar Frete.` : `Parou no passo ${r.step}: ${r.error}`));
};
