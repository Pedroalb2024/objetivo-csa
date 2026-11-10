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
    ok(v.props.ESQUEMA === '6', 'versão gravada');
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
    ok(w.props.ESQUEMA === '6' && d.versoes.length === 1 && d.versoes[0].descricao === 'Grade oficial que já estava salva', 'migração v5 → v6 guarda a grade que já existia');
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

  console.log(`\n${total - falhas}/${total} verificações ok.`);
  if (falhas) process.exit(1);
})();
