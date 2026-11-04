// Confere o JavaScript de cada página .html do Apps Script.
// Simula o que o Apps Script faz ao servir a página: corta tudo de "//" até o fim da linha.
// Se um "//" estiver dentro de uma string (ex.: 'https://...'), o código quebra e a página fica em branco.
// Uso: node tests/checar.js   (roda também no GitHub Action antes de publicar)
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = path.join(__dirname, '..', 'apps-script');
let falhas = 0;

for (const arq of fs.readdirSync(dir).filter(f => f.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(dir, arq), 'utf8');
  const blocos = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const antes = falhas;
  blocos.forEach((m, i) => {
    const js = m[1], base = html.slice(0, m.index).split('\n').length - 1;
    const servido = js
      .replace(/<\?!?=[\s\S]*?\?>/g, '{}')          // tags do template viram um valor qualquer
      .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
    try { new vm.Script(servido, { filename: arq }); }
    catch (e) {
      falhas++;
      console.error(`✗ ${arq} (script ${i + 1}): ${e.message}`);
      const linhas = js.split('\n').map((l, n) => [n + 1, l]).filter(([, l]) => /\/\//.test(l.replace(/^\s*\/\/.*/, '')) && !/^\s*\/\//.test(l));
      linhas.slice(0, 5).forEach(([n, l]) => console.error(`    linha ${base + n} tem "//" no meio do código: ${l.trim().slice(0, 100)}`));
    }
  });
  if (blocos.length && falhas === antes) console.log(`✓ ${arq}`);
}
try { new vm.Script(fs.readFileSync(path.join(dir, 'Codigo.js'), 'utf8'), { filename: 'Codigo.js' }); console.log('✓ Codigo.js'); }
catch (e) { falhas++; console.error('✗ Codigo.js: ' + e.message); }

if (falhas) { console.error(`\n${falhas} problema(s). Use 'https:\\/\\/...' em vez de 'https://...' dentro dos .html.`); process.exit(1); }
console.log('\nTudo certo.');
