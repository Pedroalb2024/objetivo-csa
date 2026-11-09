// Servidor local para ver o sistema sem publicar: planilha em memória com a escola de exemplo (nomes fictícios).
// Uso: node tests/local.js  → http://localhost:8787  (usuário: admin / senha: teste)
//   ?form=1               formulário dos professores
//   ?auto=1               entra direto como admin
//   ?tela=grade           abre uma tela        &depois=<js>  roda um código depois de abrir (para prints)
// Nada aqui vai para o Apps Script; o google.script.run é simulado chamando o Codigo.js no Node.
const http = require('http'), fs = require('fs'), path = require('path');
const { criarAmbiente } = require('./ambiente');
const DIR = path.join(__dirname, '..', 'apps-script'), DOCS = path.join(__dirname, '..', 'docs'), PORTA = +process.env.PORTA || 8787;

const amb = criarAmbiente();
amb.ctx.gravarExemplo_();
amb.ctx.gravar_('Usuários', [['admin', 'teste', 'Coordenação (teste)', 'admin', 'Sim', '']]);
// Já deixa uma grade oficial salva, gerada pelo próprio gerador
amb.gerador().gerar(amb.dados(), { tentativas: 8, semente: 11 }, null, r => {
  if (r.opcoes.length) amb.ctx.salvarGrade_({ grade: r.opcoes[0].grade });
  console.log(r.opcoes.length ? 'Grade oficial de exemplo gerada.' : 'Não gerou a grade de exemplo: ' + r.gargalos.join(' | '));
});

const cfg = { escola: 'Objetivo CSA', credito: 'ALBIX', logo: 'docs/logo.png', logoBranco: 'docs/logo-branco.png' };
function pagina(arquivo, q) {
  let html = fs.readFileSync(path.join(DIR, arquivo), 'utf8')
    .replace(/<\?!= incluir_\('(\w+)'\); \?>/g, (_, f) => fs.readFileSync(path.join(DIR, f + '.html'), 'utf8'))
    .replace('<?!= JSON.stringify(cfg) ?>', JSON.stringify(cfg));
  let antes = `<link rel="icon" href="docs/icone.png"><script>
    function runner(ok, falha) { return new Proxy({}, { get(_, k) {
      if (k === 'withSuccessHandler') return f => runner(f, falha);
      if (k === 'withFailureHandler') return f => runner(ok, f);
      return (...args) => fetch('rpc', { method: 'POST', body: JSON.stringify({ fn: k, args }) }).then(r => r.json())
        .then(r => r.erro ? falha && falha(new Error(r.erro)) : ok && ok(r.ok));
    } }); }
    window.google = { script: { run: runner() } };`;
  if (q.get('auto')) antes += `sessionStorage.setItem('gh_token', ${JSON.stringify(amb.ctx.login('admin', 'teste').token)});`;
  antes += '</script>';
  let depois = '';
  const pronto = arquivo === 'App.html' ? `typeof D !== 'undefined' && D && !document.getElementById('app').hidden` : `typeof INFO !== 'undefined' && INFO`;
  if (q.get('tela') || q.get('depois')) depois = `<script>(function esperar() { if (!(${pronto})) return setTimeout(esperar, 50);
    ${q.get('tela') ? `ir(${JSON.stringify(q.get('tela'))}, true);` : ''} setTimeout(() => { ${q.get('depois') || ''} }, 50); })();</script>`;
  return html.replace('<meta charset="utf-8">', '<meta charset="utf-8">' + antes).replace('</body>', depois + '</body>');
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http:\/\/x');
  if (req.method === 'POST' && u.pathname === '/rpc') {
    let corpo = ''; req.on('data', c => corpo += c);
    req.on('end', () => {
      const { fn, args } = JSON.parse(corpo); let r;
      try { if (/_$/.test(fn) || typeof amb.ctx[fn] !== 'function') throw new Error('Função não pública: ' + fn); r = { ok: JSON.parse(JSON.stringify(amb.ctx[fn](...args) ?? null)) }; }
      catch (e) { r = { erro: e.message }; }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r));
    });
    return;
  }
  if (u.pathname.startsWith('/docs/')) {
    const f = path.join(DOCS, path.basename(u.pathname));
    if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(fs.readFileSync(f)); }
    res.writeHead(404); return res.end();
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(pagina(u.searchParams.has('form') ? 'Formulario.html' : 'App.html', u.searchParams));
}).listen(PORTA, () => console.log(`Grade Horária local: http:\/\/localhost:${PORTA}  (admin / teste)`));
