// Painel do programa: servidor local (so este computador, com chave) + pagina de controle.
const http = require('http'), crypto = require('crypto');

const HTML = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bot de Fretes</title>
<style>
:root{--bg:#f4f6f9;--card:#fff;--tx:#1b2430;--mut:#667085;--bd:#e3e8ef;--az:#2563eb;--vd:#15803d;--vm:#b91c1c;--am:#b45309}
@media(prefers-color-scheme:dark){:root{--bg:#10151c;--card:#18202a;--tx:#e7ecf3;--mut:#93a0b2;--bd:#273241;--az:#5b8cff;--vd:#4ade80;--vm:#f87171;--am:#fbbf24}}
*{box-sizing:border-box}body{margin:0;font:14px system-ui,Segoe UI,sans-serif;background:var(--bg);color:var(--tx)}
main{max-width:980px;margin:0 auto;padding:16px}h1{font-size:18px;margin:0 0 12px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:14px;margin-bottom:12px}
.top{display:flex;gap:16px;align-items:center;flex-wrap:wrap}.dot{width:12px;height:12px;border-radius:50%;background:var(--mut)}
.big{font-size:20px;font-weight:600}.fila{margin-left:auto;text-align:center}.fila b{font-size:28px;display:block}
button{font:inherit;padding:8px 12px;border-radius:8px;border:1px solid var(--bd);background:var(--card);color:var(--tx);cursor:pointer}
button.p{background:var(--az);color:#fff;border-color:var(--az)}button.r{color:var(--vm)}button:disabled{opacity:.5;cursor:default}
.btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--bd);font-size:13px}th{color:var(--mut);font-weight:500}
.ok{color:var(--vd)}.er{color:var(--vm)}.mut{color:var(--mut)}pre{margin:0;max-height:160px;overflow:auto;font:12px ui-monospace,Consolas,monospace;white-space:pre-wrap}
form{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--mut)}
input,select{font:inherit;padding:7px;border-radius:6px;border:1px solid var(--bd);background:var(--bg);color:var(--tx)}label.c{flex-direction:row;align-items:center;gap:8px;color:var(--tx);font-size:13px}
.aviso{background:#fff7e6;color:#7a4b00;border:1px solid #f5d28a;border-radius:8px;padding:10px;margin-bottom:12px}@media(prefers-color-scheme:dark){.aviso{background:#3a2d10;color:#fbd38d;border-color:#6b4f12}}
</style><main>
<h1>Bot de Fretes</h1>
<div class="card"><div class="top"><span class="dot" id="dot"></span><div><div class="big" id="fase">...</div><div class="mut" id="motivo"></div></div>
<div class="fila"><b id="fila">0</b><span class="mut">na fila</span></div></div>
<div class="btns"><button class="p" id="agora">Sincronizar agora</button><button id="pausa">Pausar</button><button id="retoma" hidden class="p">Retomar</button>
<button id="nav">Mostrar navegador do bot</button><button id="gravar">Gravar relatório</button><button id="parar" hidden class="r">Parar e salvar relatório</button></div></div>
<div class="aviso" id="avisoCfg" hidden>Preencha as configurações abaixo e clique em Salvar para o bot começar.</div>
<div class="card"><b>Histórico</b><table><thead><tr><th>Hora</th><th>Ação</th><th>Frete</th><th>Código</th><th>Resultado</th></tr></thead><tbody id="hist"></tbody></table></div>
<div class="card"><b>Configurações</b><br><br><form id="f">
<label>Link do app da web (termina em /exec)<input name="url" placeholder="https://script.google.com/.../exec"></label>
<label>Senha da planilha<input name="token" type="password" placeholder="(deixe vazio para manter)"></label>
<label>E-mail da Central (login automático)<input name="usuario"></label>
<label>Senha da Central<input name="senhaFretebras" type="password" placeholder="(deixe vazio para manter)"></label>
<label>Fretes por rodada (até 50)<input name="limite" type="number" min="1" max="50"></label>
<label>Abas ao mesmo tempo (1 a 5)<input name="abas" type="number" min="1" max="5"></label>
<label>De quantos em quantos minutos<input name="minutos" type="number" min="1"></label>
<label>Ao fechar<select name="fechar"><option value="excluir">Excluir</option><option value="desativar">Desativar</option></select></label>
<label class="c"><input type="checkbox" name="apagarTudo"> Apagar todos os MEUS fretes antes de republicar</label>
<label class="c"><input type="checkbox" name="conferirZero"> Conferir que não sobrou nenhum frete meu antes de publicar</label>
<div><button class="p" type="submit">Salvar</button> <span id="msg" class="mut"></span></div></form></div>
<div class="card"><b>Mensagens</b><pre id="logs"></pre></div></main>
<script>
const K=new URLSearchParams(location.search).get('k'),$=id=>document.getElementById(id);
const api=(p,b)=>fetch('/api/'+p,{method:b?'POST':'GET',headers:{'x-k':K,'content-type':'application/json'},body:b?JSON.stringify(b):undefined}).then(r=>r.json());
const COR={rodando:'--vd',pausado:'--vm',login:'--am',configurar:'--am',gravando:'--vm',parado:'--mut'};
const TXT={rodando:'Rodando',pausado:'Pausado',login:'Aguardando login na Central',configurar:'Falta configurar',gravando:'Gravando',parado:'Parado',iniciando:'Iniciando...'};
let preenchido=false;
async function atualiza(){
  let s;try{s=await api('estado')}catch{$('fase').textContent='Programa fechado';return}
  const e=s.estado;$('fase').textContent=TXT[e.fase]||e.fase;$('motivo').textContent=e.motivo||'';$('fila').textContent=e.fila||0;
  $('dot').style.background='var('+(COR[e.fase]||'--mut')+')';
  $('avisoCfg').hidden=e.fase!=='configurar';$('retoma').hidden=!e.erroPausa;$('pausa').hidden=!!e.erroPausa||e.fase==='gravando';
  $('pausa').textContent=e.pausadoUsuario?'Continuar':'Pausar';$('gravar').hidden=e.fase==='gravando';$('parar').hidden=e.fase!=='gravando';
  $('agora').disabled=e.fase!=='rodando';
  if(!preenchido||e.fase==='configurar'&&!document.activeElement.form){for(const [k,v] of Object.entries(s.cfg)){const i=$('f').elements[k];if(!i)continue;if(i.type==='checkbox')i.checked=!!v;else if(i.type!=='password')i.value=v??''}preenchido=true}
  $('hist').innerHTML=s.historico.map(h=>'<tr><td>'+new Date(h.t).toLocaleTimeString('pt-BR')+'</td><td>'+h.tipo+' (linha '+h.linha+')</td><td>'+(h.frete||'')+'</td><td>'+(h.codigo||'')+'</td><td class="'+(/ERRO|INCERTA/.test(h.status)?'er':'ok')+'">'+h.status+'</td></tr>').join('')||'<tr><td colspan=5 class="mut">Nada ainda.</td></tr>';
  $('logs').textContent=s.logs.join('\\n');
}
for(const [id,a] of [['agora','agora'],['pausa','pausa'],['retoma','retoma'],['nav','navegador'],['gravar','gravar'],['parar','parar']])$(id).onclick=async()=>{await api('acao',{acao:a});atualiza()};
$('f').onsubmit=async ev=>{ev.preventDefault();const o={};for(const i of $('f').elements){if(!i.name)continue;o[i.name]=i.type==='checkbox'?i.checked:i.value}
  const r=await api('cfg',o);$('msg').textContent=r.erro?r.erro:'Salvo.';$('msg').className=r.erro?'er':'ok';atualiza()};
atualiza();setInterval(atualiza,2000);
</script></html>`;

function criarPainel({ estado, aoSalvar, aoAcao }) {
  const chave = crypto.randomBytes(12).toString('hex');
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const j = (o, c = 200) => (res.writeHead(c, { 'content-type': 'application/json' }), res.end(JSON.stringify(o)));
    if (u.pathname === '/' && u.searchParams.get('k') === chave) return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }), res.end(HTML);
    if (!u.pathname.startsWith('/api/') || req.headers['x-k'] !== chave) return res.writeHead(403).end('negado');
    let corpo = ''; req.on('data', d => { corpo += d; });
    req.on('end', async () => {
      try {
        if (u.pathname === '/api/estado') return j(await estado());
        const b = corpo ? JSON.parse(corpo) : {};
        if (u.pathname === '/api/cfg') return j(await aoSalvar(b));
        if (u.pathname === '/api/acao') return j(await aoAcao(b.acao));
        j({ erro: 'rota desconhecida' }, 404);
      } catch (e) { j({ erro: String(e.message || e) }, 500); }
    });
  });
  return new Promise(ok => srv.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${srv.address().port}/?k=${chave}`, fechar: () => srv.close() })));
}

module.exports = { criarPainel };
