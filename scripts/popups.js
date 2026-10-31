// Fecha avisos/anuncios da Central que atrapalham o bot. So clica em botao de dispensar; nunca em compra ou decisao.
(() => {
  if (window.__MSPA_POP || !/fretebras\.com\.br$|^127\.0\.0\.1$/.test(location.hostname)) return;
  window.__MSPA_POP = 1;
  const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  // se a caixa fala disso, e do fluxo do bot ou envolve dinheiro: nao mexe
  const PROTEGIDO = /excluir|desativar|ativar|publicar|confirmar|tem certeza|atualizar|cancelar|criar modelo|comprar|destaque|cupom|fatura|pagamento|\br\$/;
  const FECHAR = /^(fechar|agora nao|depois|mais tarde|entendi|pular|dispensar|nao, obrigad[oa]|nao quero|lembrar depois|aceitar|aceitar todos|concordo|ok, entendi|x|×)$/;
  const visivel = e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  // Avisos no canto da tela (toasts): so os de propaganda/aviso do site, fechados pelo "X" (botao sem texto).
  // Os avisos que o bot espera ("Frete publicado", "foi excluido"...) nao entram aqui, e botoes com texto ("Ir para Desativados") nunca sao clicados.
  const ANUNCIO = /promocao|aproveite|automaticamente|novidade|conheca|oferta|desconto|indique|ganhe|visto por mais/;
  const FLUXO = /excluir frete|desativar frete|publicar|confirmar|tem certeza|sucesso|frete publicado|foi (excluido|desativado)/;
  const fechaToast = () => {
    for (const el of document.querySelectorAll('div,section,aside')) {
      if (el.offsetParent !== null || !visivel(el) || el.closest('#mspa-fill,#mspa-rec,#mspa-panel')) continue; // so elementos fixos
      const r = el.getBoundingClientRect();
      if (r.width < 150 || r.width > 700 || r.height > 400 || getComputedStyle(el).position !== 'fixed') continue;
      const t = norm(el.innerText);
      if (!ANUNCIO.test(t) || FLUXO.test(t)) continue;
      const x = [...el.querySelectorAll('button,[role=button]')].find(b => visivel(b) && !norm(b.innerText));
      if (!x) continue;
      console.log('[mspa-popup] fechei: ' + t.slice(0, 120));
      x.click();
      return true;
    }
    return false;
  };
  setInterval(() => {
    if (fechaToast()) return;
    for (const cx of document.querySelectorAll('[role=dialog],[role=alertdialog],[aria-modal=true],[class*=modal i],[class*=popup i],[class*=overlay i],[class*=cookie i],[class*=banner i]')) {
      if (!visivel(cx) || cx.closest('#mspa-fill,#mspa-rec,#mspa-panel') || PROTEGIDO.test(norm(cx.innerText))) continue;
      const botoes = [...cx.querySelectorAll('button,[role=button],a')].filter(visivel);
      const alvo = botoes.find(b => FECHAR.test(norm(b.innerText)) || /^(fechar|close)/.test(norm(b.getAttribute('aria-label'))));
      if (!alvo) continue;
      console.log('[mspa-popup] fechei: ' + (cx.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120));
      alvo.click();
      return; // um por vez
    }
  }, 1000);
})();
