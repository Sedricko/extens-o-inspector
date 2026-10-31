// Linha da planilha -> passos do preenchimento do formulario "Criar frete".
// Usado pelo background (importScripts) e pela pagina do lote.
const linhaNorm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const linhaEsc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const LINHA_COLUNAS = {
  origem: ['origem'], destino: ['destino'], produto: ['produto'], valor: ['valor'], peso: ['peso'], paletes: ['paletes'],
  veiculo: ['veiculo'], carroceria: ['carroceria'], rastreada: ['rastreada', 'rastreador'], lona: ['lona'],
  pagamento: ['pagamento'], observacoes: ['observacoes', 'observacao', 'obs'], especie: ['especie'],
  status: ['status', 'situacao'], codigo: ['codigo', 'codigodofrete'],
};
const CARROCERIAS = ['Caçamba', 'Grade Baixa', 'Graneleiro', 'Plataforma', 'Prancha', 'Baú', 'Baú Frigorífico', 'Baú Refrigerado', 'Sider',
  'Apenas Cavalo', 'Bug Porta Container', 'Cavaqueira', 'Cegonheiro', 'Gaiola', 'Hopper', 'Munck', 'Silo', 'Tanque'];
const PAGAMENTOS = { pix: 'Pix', ted: 'TED', cartao: 'Crédito em cartão', 'credito em cartao': 'Crédito em cartão', cheque: 'Cheque', efrete: 'E-frete', 'e-frete': 'E-frete', outro: 'Outro' };

const LINHA_PADRAO = {
  origem: 'EXTREMA/MG', destino: 'FRUTAL/MG', produto: 'MATERIAL DE EMBALAGEM - PALLET', valor: 'A combinar', peso: '25 Ton', paletes: '28 PAL',
  veiculo: 'Carreta', carroceria: 'SIDER', rastreada: 'Sim', lona: 'Não', pagamento: 'Outro', observacoes: '', especie: '',
};

// Texto (colado do Google Sheets = tabulacao, ou CSV com ; ou ,) -> lista de objetos por coluna conhecida.
function linhasDeTexto(texto) {
  texto = String(texto).replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  const cab = texto.split('\n', 1)[0];
  const sep = ['\t', ';', ','].map(s => [s, cab.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const grade = []; let cel = '', lin = [], asp = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (asp) { if (c === '"' && texto[i + 1] === '"') { cel += '"'; i++; } else if (c === '"') asp = false; else cel += c; }
    else if (c === '"') asp = true;
    else if (c === sep) { lin.push(cel); cel = ''; }
    else if (c === '\n') { lin.push(cel); grade.push(lin); lin = []; cel = ''; }
    else cel += c;
  }
  lin.push(cel); grade.push(lin);
  const chaves = grade[0].map(h => { const k = linhaNorm(h).replace(/[^a-z]/g, ''); return Object.keys(LINHA_COLUNAS).find(n => LINHA_COLUNAS[n].includes(k)); });
  return grade.slice(1).filter(l => l.some(c => c.trim())).map(l => Object.fromEntries(chaves.map((k, i) => k && [k, (l[i] || '').trim()]).filter(Boolean)));
}

const linhaLista = t => String(t || '').split(/\s*(?:[+,;]|\be\b)\s*/i).map(s => s.trim()).filter(Boolean);
const linhaCidade = t => {
  const m = String(t || '').trim().match(/^(.+?)\s*[\/-]\s*([A-Za-z]{2})$/);
  return m && { nome: m[1].trim(), uf: m[2].toUpperCase() };
};

// Ja publicada pela planilha (coluna CODIGO preenchida ou STATUS "Publicado").
const linhaJaPublicada = l => !!(l.codigo || /^publicad/.test(linhaNorm(l.status)));
// Identifica o frete pelo conteudo (sem STATUS/CODIGO): a mesma linha colada de novo gera a mesma chave.
const linhaChave = l => JSON.stringify(['origem', 'destino', 'produto', 'peso', 'paletes', 'veiculo', 'carroceria', 'rastreada', 'lona', 'pagamento', 'valor', 'observacoes', 'especie'].map(k => linhaNorm(l[k])));

// -> { passos, erros: [] }  (erros vazio = pode publicar)
function linhaParaPassos(l) {
  const erros = [];
  const org = linhaCidade(l.origem), dst = linhaCidade(l.destino);
  if (!org) erros.push('ORIGEM deve ser CIDADE/UF');
  if (!dst) erros.push('DESTINO deve ser CIDADE/UF');
  const produto = String(l.produto || '').replace(/\s*\|\s*/g, ' - ').trim(); // o site nao aceita "|"
  if (!produto) erros.push('PRODUTO vazio');
  const pm = String(l.peso || '').match(/^\s*(\d+(?:[.,]\d+)?)/);
  const peso = pm && Number(pm[1].replace(',', '.'));
  if (!peso || peso > 50) erros.push('PESO deve ser de 1 a 50 toneladas');
  const veiculos = linhaLista(l.veiculo);
  if (!veiculos.length) erros.push('VEICULO vazio');
  const carrocerias = linhaLista(l.carroceria).map(c => CARROCERIAS.find(k => linhaNorm(k) === linhaNorm(c)) || (erros.push(`CARROCERIA desconhecida: ${c}`), null));
  if (!carrocerias.length) erros.push('CARROCERIA vazia');
  const pagamentos = linhaLista(l.pagamento).map(p => PAGAMENTOS[linhaNorm(p)] || (erros.push(`PAGAMENTO desconhecido: ${p}`), null));
  if (!pagamentos.length) erros.push('PAGAMENTO vazio');
  const rast = linhaNorm(l.rastreada);
  if (!['sim', 'nao'].includes(rast)) erros.push('RASTREADA deve ser Sim ou Não');
  if (linhaNorm(l.lona) === 'sim') erros.push('LONA: Sim ainda nao e suportado');
  if (linhaNorm(l.valor) !== 'a combinar') erros.push('VALOR: so "A combinar" e suportado por enquanto');
  const obs = [l.paletes && `PALETES: ${l.paletes}`, l.observacoes].filter(Boolean).join('; ');
  if (erros.length) return { passos: [], erros };

  return {
    erros,
    passos: [
      { type: 'text', label: 'Local da coleta', value: org.nome, pick: `${org.nome} - ${org.uf}` },
      { type: 'text', label: 'Local da entrega', value: dst.nome, pick: `${dst.nome} - ${dst.uf}` },
      { type: 'pick', open: 'Tipo da carga', text: 'Carga Geral' }, // a Especie so habilita depois do Tipo
      { type: 'pick', open: 'Espécie da carga', text: l.especie || 'Pallet' },
      { type: 'text', label: 'Qual produto será carregado?', value: produto, max: 30 }, // o site aceita 30
      { type: 'toggle', text: 'Conforme peso da carga' },
      { type: 'text', label: 'Peso total em toneladas', value: String(peso).replace('.', ',') },
      { type: 'switch', label: 'Precisa de rastreador?', on: rast === 'sim' },
      ...(obs ? [{ type: 'text', label: 'Observações adicionais', value: obs.slice(0, 500), tag: 'textarea' }] : []),
      ...veiculos.map(v => ({ type: 'toggle', text: { re: `^${linhaEsc(linhaNorm(v))} (sugerido )?\\d+ eixos` } })),
      ...carrocerias.map(text => ({ type: 'toggle', text })),
      { type: 'toggle', text: 'A combinar' },
      ...pagamentos.map(text => ({ type: 'toggle', text })),
      { type: 'toggle', text: { start: 'Plus Alta exposição' } },
    ],
  };
}
