// Testes do servidor (Codigo.js) e do gerador (Gerador.html) com a escola de exemplo e casos pequenos.
// Uso: node tests/gerador.js
const { criarAmbiente } = require('./ambiente'), vm = require('vm');
let falhas = 0, total = 0;
const ok = (cond, msg) => { total++; if (!cond) { falhas++; console.error('  ✗ ' + msg); } };
const caso = async (nome, fn) => { const f0 = falhas; try { await fn(); } catch (e) { falhas++; console.error('  ✗ erro: ' + (e.stack || e)); } console.log((falhas === f0 ? '✓ ' : '✗ ') + nome); };
const gerar = (G, D, opt) => new Promise(r => G.gerar(D, opt, null, r));
const reencaixar = (G, D, g, alvo) => new Promise(r => G.reencaixar(D, g, alvo, r));
const min = h => { const [a, b] = h.split(':').map(Number); return a * 60 + b; };

// Checagem independente do gerador: professor nunca em dois lugares no mesmo minuto (turmas juntas contam uma vez)
function sobreposicoes(D, grade) {
  const aulas = {}, por = {};
  D.grades.forEach(g => aulas[g.nome] = g.itens.filter(i => i.tipo === 'aula').map(i => [min(i.ini), min(i.fim)]));
  const gradeDe = {}; D.turmas.forEach(t => gradeDe[t.nome] = t.grade);
  Object.entries(grade).forEach(([k, c]) => {
    const [t, d, a] = k.split('|'), x = aulas[gradeDe[t]][+a], kk = c.professor + '|' + d;
    (por[kk] = por[kk] || new Map()).set(x.join('-') + '|' + c.disciplina, x);
  });
  let n = 0;
  Object.values(por).forEach(m => { const l = [...m.values()].sort((x, y) => x[0] - y[0]); for (let i = 1; i < l.length; i++) if (l[i][0] < l[i - 1][1]) n++; });
  return n;
}

// Escola mínima para casos pequenos
function mini(extra) {
  return Object.assign({
    dias: ['Seg'],
    grades: [
      { nome: 'EFAI', itens: [['07:00', '07:40'], ['07:40', '08:20'], ['08:50', '09:30'], ['09:30', '10:10']].map(([ini, fim]) => ({ tipo: 'aula', ini, fim })) },
      { nome: 'EFAF', itens: [['07:10', '08:00'], ['08:00', '08:50'], ['08:50', '09:40'], ['10:10', '11:00']].map(([ini, fim]) => ({ tipo: 'aula', ini, fim })) },
    ],
    professores: [{ nome: 'P', indisp: [] }, { nome: 'Q', indisp: [] }, { nome: 'R', indisp: [] }],
    turmas: [{ nome: '1A', segmento: 'EFAI', grade: 'EFAI' }, { nome: '6A', segmento: 'EFAF', grade: 'EFAF' }],
    carga: [], fixas: [], blocos: [],
  }, extra);
}

(async () => {
  const amb = criarAmbiente();
  amb.ctx.gravarExemplo_();
  const D = amb.dados(), G = amb.gerador();
  let oficial = null;

  await caso('Exemplo: estrutura real (grades, turmas, matriz, extras, turmas juntas)', () => {
    ok(D.grades.length === 7, '7 grades de horário');
    ok(D.turmas.filter(t => t.segmento !== 'Extra').length === 31, '31 turmas regulares');
    ok(D.turmas.filter(t => t.segmento === 'Extra').length === 11, '11 grupos EXTRA');
    ok(D.professores.length >= 35, 'cerca de 35+ professores');
    const soma = {}; D.matriz.forEach(m => soma[m.serie] = (soma[m.serie] || 0) + m.aulas);
    Object.entries(soma).forEach(([s, n]) => ok(n === 30, `matriz do ${s} soma 30 (deu ${n})`));
    ok(Object.keys(soma).length === 12, '12 séries na matriz');
    ok(D.carga.some(c => c.turmas.join('+') === '5A+5B' && c.disciplina === 'Educação Física'), 'Ed. Física 5A + 5B junta');
    ok(D.carga.some(c => c.turmas.length > 1 && c.disciplina === 'Teatro'), 'Teatro com turmas juntas');
    ok(D.blocos.some(b => b.tipo === 'Plantão de Dúvidas' && b.disciplina), 'plantão com disciplina');
    const M = G.modelo(D);
    ok(M.erros.length === 0, 'modelo sem erros: ' + M.erros.slice(0, 3).join(' | '));
    ok(M.avisos.length === 0, 'turmas regulares completas: ' + M.avisos.slice(0, 3).join(' | '));
  });

  await caso('Exemplo: gera sem conflitos (tempo real, blocos, duplas, turmas juntas)', async () => {
    const t = Date.now(), r = await gerar(G, D, { tentativas: 6, semente: 7 });
    ok(r.opcoes.length > 0, 'gerou pelo menos uma opção (gargalos: ' + r.gargalos.join(' | ') + ')');
    if (!r.opcoes.length) return;
    oficial = r.opcoes[0].grade;
    const v = G.validar(D, oficial);
    ok(v.problemas.length === 0, 'validação sem problemas: ' + v.problemas.slice(0, 3).join(' | '));
    ok(sobreposicoes(D, oficial) === 0, 'nenhum professor em dois lugares (checagem independente)');
    ok(['Seg', 'Ter', 'Qua', 'Qui', 'Sex'].every((_, d) => [0, 1, 2, 3, 4, 5].every(a => {
      const x = oficial[`5A|${d}|${a}`], y = oficial[`5B|${d}|${a}`];
      return (x && x.disciplina === 'Educação Física') === (y && y.disciplina === 'Educação Física');
    })), 'Ed. Física de 5A e 5B sempre no mesmo horário');
    ok(Date.now() - t < 60000, 'rápido (' + (Date.now() - t) + ' ms)');
  });

  await caso('Sobreposição entre segmentos é detectada (7:40–8:20 EFAI × 8:00–8:50 EFAF)', async () => {
    const d = mini({ carga: [{ turmas: ['1A'], disciplina: 'Inglês', professor: 'P', aulas: 1, duplas: 0, maxDia: 1 }, { turmas: ['6A'], disciplina: 'Inglês', professor: 'P', aulas: 1, duplas: 0, maxDia: 1 }] });
    const ruim = G.validar(d, { '1A|0|1': { disciplina: 'Inglês', professor: 'P' }, '6A|0|1': { disciplina: 'Inglês', professor: 'P' } });
    ok(ruim.problemas.some(p => /dois lugares/.test(p)), 'conflito apontado');
    ok(ruim.ruins.length === 2, 'as duas aulas marcadas');
    const bom = G.validar(d, { '1A|0|0': { disciplina: 'Inglês', professor: 'P' }, '6A|0|1': { disciplina: 'Inglês', professor: 'P' } });
    ok(!bom.problemas.some(p => /dois lugares/.test(p)), '7:00–7:40 e 8:00–8:50 não conflitam');
    // 1A só pode na 2ª aula (7:40) → o gerador tem de evitar 8:00–8:50 no 6A
    d.carga.push({ turmas: ['1A'], disciplina: 'Port', professor: 'Q', aulas: 3, duplas: 0, maxDia: 3 });
    d.fixas = [{ turma: '1A', dia: 'Seg', aula: 2, disciplina: 'Inglês' }];
    const r = await gerar(G, d, { tentativas: 5, semente: 3 });
    ok(r.opcoes.length > 0, 'gerou');
    r.opcoes.forEach(o => ok(!o.grade['6A|0|1'] && !o.grade['6A|0|0'], 'Inglês do 6A fora de 7:10–8:50'));
  });

  await caso('Disponibilidade por faixa de 1h e blocos do professor', async () => {
    const d = mini({ carga: [{ turmas: ['6A'], disciplina: 'Mat', professor: 'P', aulas: 1, duplas: 0, maxDia: 1 }] });
    d.professores[0].indisp = ['Seg|7'];                 // 7h–8h: proíbe 7:10–8:00 e 8:00–8:50? só a primeira (8:00 não entra em 7h–8h)
    d.blocos = [{ professor: 'P', tipo: 'Complementação de Carga Horária', dia: 'Seg', ini: '08:40', fim: '09:00' }];
    const M = G.modelo(d);
    ok(M.impede(0, 0, min('07:10'), min('08:00')) === 'indisp', '7:10–8:00 cai na faixa 7h');
    ok(M.impede(0, 0, min('08:00'), min('08:50')) === 'Complementação de Carga Horária', '8:00–8:50 bate no bloco 8:40');
    ok(M.impede(0, 0, min('10:10'), min('11:00')) === '', '10:10–11:00 livre');
    const r = await gerar(G, d, { tentativas: 4, semente: 1 });
    r.opcoes.forEach(o => ok(!o.grade['6A|0|0'] && !o.grade['6A|0|1'] && !o.grade['6A|0|2'], 'evita faixa e bloco (8:50–9:40 também bate no bloco)'));
    ok(r.opcoes.length > 0 && r.opcoes.every(o => o.grade['6A|0|3']), 'usa 10:10');
  });

  await caso('Aula dupla não atravessa intervalo', async () => {
    const d = mini({ carga: [{ turmas: ['1A'], disciplina: 'Arte', professor: 'P', aulas: 2, duplas: 1, maxDia: 2 }, { turmas: ['1A'], disciplina: 'Port', professor: 'Q', aulas: 2, duplas: 0, maxDia: 2 }] });
    d.fixas = [{ turma: '1A', dia: 'Seg', aula: 1, disciplina: 'Port' }];   // sobra 2ª, 3ª e 4ª aula; 2ª→3ª atravessa o intervalo
    const r = await gerar(G, d, { tentativas: 5, semente: 2 });
    ok(r.opcoes.length > 0, 'gerou');
    r.opcoes.forEach(o => ok(o.grade['1A|0|2'] && o.grade['1A|0|2'].disciplina === 'Arte' && o.grade['1A|0|3'].disciplina === 'Arte', 'dupla em 8:50–10:10'));
  });

  await caso('Trocar professor: sem mudar ninguém quando possível', async () => {
    if (!oficial) return ok(false, 'sem grade oficial');
    const sai = 'Igor', entra = 'Novo Prof', D2 = JSON.parse(JSON.stringify(D)), g = JSON.parse(JSON.stringify(oficial));
    D2.professores.push({ nome: entra, indisp: [], maxDia: 0 });
    D2.carga.forEach(c => { if (c.professor === sai) c.professor = entra; });
    Object.values(g).forEach(c => { if (c.professor === sai) c.professor = entra; });
    const r = await reencaixar(G, D2, g, entra);
    ok(r.ok && r.modo === 'estrito' && r.outros.length === 0 && r.nAlvo === 0, 'nada muda (modo ' + r.modo + ', outros ' + (r.outros || []).length + ')');
  });

  await caso('Trocar professor: nova disponibilidade, outros professores intactos', async () => {
    if (!oficial) return ok(false, 'sem grade oficial');
    const alvo = 'Joana', D2 = JSON.parse(JSON.stringify(D));
    const minhas = Object.entries(oficial).filter(([, c]) => c.professor === alvo);
    const [k] = minhas[0], [t, ds, as] = k.split('|'), gr = D.grades.find(x => x.nome === D.turmas.find(y => y.nome === t).grade);
    const aula = gr.itens.filter(i => i.tipo === 'aula')[+as], h = Math.floor(min(aula.ini) / 60);
    const p = D2.professores.find(x => x.nome === alvo); p.indisp = p.indisp.concat([D.dias[+ds] + '|' + h]);
    const r = await reencaixar(G, D2, JSON.parse(JSON.stringify(oficial)), alvo);
    ok(r.ok, 'encaixou: ' + (r.gargalos || []).join(' | '));
    if (!r.ok) return;
    ok(r.nAlvo > 0, 'aulas da professora mudaram de horário');
    const v = G.validar(D2, r.grade);
    ok(v.problemas.length === 0, 'grade nova sem problemas: ' + v.problemas.slice(0, 3).join(' | '));
    if (!r.outros.length) {
      const mudouOutro = Object.keys(oficial).some(kk => oficial[kk].professor !== alvo && (!r.grade[kk] || r.grade[kk].disciplina !== oficial[kk].disciplina));
      ok(!mudouOutro, 'nenhuma aula de outro professor mudou');
    } else ok(r.outros.every(o => o.de && o.para), 'lista De → Para preenchida');
  });

  await caso('Trocar professor: impossível sem mexer → muda o mínimo e lista De → Para', async () => {
    const d = mini({ carga: [{ turmas: ['1A'], disciplina: 'A', professor: 'P', aulas: 1, duplas: 0, maxDia: 1 }, { turmas: ['1A'], disciplina: 'B', professor: 'Q', aulas: 1, duplas: 0, maxDia: 1 },
      { turmas: ['1A'], disciplina: 'C', professor: 'R', aulas: 2, duplas: 0, maxDia: 2 }] });
    const g = { '1A|0|0': { disciplina: 'A', professor: 'P' }, '1A|0|1': { disciplina: 'B', professor: 'Q' }, '1A|0|2': { disciplina: 'C', professor: 'R' }, '1A|0|3': { disciplina: 'C', professor: 'R' } };
    d.professores[0].indisp = ['Seg|7'];                   // P não pode 7h–8h (pega 7:00–7:40 e 7:40–8:20) → precisa de uma vaga de C
    const r = await reencaixar(G, d, g, 'P');
    ok(r.ok && r.modo === 'minimo', 'modo mínimo');
    ok(r.ok && r.outros.length === 1 && r.outros[0].disciplina === 'C', 'só uma aula de C muda');
    ok(r.ok && /^Seg (8:50|9:30)/.test(r.outros[0].de) && r.outros[0].para === 'Seg 7:00–7:40', 'De → Para com horário real');
    ok(r.ok && r.grade['1A|0|1'].disciplina === 'B', 'B continua no lugar');
  });

  await caso('Componentes: siglas do aSc mapeiam automaticamente', () => {
    const comps = D.componentes;
    const m = { 'Líng. Port.': 'Língua Portuguesa', 'Ling. Ingl.': 'Língua Inglesa', 'Ling. Esp.': 'Língua Espanhola', 'Mat': 'Matemática', 'Cienc.': 'Ciências',
      'Hist/Geo': 'História/Geografia', 'Hist.': 'História', 'Geo': 'Geografia', 'Proj. V. Int.': 'Projeto de Vida Integrado', 'Proj. Vid.': 'Projeto de Vida',
      'Ed. Financ.': 'Educação Financeira', 'Leit. Prod. Text.': 'Leitura e Produção de Texto', 'Red': 'Redação', 'Lab': 'Laboratório de Ciências',
      'Mat Av.': 'Matemática Avançada', 'Fis Av': 'Física Avançada', 'Bio Av': 'Biologia Avançada', 'Qui Av': 'Química Avançada', 'Geo Av': 'Geografia Avançada',
      'Hist Av': 'História Avançada', 'Hist. Relig.': 'História das Religiões', 'Proj V Empreg': 'Projeto de Vida e Empregabilidade', 'Filo': 'Filosofia', 'Soc': 'Sociologia',
      'Mov.': 'Movimento', 'Maker': 'Maker', 'Licao de Casa': 'Lição de Casa', 'Ativ. Lúd.': 'Atividades Lúdicas', 'Inic. às Lutas': 'Iniciação às Lutas',
      'Lab de Red': 'Laboratório de Redação', 'Recreacao': 'Recreação', 'Ed. Física': 'Educação Física', 'Qui': 'Química', 'Fis': 'Física', 'Bio': 'Biologia' };
    Object.entries(m).forEach(([sig, nome]) => ok(amb.ctx.acharComponente_(sig, comps) === nome, `${sig} → ${nome} (deu "${amb.ctx.acharComponente_(sig, comps)}")`));
  });

  await caso('Matriz: aplicar às turmas preenche a carga e mantém professor e turmas juntas', () => {
    const turmas = D.turmas, linhas = amb.ctx.valores_('Carga');
    const semPort = linhas.filter(r => !(r[0] === '1A' && r[1] === 'Língua Portuguesa')).map(r => r[0] === '2A' && r[1] === 'Matemática' ? [r[0], r[1], r[2], 5, r[4], r[5]] : r);
    const r = amb.ctx.calcMatriz_(turmas, semPort, D.matriz, D.componentes, ['1º ano', '2º ano', '5º ano'], false);
    const nova = r.carga.find(x => x[0] === '1A' && x[1] === 'Língua Portuguesa');
    ok(nova && nova[2] === '' && nova[3] === 7, '1A ganha Língua Portuguesa (7) sem professor');
    const mat = r.carga.find(x => x[0] === '2A' && x[1] === 'Matemática');
    ok(mat && mat[3] === 8 && mat[2] === 'Cecília', '2A Matemática volta a 8 com o mesmo professor');
    ok(r.carga.some(x => x[0] === '5A + 5B' && x[1] === 'Educação Física'), 'turma junta mantida');
    ok(r.mudancas.length === 2, 'duas turmas mudam');
    const D2 = amb.dados(); D2.carga = r.carga.map(x => ({ turmas: x[0].split('+').map(s => s.trim()), disciplina: x[1], professor: x[2], aulas: x[3], duplas: x[4], maxDia: x[5] }));
    ok(G.modelo(D2).erros.some(e => /falta escolher o professor/.test(e)), 'pendência: falta professor');
  });

  await caso('Migração da planilha antiga (turnos, turmas, disponibilidade por aula)', () => {
    const v = criarAmbiente(), ss = v.ss, put = (nome, linhas) => { const a = ss.insertSheet(nome); linhas.forEach((l, i) => a.d[i] = l.slice()); };
    put('Config', [['Turno', 'Aulas por dia', 'Início (hh:mm)', 'Duração da aula (min)', 'Intervalo após a aula nº', 'Duração do intervalo (min)'], ['Manhã', 6, '07:00', 50, 3, 20]]);
    put('Turmas', [['Turma', 'Turno'], ['6º A', 'Manhã'], ['1ª EM', 'Manhã'], ['3º ano', 'Manhã']]);
    put('Professores', [['Professor', 'Disciplinas', 'WhatsApp', 'Máx. aulas por dia', 'Indisponível (dia turno aula)', 'Respondeu em', 'Observação'],
      ['Teste Um', 'Física', '11 9999', 5, 'Seg Manhã 1; Ter Manhã 4', '01/02/2026 10:00', 'obs']]);
    put('Carga', [['Turma', 'Disciplina', 'Professor', 'Aulas/semana', 'Aulas duplas', 'Máx. por dia'], ['6º A', 'Física', 'Teste Um', 3, 0, 2]]);
    v.ctx.garantirEsquema_();
    const d = v.dados();
    ok(d.grades.length === 1 && d.grades[0].nome === 'Manhã', 'turno vira grade');
    const it = d.grades[0].itens;
    ok(it.length === 7 && it[3].tipo === 'intervalo' && it[3].ini === '09:30' && it[3].fim === '09:50' && it[4].ini === '09:50', 'horários e intervalo reais');
    ok(d.turmas[0].grade === 'Manhã' && d.turmas[0].segmento === 'EFAF' && d.turmas[0].serie === '6º ano', 'turma com segmento/série/grade');
    ok(d.turmas[1].segmento === 'EM' && d.turmas[1].serie === '1ª série' && d.turmas[2].segmento === 'EFAI', 'EM e EFAI deduzidos');
    const p = d.professores[0];
    ok(p.disciplinas === 'Física' && p.tel === '11 9999' && p.maxDia === 5 && p.obs === 'obs', 'colunas do professor no lugar');
    ok(p.indisp.join(',') === 'Seg|7,Ter|10','disponibilidade migrada para faixas (' + p.indisp.join(',') + ')');
    ok(d.carga[0].turmas[0] === '6º A', 'carga mantida');
    ok(d.componentes.length > 30 && d.matriz.length > 50, 'componentes e matriz padrão criados');
    ok(v.props.ESQUEMA === '8', 'versão gravada');
    ok(p.segmentos.join(',') === 'EFAF' && p.materias.join(',') === 'Física', 'segmentos e matérias completados pela carga');
  });

  await caso('Exemplo: matérias e segmentos dos professores coerentes com as atribuições', () => {
    const seg = {}; D.turmas.forEach(t => seg[t.nome] = t.segmento);
    D.carga.forEach(c => {
      const p = D.professores.find(x => x.nome === c.professor);
      ok(p && p.materias.includes(c.disciplina), `${c.professor} tem ${c.disciplina}`);
      ok(p && c.turmas.every(t => p.segmentos.includes(seg[t])), `${c.professor} tem o segmento de ${c.turmas.join(' + ')}`);
    });
    ok(D.professores.every(p => p.materias.every(m => D.componentes.some(c => c.nome === m))), 'matérias são componentes da Matriz');
  });

  await caso('Migração v4 → v5: professor ganha segmentos e matérias viram componentes', () => {
    const v = criarAmbiente(); v.ctx.gravarExemplo_();
    const prof = v.ss.getSheetByName('Professores');
    prof.d[0] = prof.d[0].slice(0, 8);                                         // cabeçalho v4 (sem Segmentos)
    prof.d.slice(1).forEach(l => { l[8] = ''; if (l[0] === 'Carla') l[2] = 'Ling. Ingl.'; });   // apelido do aSc
    v.props.ESQUEMA = '4'; v.ctx.garantirEsquema_();
    const c = v.dados().professores.find(p => p.nome === 'Carla');
    ok(c.materias.join(',') === 'Língua Inglesa', 'apelido virou componente (' + c.materias.join(',') + ')');
    ok(c.segmentos.join(',') === 'EFAI,EFAF', 'segmentos pela carga (' + c.segmentos.join(',') + ')');
    ok(v.ss.getSheetByName('Professores').d[0][8] === 'Segmentos', 'cabeçalho novo');
  });

  await caso('Atribuições: salva a carga inteira, valida e protege contra edição simultânea', () => {
    const v = criarAmbiente(); v.ctx.gravarExemplo_();
    const s = { u: 'teste', perfil: 'admin' }, erro = fn => { try { fn(); return ''; } catch (e) { return e.message; } };
    const d0 = v.dados(), carga = JSON.parse(JSON.stringify(d0.carga));
    carga.find(c => c.turmas[0] === '6A' && c.disciplina === 'Arte').professor = 'Helena';
    carga.push({ turmas: ['6A', '6B'], disciplina: 'Teatro', professor: 'Igor', aulas: 1, duplas: 0, maxDia: 1 });
    v.ctx.salvarAtribuicoes_({ carga, antes: d0.carga }, s);
    const d1 = v.dados();
    ok(d1.carga.find(c => c.turmas[0] === '6A' && c.disciplina === 'Arte').professor === 'Helena', 'troca de professor gravada');
    ok(d1.carga.some(c => c.turmas.join('+') === '6A+6B' && c.disciplina === 'Teatro'), 'turma junta nova gravada');
    ok(/Outra pessoa/.test(erro(() => v.ctx.salvarAtribuicoes_({ carga, antes: d0.carga }, s))), 'recusa se a carga mudou desde que a tela abriu');
    const ruim = JSON.parse(JSON.stringify(d1.carga)); ruim.push({ turmas: ['6A', '1A'], disciplina: 'Coral', professor: '', aulas: 1 });
    ok(/mesmo horário/.test(erro(() => v.ctx.salvarAtribuicoes_({ carga: ruim, antes: d1.carga }, s))), 'junta com horários diferentes recusada');
    const dup = JSON.parse(JSON.stringify(d1.carga)); dup.push({ turmas: ['6A'], disciplina: 'Teatro', professor: '', aulas: 1 });
    ok(/duas vezes/.test(erro(() => v.ctx.salvarAtribuicoes_({ carga: dup, antes: d1.carga }, s))), 'matéria repetida na turma recusada');
    const sem = JSON.parse(JSON.stringify(d1.carga)); sem.find(c => c.turmas[0] === '6A' && c.disciplina === 'Arte').professor = '';
    v.ctx.salvarAtribuicoes_({ carga: sem, antes: d1.carga }, s);
    ok(G.modelo(v.dados()).erros.some(e => /falta escolher o professor/.test(e)), 'sem professor vira pendência');
  });

  await caso('Sobrecarga: professor com mais aulas que horários livres', () => {
    const d = JSON.parse(JSON.stringify(D)), p = d.professores.find(x => x.nome === 'Sandra');   // 16 aulas no EFAF Manhã
    p.indisp = ['Seg', 'Ter', 'Qua', 'Qui'].flatMap(dia => [7, 8, 9, 10, 11, 12].map(h => dia + '|' + h));
    const M = G.modelo(d);
    ok(M.sobrecarga.Sandra && M.sobrecarga.Sandra.aulas === 16 && M.sobrecarga.Sandra.livres < 16, 'Sandra sobrecarregada (' + JSON.stringify(M.sobrecarga.Sandra) + ')');
    ok(Object.keys(G.modelo(D).sobrecarga).length === 0, 'exemplo sem sobrecarga');
  });

  await caso('Servidor: carga com turmas juntas, validações e renomear turma', () => {
    const v = criarAmbiente(); v.ctx.gravarExemplo_();
    const s = { u: 'teste', perfil: 'admin' };
    const erro = fn => { try { fn(); return ''; } catch (e) { return e.message; } };
    ok(/outro horário/.test(erro(() => v.ctx.salvarCarga_({ turma: '6A', linhas: [{ disciplina: 'X', professor: '', aulas: 1, juntas: ['1A'] }] }, s))), 'junta com grade diferente é recusada');
    ok(/duas vezes/.test(erro(() => v.ctx.salvarCarga_({ turma: '5A', linhas: [{ disciplina: 'Arte', professor: 'Helena', aulas: 2, juntas: ['5B'] }] }, s))), 'disciplina repetida na turma junta é recusada');
    v.ctx.salvarTurma_({ nomeAntigo: '5B', nome: '5º B', segmento: 'EFAI', serie: '5º ano', grade: 'EFAI Manhã' }, s);
    const d = v.dados();
    ok(d.carga.some(c => c.turmas.join('|') === '5A|5º B' && c.disciplina === 'Educação Física'), 'renomear turma atualiza a linha junta');
    v.ctx.excluirTurma_({ nome: '5º B' }, s);
    ok(v.dados().carga.some(c => c.turmas.join('|') === '5A' && c.disciplina === 'Educação Física'), 'excluir turma tira só ela da linha junta');
    ok(/10 em 10/.test(erro(() => v.ctx.salvarGrades_({ grades: [{ nome: 'X', itens: [{ tipo: 'aula', ini: '07:05', fim: '07:50' }] }] }, s))), 'horário fora de 10 em 10 é recusado');
  });

  await caso('Gerar: sem seletor de modo, roda por tempo e mostra as 3 melhores', async () => {
    const app = require('fs').readFileSync(require('path').join(__dirname, '..', 'apps-script', 'App.html'), 'utf8');
    ok(!/Caprichado|Rápido|id="tent"/.test(app), 'tela sem Rápido/Normal/Caprichado');
    ok(/tempoMs: TEMPO_GERAR/.test(app) && /TEMPO_GERAR = (2\d|30)000/.test(app), 'a tela gera por tempo (20–30 s)');
    const prog = [], t = Date.now();
    const r = await new Promise(res => G.gerar(D, { tempoMs: 2500, semente: 21 }, (p, n) => prog.push([p, n]), res));
    const dt = Date.now() - t;
    ok(dt >= 2400 && dt < 8000, 'parou pelo tempo (' + dt + ' ms)');
    ok(r.tentativas >= 2, 'fez várias tentativas (' + r.tentativas + ')');
    ok(r.opcoes.length >= 1 && r.opcoes.length <= 3, 'até 3 opções (' + r.opcoes.length + ')');
    ok(r.encontradas >= r.opcoes.length, 'conta as opções encontradas');
    ok(prog.length >= 2 && prog[prog.length - 1][0] === 1 && prog.every(([p, n], i) => i === 0 || (p >= prog[i - 1][0] && n >= prog[i - 1][1])), 'progresso crescente, termina em 100%');
    r.opcoes.forEach((o, i) => {
      ok(G.validar(D, o.grade).problemas.length === 0 && sobreposicoes(D, o.grade) === 0, `opção ${i + 1} sem conflitos`);
      ok(o.metricas.mediaParado === Math.round(o.metricas.janelasMin / o.metricas.nProfs), `opção ${i + 1}: média parada por professor`);
    });
    const vis = m => [Math.round(m.mediaParado / 5), Object.values(m.parado).filter(x => x > 120).length];
    ok(r.opcoes.every((o, i) => { if (!i) return true; const a = vis(r.opcoes[i - 1].metricas), b = vis(o.metricas); return a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]); }), 'a recomendada vem primeiro pelo que a tela mostra');
    const r2 = await gerar(G, D, { tentativas: 12, semente: 4 });
    ok(r2.opcoes.length <= 3, 'padrão: 3 melhores');
  });

  await caso('Tempo parado de cada professor (frases das opções)', () => {
    const d = mini({ carga: [{ turmas: ['1A'], disciplina: 'Mat', professor: 'P', aulas: 2, duplas: 0, maxDia: 2 }, { turmas: ['1A'], disciplina: 'Port', professor: 'Q', aulas: 2, duplas: 0, maxDia: 2 }] });
    const g = { '1A|0|0': { disciplina: 'Mat', professor: 'P' }, '1A|0|1': { disciplina: 'Port', professor: 'Q' }, '1A|0|2': { disciplina: 'Port', professor: 'Q' }, '1A|0|3': { disciplina: 'Mat', professor: 'P' } };
    const m = G.avaliar(G.modelo(d), g);
    ok(m.parado.P === 80, 'P: 7:40 → 9:30 = 110 min, menos 30 de folga = 80 (deu ' + m.parado.P + ')');
    ok(m.parado.Q === 0, 'Q: intervalo de 30 min não conta');
    ok(m.nProfs === 2 && m.mediaParado === 40, 'média de 40 min por professor');
  });

  await caso('Histórico da grade: salvar, trocar, ver e restaurar versões', () => {
    if (!oficial) return ok(false, 'sem grade oficial');
    const v = criarAmbiente(); v.ctx.gravarExemplo_();
    const s = { u: 'ana', nome: 'Ana Teste', perfil: 'coordenacao' }, mapa = g => Object.keys(g).sort().map(k => k + '=' + g[k].disciplina + '/' + g[k].professor).join(';');
    ok(v.dados().versoes.length === 0, 'começa sem versões');
    v.ctx.salvarGrade_({ grade: oficial, vigencia: '2026-02-02' }, s);
    let d = v.dados();
    ok(Object.keys(d.grade).length === Object.keys(oficial).length, 'grade oficial gravada');
    ok(d.versoes.length === 1 && d.versoes[0].descricao === 'Salvou como oficial' && d.versoes[0].usuario === 'Ana Teste', 'versão 1: quem e o quê');
    const partes = v.ss.getSheetByName('Histórico da grade').d.slice(1).filter(r => r[0] === 1);
    ok(partes.length >= 2 && partes.every(r => String(r[6]).length <= 40001 && String(r[6])[0] === '#'), 'cópia dividida em pedaços (' + partes.length + ')');
    const linhas = d.carga.filter(c => c.professor === 'Igor').map(c => ({ turmas: c.turmas.join(' + '), disciplina: c.disciplina }));
    const g2 = JSON.parse(JSON.stringify(d.grade)); Object.values(g2).forEach(c => { if (c.professor === 'Igor') c.professor = 'Mônica'; });
    v.ctx.substituir_({ sai: 'Igor', entra: 'Mônica', linhas, grade: g2, vigencia: '2026-08-03' }, s);
    d = v.dados();
    ok(d.versoes.length === 2 && d.versoes[0].descricao === 'Troca: Igor → Mônica', 'troca grava versão com descrição');
    ok(!d.carga.some(c => c.professor === 'Igor') && !Object.values(d.grade).some(c => c.professor === 'Igor'), 'troca aplicada na carga e na grade');
    ok(mapa(v.ctx.lerVersao_({ versao: 1 }).grade) === mapa(oficial), 'ver a versão 1 devolve a grade antiga');
    v.ctx.restaurarVersao_({ versao: 1 }, s);
    d = v.dados();
    ok(mapa(d.grade) === mapa(oficial), 'restaurar volta a grade');
    ok(d.carga.filter(c => c.professor === 'Igor').length === linhas.length, 'restaurar volta os professores das turmas');
    ok(d.versoes.length === 3 && /^Voltou para a versão de/.test(d.versoes[0].descricao) && d.versoes[0].vigencia === '02/02/2026', 'restaurar também vira versão (com a vigência da restaurada)');
    const ACOES = vm.runInContext('ACOES', v.ctx);
    ok(ACOES.restaurarVersao.p.indexOf('consulta') < 0 && ACOES.lerVersao.leitura, 'consulta não restaura; ver é só leitura');
    v.ctx.gravar_('Fixas', Array.from({ length: 1500 }, (_, i) => ['1A', 'Seg', 1, 'X' + i]));
    ok(v.ctx.valores_('Fixas').length === 1500, 'aba com mais de 1000 linhas: cresce sozinha (a grade inteira passa disso)');
    let erro = ''; try { v.ctx.restaurarVersao_({ versao: 99 }, s); } catch (e) { erro = e.message; }
    ok(/não encontrada/.test(erro), 'versão inexistente é recusada');
  });

  await caso('Histórico: guarda só as últimas versões; a migração cria a primeira', () => {
    const v = criarAmbiente(); v.ctx.gravarExemplo_();
    const MAX = vm.runInContext('MAX_VERSOES', v.ctx);
    for (let i = 0; i < MAX + 3; i++) v.ctx.guardarVersao_(null, 'teste ' + i, '');
    const todas = v.ctx.lerVersoes_(), vs = v.dados().versoes;
    ok(todas.length === MAX && todas[todas.length - 1].versao === 4, 'só as últimas ' + MAX);
    ok(vs.length === 50 && vs[0].versao === MAX + 3, 'a tela recebe as 50 mais recentes');
    const w = criarAmbiente(); w.ctx.gravarExemplo_();
    w.ctx.gravar_('Grade', [['1A', 'Seg', 1, '07:00–07:40', 'Matemática', 'Bianca']]);
    w.ss.deleteSheet(w.ss.getSheetByName('Histórico da grade')); w.props.ESQUEMA = '5';
    w.ctx.garantirEsquema_();
    const d = w.dados();
    ok(w.props.ESQUEMA === '8' && d.versoes.length === 1 && d.versoes[0].descricao === 'Grade oficial que já estava salva', 'migração v5 → v6 guarda a grade que já existia');
  });

  await caso('Vigência: “válida a partir de” na grade oficial e na troca', () => {
    const v = criarAmbiente(); v.ctx.gravarExemplo_();
    const erro = fn => { try { fn(); return ''; } catch (e) { return e.message; } };
    ok(v.ctx.vigencia_('2026-11-16') === '16/11/2026' && v.ctx.vigencia_('16/11/2026') === '16/11/2026', 'aceita data do calendário e dd/mm/aaaa');
    ok(/^\d{2}\/\d{2}\/\d{4}$/.test(v.ctx.vigencia_('')), 'sem data = hoje');
    ok(/inválida/.test(erro(() => v.ctx.vigencia_('2026-02-30'))) && /inválida/.test(erro(() => v.ctx.vigencia_('amanhã'))), 'data impossível é recusada');
    const um = { '1A|0|0': { disciplina: 'Matemática', professor: 'Bianca' } };
    ok(/inválida/.test(erro(() => v.ctx.salvarGrade_({ grade: um, vigencia: '31/04/2026' }))), 'salvar com data inválida é recusado');
    ok(Object.keys(v.dados().grade).length === 0 && v.dados().versoes.length === 0, '…e nada é gravado');
    v.ctx.salvarGrade_({ grade: um, vigencia: '2026-03-09' });
    ok(v.dados().vigencia === '09/03/2026', 'grade oficial mostra a vigência');
    v.ctx.substituir_({ sai: 'Bianca', entra: 'Cecília', linhas: [{ turmas: '1A', disciplina: 'Matemática' }], grade: { '1A|0|0': { disciplina: 'Matemática', professor: 'Cecília' } }, vigencia: '2026-09-14' });
    ok(v.dados().vigencia === '14/09/2026', 'a troca muda a vigência');
    const app = require('fs').readFileSync(require('path').join(__dirname, '..', 'apps-script', 'App.html'), 'utf8');
    ok(/function cabImpressao[\s\S]{0,200}D\.vigencia/.test(app), 'a impressão mostra a vigência');
  });

  await caso('Afetados pela troca: quem sai, quem entra, quem teve aula mudada e a mensagem', async () => {
    const antes = { '1A|0|0': { disciplina: 'A', professor: 'P' }, '1A|0|1': { disciplina: 'B', professor: 'Q' }, '1A|0|2': { disciplina: 'C', professor: 'R' }, '1A|0|3': { disciplina: 'C', professor: 'R' } };
    const d = mini({ carga: [{ turmas: ['1A'], disciplina: 'A', professor: 'S', aulas: 1, duplas: 0, maxDia: 1 }, { turmas: ['1A'], disciplina: 'B', professor: 'Q', aulas: 1, duplas: 0, maxDia: 1 },
      { turmas: ['1A'], disciplina: 'C', professor: 'R', aulas: 2, duplas: 0, maxDia: 2 }] });
    d.professores.push({ nome: 'S', indisp: ['Seg|7'] });   // quem entra não pode 7h–8h
    const g = JSON.parse(JSON.stringify(antes)); g['1A|0|0'].professor = 'S';
    const r = await reencaixar(G, d, g, 'S');
    ok(r.ok, 'troca P → S encaixou');
    if (!r.ok) return;
    const af = G.afetados(d, antes, r.grade, 'P', 'S'), por = {}; af.forEach(a => por[a.professor] = a);
    ok(af.map(a => a.papel).join(',') === 'sai,entra,mudou', 'ordem: sai, entra, mudou (' + af.map(a => a.professor + ':' + a.papel).join(',') + ')');
    ok(por.P && por.P.saem.length === 1 && por.P.saem[0].quando === 'Seg 7:00–7:40' && !por.P.entram.length, 'P deixa a aula de 7:00');
    ok(por.S && por.S.entram.length === 1 && por.S.entram[0].disciplina === 'A' && !/7:00/.test(por.S.entram[0].quando), 'S assume A em outro horário');
    ok(por.R && por.R.saem.length === 1 && por.R.entram.length === 1 && por.R.entram[0].quando === 'Seg 7:00–7:40', 'R teve uma aula de C mudada para 7:00');
    ok(!por.Q, 'Q não foi afetado');
    const msg = G.mensagem(por.P, '16/11/2026', 'Escola Teste');
    ok(/Olá, P!/.test(msg) && /16\/11\/2026/.test(msg) && /Você deixa estas aulas/.test(msg) && /Seg 7:00–7:40 · 1A · A/.test(msg), 'mensagem do WhatsApp com as mudanças');
    ok(/Suas novas aulas/.test(G.mensagem(por.S, '16/11/2026')) && /Saem do seu horário[\s\S]*Entram no seu horário/.test(G.mensagem(por.R, '16/11/2026')), 'mensagens de quem entra e de quem mudou');
    if (!oficial) return;
    const D2 = JSON.parse(JSON.stringify(D)), g2 = JSON.parse(JSON.stringify(oficial));
    D2.professores.push({ nome: 'Novo Prof', indisp: [], maxDia: 0 });
    D2.carga.forEach(c => { if (c.professor === 'Igor') c.professor = 'Novo Prof'; });
    Object.values(g2).forEach(c => { if (c.professor === 'Igor') c.professor = 'Novo Prof'; });
    const r2 = await reencaixar(G, D2, g2, 'Novo Prof'), af2 = r2.ok ? G.afetados(D2, oficial, r2.grade, 'Igor', 'Novo Prof') : [];
    const aulaDe = k => { const [t, , a] = k.split('|'); return D.grades.find(x => x.nome === D.turmas.find(y => y.nome === t).grade).itens.filter(i => i.tipo === 'aula')[+a]; };
    const aulasIgor = new Set(Object.entries(oficial).filter(([, c]) => c.professor === 'Igor').map(([k, c]) => c.disciplina + k.split('|')[1] + aulaDe(k).ini + aulaDe(k).fim)).size;
    ok(r2.ok && af2.length === 2 && af2[0].papel === 'sai' && af2[0].saem.length === aulasIgor && af2[1].entram.length === aulasIgor, 'só Igor e o novo professor (' + aulasIgor + ' aulas; turmas juntas contam uma vez)');
  });

  await caso('Professor: salvar com turmas e matérias (atribuir pelo professor)', () => {
    const v = criarAmbiente(); v.ctx.gravarExemplo_();
    const s = { u: 'teste', perfil: 'admin' }, erro = fn => { try { fn(); return ''; } catch (e) { return e.message; } };
    const d0 = v.dados(), p = d0.professores.find(x => x.nome === 'Otávio'), carga = JSON.parse(JSON.stringify(d0.carga));
    carga.find(c => c.turmas[0] === '6C' && c.disciplina === 'Matemática').professor = 'Otávio';   // passa a 6C de Rafael para Otávio
    carga.find(c => c.turmas[0] === '6A' && c.disciplina === 'Matemática').professor = '';         // tira a 6A
    const dados = { nomeAntigo: 'Otávio', nome: 'Otávio', completo: p.completo, materias: p.materias, segmentos: p.segmentos, indisp: [], blocos: [], carga, cargaAntes: d0.carga };
    v.ctx.salvarProfessor_(dados, s);
    let d1 = v.dados();
    ok(d1.carga.find(c => c.turmas[0] === '6C' && c.disciplina === 'Matemática').professor === 'Otávio', '6C passou para Otávio');
    ok(d1.carga.find(c => c.turmas[0] === '6A' && c.disciplina === 'Matemática').professor === '', '6A ficou sem professor (pendência)');
    ok(/Outra pessoa/.test(erro(() => v.ctx.salvarProfessor_(dados, s))), 'recusa se as atribuições mudaram desde que a janela abriu');
    ok(v.dados().carga.find(c => c.turmas[0] === '6A' && c.disciplina === 'Matemática').professor === '', '…e não grava nada');
    // renomear e mexer nas turmas ao mesmo tempo
    const c2 = JSON.parse(JSON.stringify(d1.carga)).map(c => Object.assign(c, { professor: c.professor === 'Otávio' ? 'Otávio P.' : c.professor }));
    c2.find(c => c.turmas[0] === '6A' && c.disciplina === 'Matemática').professor = 'Otávio P.';
    v.ctx.salvarProfessor_(Object.assign({}, dados, { nome: 'Otávio P.', carga: c2, cargaAntes: d1.carga }), s);
    const d2 = v.dados();
    ok(!d2.carga.some(c => c.professor === 'Otávio') && d2.carga.filter(c => c.professor === 'Otávio P.').length === d1.carga.filter(c => c.professor === 'Otávio').length + 1, 'renomeou e gravou as turmas');
    ok(d2.professores.some(x => x.nome === 'Otávio P.') && !d2.professores.some(x => x.nome === 'Otávio'), 'professor renomeado');
    // sem "carga": só o cadastro (como antes)
    v.ctx.salvarProfessor_({ nomeAntigo: 'Otávio P.', nome: 'Otávio P.', materias: ['Matemática'], segmentos: ['EFAF'], indisp: ['Seg|7'], blocos: [] }, s);
    ok(JSON.stringify(v.dados().carga) === JSON.stringify(d2.carga), 'sem turmas na chamada, as atribuições não mudam');
  });

  await caso('Começar ano letivo: guarda, apaga o que muda e mantém a estrutura', () => {
    if (!oficial) return ok(false, 'sem grade oficial');
    for (const opcao of ['manter', 'apagar']) {
      const v = criarAmbiente(); v.ctx.gravarExemplo_();
      const s = { u: 'admin', nome: 'Admin', perfil: 'admin' }, erro = fn => { try { fn(); return ''; } catch (e) { return e.message; } };
      v.ctx.salvarGrade_({ grade: oficial, vigencia: '2026-02-02' }, s);
      v.ctx.salvarProfessor_(Object.assign({}, v.dados().professores.find(p => p.nome === 'Bianca'), { nomeAntigo: 'Bianca', codigo: '5678', blocos: [] }), s);
      v.ctx.formEnviar({ nome: 'Bianca', codigo: '5678', indisp: ['Seg|7'], obs: '' });
      v.ctx.conferirEstrutura_({ ok: true });
      const d0 = v.dados();
      ok(d0.ano.conferido && d0.professores.find(p => p.nome === 'Bianca').respondeuEm, 'antes: conferido e Bianca respondeu');
      ok(/ano/.test(erro(() => v.ctx.comecarAno_({ ano: '27', professores: opcao }, s))) && /professores/.test(erro(() => v.ctx.comecarAno_({ ano: '2027' }, s))), 'pede o ano e a escolha dos professores');
      v.ctx.comecarAno_({ ano: '2027', professores: opcao }, s);
      const d = v.dados();
      ok(Object.keys(d.grade).length === 0 && d.fixas.length === 0 && d.blocos.length === 0, `${opcao}: grade oficial, aulas fixas e horários reservados apagados`);
      ok(d.carga.length >= d0.carga.length && d.carga.every(c => !c.professor), `${opcao}: matérias das turmas ficam, sem professor`);
      ok(d.carga.some(c => c.turmas.join('+') === '5A+5B') && d.carga.some(c => c.disciplina === 'Teatro'), `${opcao}: turmas juntas e contraturno continuam`);
      ok(d.versoes.length === 2 && /antes de começar 2027/.test(d.versoes[0].descricao), `${opcao}: a grade de hoje foi para o histórico`);
      ok(JSON.stringify(d.grades) === JSON.stringify(d0.grades) && d.turmas.length === d0.turmas.length && d.matriz.length === d0.matriz.length && d.usuarios.length === d0.usuarios.length, `${opcao}: horários, turmas, matriz e usuários mantidos`);
      if (opcao === 'apagar') ok(d.professores.length === 0, 'apagar: professores apagados');
      else ok(d.professores.length === d0.professores.length && d.professores.every(p => !p.respondeuEm) && d.professores.find(p => p.nome === 'Bianca').indisp.join() === 'Seg|7', 'manter: professores ficam, voltam a "não respondeu" e guardam o que marcaram');
      ok(d.ano.ano === '2027' && !d.ano.conferido, `${opcao}: ano gravado e passo 1 volta a pendente`);
      ok(G.modelo(d).erros.some(e => /falta escolher o professor/.test(e)), `${opcao}: vira pendência "falta professor"`);
    }
    const ACOES = vm.runInContext('ACOES', criarAmbiente().ctx);
    ok(ACOES.comecarAno.p.join() === 'admin' && ACOES.conferirEstrutura.p.indexOf('consulta') < 0, 'só admin começa o ano; consulta não marca passos');
  });

  await caso('Domínio próprio: o endereço do site fica num lugar só', () => {
    const fs = require('fs'), path = require('path'), dir = path.join(__dirname, '..', 'apps-script');
    const v = criarAmbiente(), SITE = vm.runInContext('SITE', v.ctx), CONFIG = vm.runInContext('CONFIG', v.ctx);
    ok(CONFIG.ASSETS === SITE && CONFIG.URL_PUBLICA === SITE, 'arquivos e link usam SITE');
    const usos = fs.readdirSync(dir).filter(f => /\.(js|html)$/.test(f)).map(f => (fs.readFileSync(path.join(dir, f), 'utf8').match(/github\.io/g) || []).length).reduce((a, b) => a + b, 0);
    ok(usos === 1, 'o endereço aparece uma vez só no código (' + usos + ')');
    ok(v.ctx.cfg_().logo === SITE + 'logo.png', 'logo vem do SITE');
  });

  await caso('Telas: menu enxuto, Configuração, Conferência e celular', () => {
    const fs = require('fs'), path = require('path'), ler = f => fs.readFileSync(path.join(__dirname, '..', 'apps-script', f), 'utf8');
    const app = ler('App.html'), estilo = ler('Estilo.html'), form = ler('Formulario.html'), comum = ler('Comum.html');
    const telas = [...app.matchAll(/\{ id: '(\w+)', nome: '([^']+)'([^\n]*)\}/g)];
    ok(telas.filter(t => !/pai:/.test(t[3])).map(t => t[2]).join(' · ') === 'Início · Grade horária · Professores · Conferência das turmas · Configuração', 'menu: ' + telas.filter(t => !/pai:/.test(t[3])).map(t => t[2]).join(' · '));
    ok(telas.filter(t => /pai: 'config'/.test(t[3])).map(t => t[2]).join(' · ') === 'Começar ano letivo · Horários das aulas · Turmas · Matriz curricular · Aulas fixas · Usuários', 'cartões da Configuração na ordem');
    ok(!/\(raro\)|Dia a dia|telaAtribuicoes/.test(app), 'sem "(raro)", sem grupos e sem a tela Atribuições');
    ok(/← Configuração/.test(app), 'botão “← Configuração”');
    ok(/abrirMenu/.test(app) && /btn-menu/.test(app) && /\.menu\.aberto/.test(app), 'menu ☰ com gaveta');
    ok(/function listaDiaTurma/.test(app) && /dias-abas/.test(app) && /só aparece no computador/.test(app), 'grade no celular: um dia por vez; todas as turmas só no computador');
    ok(/max-width:700px/.test(estilo) && /table\.cartao/.test(estilo) && /min-height:44px/.test(estilo) && /\.modal \.caixa \{ max-width:none; min-height:100%/.test(estilo), 'celular: cartões, toque de 44px e janelas em tela cheia');
    ok(/\.enviar \{ position:fixed/.test(form) && /disp-grade/.test(comum) && /disp-dia/.test(comum) && /disp-hora/.test(comum), 'formulário: agenda (dias nas colunas) e Enviar fixo embaixo');
    ok(/Passar \$\{l\.turmas\.join\(' \+ '\)\} de \$\{l\.professor\} para/.test(app) && /textoGrupo/.test(app) && /Não cabe:/.test(app), 'professor: passar turma, atalho por série e aviso de não caber');
    ok(/turmas completas/.test(app) && /conf-extra/.test(app) && /Sem professor \(/.test(app), 'conferência: resumo, contraturno recolhido e sem professor no topo');
  });

  await caso('Formulário: nome + código de 4 números, conferido pelo servidor', () => {
    const v = criarAmbiente(); v.ctx.gravarExemplo_(); v.ctx.criarProfessoresTeste_();
    const erro = fn => { try { fn(); return ''; } catch (e) { return e.message; } };
    const L = JSON.parse(JSON.stringify(v.ctx.formLista()));
    ok(L.profs.every(p => Object.keys(p).join() === 'nome,rotulo'), 'lista só com o nome (sem matérias)');
    ok(L.profs.map(p => p.rotulo).join('|') === L.profs.map(p => p.rotulo).sort((a, b) => a.localeCompare(b, 'pt')).join('|'), 'em ordem alfabética');
    ok(Array.isArray(L.faixas) && L.faixas.map(f => f.periodo).join() === 'Manhã,Tarde' && L.faixas[0].horas[0] === 7 && L.faixas[1].horas[0] === 13, 'faixas em lista ordenada: Manhã e depois Tarde');
    ok(L.materias.includes('Matemática') && L.materias.length === new Set(L.materias).size, 'matérias da Matriz para o professor novo');
    ok(L.profs.filter(p => /\(teste\)/.test(p.rotulo)).length === 3, '3 professores de teste na lista');
    const d = v.ctx.formDados('Ana (teste)', '1234');
    ok(d && Array.isArray(d.indisp) && d.nome === 'Ana (teste)', 'código certo (1234) abre o quadro');
    ok(/^CODIGO_ERRADO: .*Restam 4 tentativas/.test(erro(() => v.ctx.formDados('Ana (teste)', '1111'))), 'código errado: avisa e conta as tentativas');
    v.ctx.formDados('Ana (teste)', '1234');
    ok(/Restam 4/.test(erro(() => v.ctx.formDados('Ana (teste)', '9999'))), 'acertar zera a contagem de erros');
    v.cache.clear();
    for (let i = 0; i < 4; i++) erro(() => v.ctx.formDados('Bruno (teste)', '000' + i));
    ok(/^BLOQUEADO: .*15 minutos.*Fale com a coordenação/.test(erro(() => v.ctx.formDados('Bruno (teste)', '4444'))), '5º erro seguido: bloqueia 15 min e manda falar com a coordenação');
    ok(/^BLOQUEADO/.test(erro(() => v.ctx.formDados('Bruno (teste)', '1234'))), 'bloqueado: nem o código certo entra');
    ok(/^BLOQUEADO/.test(erro(() => v.ctx.formEnviar({ nome: 'Bruno (teste)', codigo: '1234', indisp: [] }))), 'bloqueado: o envio também é recusado');
    ok(v.ctx.formDados('Célia (teste)', '1234').nome === 'Célia (teste)', 'o bloqueio é só daquele nome');
    const chave = [...v.cache.keys()].find(k => /^form_falha_/.test(k));
    ok(chave && v.cache.get(chave) === '5', 'bloqueio guardado no CacheService');
    v.cache.delete(chave);   // passaram os 15 minutos
    ok(v.ctx.formDados('Bruno (teste)', '1234').nome === 'Bruno (teste)', 'depois dos 15 minutos, entra de novo');
    // o servidor recusa envio sem código ou com código errado, e não grava nada
    const resp = () => v.dados().professores.find(p => p.nome === 'Ana (teste)').respondeuEm;
    ok(/CODIGO_ERRADO/.test(erro(() => v.ctx.formEnviar({ nome: 'Ana (teste)', indisp: ['Seg|7'] }))), 'envio sem código é recusado');
    ok(/CODIGO_ERRADO/.test(erro(() => v.ctx.formEnviar({ nome: 'Ana (teste)', codigo: '4321', indisp: ['Seg|7'] }))), 'envio com código errado é recusado');
    ok(!resp(), '…e nada foi gravado');
    v.ctx.formEnviar({ nome: 'Ana (teste)', codigo: '1234', indisp: ['Seg|7', 'Ter|13', 'Xyz|99'], obs: 'oi' });
    const ana = v.dados().professores.find(p => p.nome === 'Ana (teste)');
    ok(ana.respondeuEm && ana.indisp.join() === 'Seg|7,Ter|13' && ana.obs === 'oi', 'com o código certo grava (e ignora faixas inválidas)');
    // professor sem código cadastrado
    ok(/^SEM_CODIGO: Seu cadastro ainda não está completo\. Fale com a coordenação\./.test(erro(() => v.ctx.formDados('Bianca', '1234'))), 'sem código: “Seu cadastro ainda não está completo”');
    ok(/SEM_CODIGO/.test(erro(() => v.ctx.formEnviar({ nome: 'Bianca', codigo: '1234', indisp: [] }))), 'sem código: envio recusado');
    ok(/não encontrado/.test(erro(() => v.ctx.formDados('Fulano Inexistente', '1234'))), 'nome que não existe é recusado');
    ok(!/v1:/.test(JSON.stringify(L)) && !/v1:/.test(JSON.stringify(v.dados())) && !/v1:/.test(JSON.stringify(d)), 'o hash nunca sai do servidor (lista, formulário e sistema)');
    ok(v.dados().linkForm.endsWith('/professor/'), 'link do formulário: SITE + professor/ (' + v.dados().linkForm + ')');
  });

  await caso('Código: guarda só o hash (com sal), nunca os números do CPF', () => {
    const v = criarAmbiente(); v.ctx.gravarExemplo_();
    const s = { u: 'teste', perfil: 'admin' }, crypto = require('crypto'), sha = t => crypto.createHash('sha256').update(t).digest('hex');
    const base = n => Object.assign({}, v.dados().professores.find(p => p.nome === n), { nomeAntigo: n, blocos: [] });
    v.ctx.salvarProfessor_(Object.assign(base('Bianca'), { codigo: '4821' }), s);
    v.ctx.salvarProfessor_(Object.assign(base('Cecília'), { codigo: '4821' }), s);
    const linhas = v.ss.getSheetByName('Professores').d, cab = linhas[0], col = cab.indexOf('Código do formulário (não editar)');
    const hb = linhas.find(r => r[0] === 'Bianca')[col], hc = linhas.find(r => r[0] === 'Cecília')[col];
    ok(col === 9 && /^v1:[0-9a-f]{12}:[0-9a-f]{64}$/.test(hb), 'coluna nova com o hash (' + String(hb).slice(0, 20) + '…)');
    ok(!linhas.some(r => r.some(c => String(c) === '4821')), 'os números não aparecem na planilha');
    ok(hb.split(':')[2] !== sha('4821') && hb !== hc, 'hash com sal e sorteio: dois códigos iguais viram hashes diferentes');
    const sal = v.props.SAL_CODIGO;
    ok(sal && sal.length >= 32 && !JSON.stringify(v.ss.abas).includes(sal), 'o sal fica nas propriedades do script, não na planilha');
    ok(v.ctx.formDados('Bianca', '4821').nome === 'Bianca' && v.ctx.formDados('Cecília', '4821').nome === 'Cecília', 'os dois entram com o próprio código');
    v.ctx.salvarProfessor_(base('Bianca'), s);
    ok(v.ss.getSheetByName('Professores').d.find(r => r[0] === 'Bianca')[col] === hb, 'salvar sem código novo mantém o código');
    v.ctx.salvarProfessor_(Object.assign(base('Bianca'), { nome: 'Bianca M.' }), s);
    ok(v.ctx.formDados('Bianca M.', '4821').nome === 'Bianca M.', 'renomear o professor não perde o código');
    v.ctx.salvarProfessor_(Object.assign(base('Bianca M.'), { codigo: '0007' }), s);
    let e = ''; try { v.ctx.formDados('Bianca M.', '4821'); } catch (x) { e = x.message; }
    ok(/CODIGO_ERRADO/.test(e) && v.ctx.formDados('Bianca M.', '0007'), 'redefinir: o código antigo deixa de valer');
    e = ''; try { v.ctx.salvarProfessor_(Object.assign(base('Cecília'), { codigo: '12a4' }), s); } catch (x) { e = x.message; }
    ok(/4 números/.test(e), 'código que não tem 4 números é recusado');
    const P = v.dados().professores;
    ok(P.find(p => p.nome === 'Cecília').temCodigo && !P.find(p => p.nome === 'Débora').temCodigo, 'o sistema mostra só “tem código / falta código”');
  });

  await caso('Professor novo pelo formulário: aguarda aprovação e o gerador não usa', () => {
    const v = criarAmbiente(); v.ctx.gravarExemplo_();
    const s = { u: 'teste', perfil: 'coordenacao' }, erro = fn => { try { fn(); return ''; } catch (e) { return e.message; } };
    const novo = { novo: true, completo: 'Renata Exemplo Duarte', tel: '(11) 90000-0001', materias: ['Arte', 'Inventada'], codigo: '2468', indisp: ['Qua|7'], obs: 'oi' };
    ok(/nome completo/.test(erro(() => v.ctx.formEnviar(Object.assign({}, novo, { completo: 'Renata' })))), 'pede nome e sobrenome');
    ok(/4 números/.test(erro(() => v.ctx.formEnviar(Object.assign({}, novo, { codigo: '' })))), 'novo sem código é recusado');
    ok(/matéria/.test(erro(() => v.ctx.formEnviar(Object.assign({}, novo, { materias: ['Inventada'] })))), 'matéria precisa ser da Matriz');
    ok(/WhatsApp/.test(erro(() => v.ctx.formEnviar(Object.assign({}, novo, { tel: '123' })))), 'pede WhatsApp com DDD');
    ok(/já está na lista/.test(erro(() => v.ctx.formEnviar(Object.assign({}, novo, { completo: 'Bianca Moreira Lins' })))), 'nome que já existe é recusado');
    v.ctx.formEnviar(novo);
    let D1 = v.dados();
    const pend = D1.pendentes.find(p => p.nome === 'Renata Exemplo Duarte');
    ok(pend && pend.materias.join() === 'Arte' && pend.temCodigo && pend.respondeuEm && pend.indisp.join() === 'Qua|7', 'entra como “Aguardando aprovação”, com matérias da Matriz e código');
    ok(!D1.professores.some(p => p.nome === pend.nome), 'não aparece entre os professores (nem para o gerador)');
    ok(v.ss.getSheetByName('Professores').d.find(r => r[0] === pend.nome)[10] === 'Aguardando aprovação', 'situação gravada na planilha');
    ok(v.ctx.formLista().profs.some(p => p.nome === pend.nome) && v.ctx.formDados(pend.nome, '2468').pendente, 'pode voltar ao formulário com o código dele');
    const carga = JSON.parse(JSON.stringify(D1.carga)); carga.find(c => c.disciplina === 'Arte').professor = pend.nome;
    ok(/não encontrado/.test(erro(() => v.ctx.salvarAtribuicoes_({ carga, antes: D1.carga }, s))), 'não dá para dar turmas antes de aprovar');
    ok(G.modelo(D1).pIdx && G.modelo(D1).pIdx[pend.nome] === undefined, 'gerador só com aprovados');
    v.ctx.aprovarProfessor_({ nome: pend.nome }, s);
    D1 = v.dados();
    ok(D1.professores.some(p => p.nome === pend.nome) && !D1.pendentes.length, 'aprovado: vira professor normal');
    v.ctx.salvarAtribuicoes_({ carga, antes: D1.carga }, s);
    ok(v.dados().carga.some(c => c.professor === pend.nome), 'aprovado: pode receber turmas');
    v.ctx.formEnviar(Object.assign({}, novo, { completo: 'Outro Nome Teste' }));
    ok(/Só dá para recusar/.test(erro(() => v.ctx.recusarProfessor_({ nome: 'Bianca' }, s))), 'só recusa quem está aguardando');
    v.ctx.recusarProfessor_({ nome: 'Outro Nome Teste' }, s);
    ok(!v.dados().pendentes.length && !v.ss.getSheetByName('Professores').d.some(r => r[0] === 'Outro Nome Teste'), 'recusar apaga o cadastro');
    const ACOES = vm.runInContext('ACOES', v.ctx);
    ok(['aprovarProfessor', 'recusarProfessor', 'apagarTeste'].every(a => ACOES[a] && ACOES[a].p.indexOf('consulta') < 0), 'consulta não aprova, não recusa e não apaga');
  });

  await caso('Professores de teste: migração v7 cria 3 (código 1234) e o botão apaga só eles', () => {
    const v = criarAmbiente(); v.ctx.gravarExemplo_();
    const prof = v.ss.getSheetByName('Professores');
    prof.d[0] = prof.d[0].slice(0, 9); prof.d.slice(1).forEach(l => l.splice(9));   // planilha v6 (sem código e situação)
    const antes = prof.d.length - 1;
    delete v.props.PROFS_TESTE; v.props.ESQUEMA = '6'; v.ctx.garantirEsquema_();
    const D1 = v.dados(), teste = D1.professores.filter(p => p.teste);
    ok(v.props.ESQUEMA === '8' && prof.d[0][9] === 'Código do formulário (não editar)' && prof.d[0][10] === 'Situação (Aprovado / Aguardando aprovação)', 'cabeçalho novo');
    ok(D1.professores.length === antes + 3 && teste.length === 3 && teste.every(p => /\(teste\)/.test(p.nome) && p.temCodigo), '3 professores “(teste)” com código');
    ok(D1.professores.filter(p => !p.teste).every(p => !p.temCodigo) && !D1.pendentes.length, 'os que já existiam continuam aprovados, sem código');
    ok(teste.every(p => v.ctx.formDados(p.nome, '1234').nome === p.nome), 'os 3 entram com 1234');
    v.props.ESQUEMA = '6'; v.ctx.garantirEsquema_();
    ok(v.dados().professores.filter(p => p.teste).length === 3, 'rodar de novo não duplica');
    // migração que parou no meio: cabeçalho já novo, sem os professores de teste (o que aconteceu na planilha real)
    const w = criarAmbiente(); w.ctx.gravarExemplo_();
    delete w.props.PROFS_TESTE; w.props.ESQUEMA = '7'; w.ctx.garantirEsquema_();
    ok(w.dados().professores.filter(p => p.teste).length === 3 && w.props.PROFS_TESTE === '1', 'cabeçalho já novo e sem professores de teste: a migração cria');
    w.ctx.apagarTeste_({}, { u: 'x' }); w.props.ESQUEMA = '7'; w.ctx.garantirEsquema_();
    ok(!w.dados().professores.some(p => p.teste), 'depois de apagados, não voltam sozinhos');
    // se criar falhar, o formulário continua abrindo e o erro fica no Registro
    const z = criarAmbiente(); z.ctx.gravarExemplo_();
    delete z.props.PROFS_TESTE; z.props.ESQUEMA = '7';
    const orig = z.ctx.Utilities.computeDigest; z.ctx.Utilities.computeDigest = () => { throw new Error('falha simulada'); };
    let ef = ''; try { z.ctx.formLista(); } catch (x) { ef = x.message; }
    z.ctx.Utilities.computeDigest = orig;
    ok(!ef && z.props.ESQUEMA === '8' && z.props.PROFS_TESTE !== '1', 'falha ao criar os de teste não derruba o formulário (' + (ef || 'ok') + ')');
    ok(z.ss.getSheetByName('Registro').d.some(r => /Não criou os professores de teste: falha simulada/.test(r[2])), '…e fica anotada no Registro');
    const s = { u: 'teste', perfil: 'admin' }, carga = JSON.parse(JSON.stringify(D1.carga));
    carga.find(c => c.disciplina === 'Arte').professor = 'Ana (teste)';
    v.ctx.salvarAtribuicoes_({ carga, antes: D1.carga }, s);
    v.ctx.apagarTeste_({}, s);
    const D2 = v.dados();
    ok(!D2.professores.some(p => p.teste) && D2.professores.length === antes, 'apagou só os de teste');
    ok(!D2.carga.some(c => c.professor === 'Ana (teste)') && D2.carga.some(c => c.disciplina === 'Arte' && !c.professor), 'as turmas deles ficam sem professor');
    let e = ''; try { v.ctx.apagarTeste_({}, s); } catch (x) { e = x.message; }
    ok(/Não há/.test(e), 'sem professores de teste: avisa');
    const cod = require('fs').readFileSync(require('path').join(__dirname, '..', 'apps-script', 'Codigo.js'), 'utf8');
    ok(/NÃO usar na planilha real/.test(cod) && /NÃO use na planilha real/.test(cod), '“Criar dados de exemplo” avisa para não usar na planilha real');
  });

  await caso('Quadro de disponibilidade: dias nas colunas, horários nas linhas, cabe em 360px', () => {
    const fs = require('fs'), path = require('path'), dir = path.join(__dirname, '..', 'apps-script');
    const comum = fs.readFileSync(path.join(dir, 'Comum.html'), 'utf8'), estilo = fs.readFileSync(path.join(dir, 'Estilo.html'), 'utf8'), form = fs.readFileSync(path.join(dir, 'Formulario.html'), 'utf8');
    const c = { console, Math, JSON, document: { addEventListener() { }, querySelectorAll: () => [] }, window: {} };
    vm.createContext(c);
    vm.runInContext(comum.match(/<script>([\s\S]*?)<\/script>/)[1] + ';this.htmlDisp = htmlDisp; this.total = totalHorasDisp; DISP = new Set(["Ter|8"]);', c);
    const F = criarAmbiente().dados().faixas, dias = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'], h = c.htmlDisp(dias, F);
    ok(h.indexOf('<h3>Manhã</h3>') >= 0 && h.indexOf('<h3>Manhã</h3>') < h.indexOf('<h3>Tarde</h3>'), 'Manhã primeiro, Tarde logo abaixo');
    const manha = h.slice(h.indexOf('<h3>Manhã</h3>'), h.indexOf('<h3>Tarde</h3>'));
    const ordem = [...manha.matchAll(/class="(disp-dia|disp-hora|slot[^"]*)"[^>]*?(?:data-dia="(\w+)"|data-h="(\d+)"|data-k="([^"]+)")/g)].map(m => m[2] || (m[3] ? m[3] + 'h' : m[4]));
    ok(ordem.slice(0, 5).join() === dias.join(), 'topo: Seg Ter Qua Qui Sex (' + ordem.slice(0, 5).join(' ') + ')');
    ok(ordem.slice(5, 11).join() === '7h,Seg|7,Ter|7,Qua|7,Qui|7,Sex|7', 'cada linha: o horário e os 5 dias (' + ordem.slice(5, 11).join(' ') + ')');
    ok(/7h<small>–8h<\/small>/.test(manha) && /12h<small>–13h<\/small>/.test(manha) && ordem.length === 5 + 6 * 6, 'linhas 7h–8h … 12h–13h');
    ok(/class="slot nao"[^>]*data-k="Ter\|8"/.test(h) && (h.match(/slot nao/g) || []).length === 1, 'marcado aparece como “não pode”');
    ok(/data-per="Manhã" data-dia="Seg" onclick="dispGrupo/.test(h) && /data-per="Tarde" data-h="13" onclick="dispGrupo/.test(h), 'tocar no dia marca o período do dia; tocar no horário marca a hora em todos os dias');
    ok(/onpointerdown="slotDown/.test(h) && /onpointerenter="slotEnter/.test(h), 'arrastar com o mouse continua');
    ok(/✓ Pode/.test(h) && /✕ Não pode/.test(h), 'legenda ✓ Pode / ✕ Não pode');
    ok(c.total(dias, F) === 60, '60 horas na semana');
    // 360px: página (12px de cada lado) + cartão no celular (12px de cada lado); coluna do horário + 5 colunas iguais com 4px de espaço
    const cel = estilo.slice(estilo.indexOf('@media (max-width:700px)'));
    const m = /\.disp-grade \{ grid-template-columns:(\d+)px repeat\(var\(--n, 5\), minmax\(0, 1fr\)\); gap:(\d+)px/.exec(cel);
    const pagina = +/\.pagina-f \{[^}]*padding:0 (\d+)px/.exec(form)[1], cartao = +/@media \(max-width:700px\) \{ \.pagina-f \.card \{ padding:\d+px (\d+)px/.exec(form)[1];
    ok(!!m, 'grade com minmax(0, 1fr): nunca estoura a largura');
    if (m) {
      const util = 360 - 2 * pagina - 2 * cartao, col = (util - +m[1] - 5 * +m[2]) / 5;
      ok(+m[1] <= 56 && col >= 40, `em 360px: horário ${m[1]}px e cada dia com ${col.toFixed(1)}px (sem rolagem horizontal)`);
    }
    const alt = k => +(new RegExp('\\.' + k + ' \\{[^}]*min-height:(\\d+)px').exec(estilo) || [])[1];
    ok(alt('slot') >= 44 && alt('disp-dia, \\.disp-hora') >= 44, 'toque com pelo menos 44px de altura');
    const docs = f => fs.readFileSync(path.join(__dirname, '..', 'docs', f), 'utf8'), url = t => (/URL_APP = '([^']+)'/.exec(t) || [])[1];
    ok(url(docs('professor/index.html')) === url(docs('index.html')) && /\?form=1/.test(docs('professor/index.html')), 'docs/professor/ abre o formulário (mesma URL /exec, ?form=1)');
    ok(/form/.test(docs('index.html')), '?form=1 continua funcionando no endereço principal');
  });

  console.log(`\n${total - falhas}/${total} verificações ok.`);
  if (falhas) process.exit(1);
})();
