// Main World, document_start: monkey patch de fetch e XHR. Guarda as ultimas chamadas em window.__MSPA_NET.
(() => {
  if (window.__MSPA_NET) return;
  const MAX = 800, BODY = 20000;
  const log = window.__MSPA_NET = [];
  const NOISE = /google-analytics\.com|analytics\.google\.com|googletagmanager\.com|doubleclick\.net|google\.com\/(g|ccm|rmkt|measurement)\/|facebook\.com\/tr|clarity\.ms|hotjar|\/tracking\/tracking|\.run\.app\/events/;
  // Gravacao ligada (sobrevive a F5 pelo sessionStorage): cada chamada vai na hora para o armazenamento da extensao.
  try { window.__MSPA_REC_ON = sessionStorage.getItem('mspa-rec') || null; } catch {}
  const push = e => {
    if (NOISE.test(e.url)) return;
    log.push(e);
    if (log.length > MAX) log.shift();
    if (window.__MSPA_REC_ON) window.postMessage({ mspa: 'rec-step', step: { ...e, type: 'request', via: e.type, recId: window.__MSPA_REC_ON } }, '*');
  };
  const cut = t => (t.length > BODY ? t.slice(0, BODY) + '…' : t);
  // shortcut: mascara so senha/token/codigo de login em JSON e form-urlencoded; corpo em outro formato sai como esta.
  // "code" so no formato de formulario (login OAuth): em JSON "code" e o codigo do frete e precisa aparecer.
  const mask = t => cut(t)
    .replace(/(^|[?&"{,\s])((?:password|passwd|senha|secret|authorization|code_verifier|\w*token\w*)"?\s*[:=]\s*)("[^"]*"|[^&,}\s]*)/gi, '$1$2"***"')
    .replace(/(^|[?&])(code=)[^&\s]*/g, '$1$2***');
  const textual = ct => /json|text\/|xml|javascript|graphql/i.test(ct || '');
  const abs = u => { try { return new URL(u, location.href).href; } catch { return String(u); } };

  // Sessao da Fretebras: quando o site faz login/renova, manda o token para o background (fica so na memoria
  // do navegador, nunca no JSON). Junto vao os cabecalhos que o site usa na API, menos o de login.
  const FB_SITE = location.hostname === 'novacentral.fretebras.com.br';
  const LOGIN = /\/protocol\/openid-connect\/token/;
  const FB_API = /^https:\/\/nca-gateway\.fretebras\.com\.br\//;
  let headersSent = false;
  const session = data => FB_SITE && window.postMessage({ mspa: 'session', ...data }, location.origin);
  const tokenFrom = text => {
    try {
      const t = JSON.parse(text);
      if (t.access_token && t.refresh_token) session({ token: { access_token: t.access_token, refresh_token: t.refresh_token, expires_in: t.expires_in, refresh_expires_in: t.refresh_expires_in } });
    } catch {}
  };
  const headersFrom = (url, h) => {
    if (headersSent || !FB_SITE || !FB_API.test(url) || !h) return;
    const o = {};
    new Headers(h).forEach((v, k) => { if (!/^(authorization|content-type|content-length|cookie)$/.test(k)) o[k] = v; });
    headersSent = true;
    session({ headers: o });
  };

  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const isReq = input instanceof Request;
    const e = {
      type: 'fetch',
      method: ((init && init.method) || (isReq && input.method) || 'GET').toUpperCase(),
      url: abs(isReq ? input.url : input),
      t: Date.now(),
    };
    if (init && typeof init.body === 'string') e.reqBody = mask(init.body);
    headersFrom(e.url, (init && init.headers) || (isReq && input.headers));
    try {
      const res = await origFetch.apply(this, arguments);
      if (LOGIN.test(e.url) && res.ok) res.clone().text().then(tokenFrom, () => {});
      e.status = res.status;
      e.ms = Date.now() - e.t;
      e.contentType = res.headers.get('content-type');
      // anota depois de ler a resposta, para a gravacao levar o corpo junto
      if (textual(e.contentType)) res.clone().text().then(b => { e.resBody = mask(b); }, () => {}).then(() => push(e));
      else push(e);
      return res;
    } catch (err) {
      e.error = String(err);
      push(e);
      throw err;
    }
  };

  const X = XMLHttpRequest.prototype, open = X.open, send = X.send, setHeader = X.setRequestHeader;
  X.setRequestHeader = function (k, v) { (this.__mspaH = this.__mspaH || {})[k] = v; return setHeader.apply(this, arguments); };
  X.open = function (method, url) {
    this.__mspa = { type: 'xhr', method: String(method).toUpperCase(), url: abs(url) };
    return open.apply(this, arguments);
  };
  X.send = function (body) {
    const e = this.__mspa;
    if (e) {
      e.t = Date.now();
      if (typeof body === 'string') e.reqBody = mask(body);
      headersFrom(e.url, this.__mspaH);
      this.addEventListener('loadend', () => {
        if (LOGIN.test(e.url) && this.status === 200 && (this.responseType === '' || this.responseType === 'text')) tokenFrom(this.responseText);
        e.status = this.status;
        e.ms = Date.now() - e.t;
        e.contentType = this.getResponseHeader('content-type');
        if ((this.responseType === '' || this.responseType === 'text') && textual(e.contentType)) e.resBody = mask(this.responseText);
        push(e);
      });
    }
    return send.apply(this, arguments);
  };
})();
