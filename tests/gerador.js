// Testes do servidor (Codigo.js) e do gerador (Gerador.html) com a escola de exemplo e casos pequenos.
// Uso: node tests/gerador.js
const { criarAmbiente, carregarScript } = require('./ambiente'), vm = require('vm');
let falhas = 0, total = 0;
const ok = (cond, msg) => { total++; if (!cond) { falhas++; console.error('  ✗ ' + msg); } };
const caso = async (nome, fn) => { const f0 = falhas; try { await fn(); } catch (e) { falhas++; console.error('  ✗ erro: ' + (e.stack || e)); } console.log((falhas === f0 ? '✓ ' : '✗ ') + nome); };
const gerar = (G, D, opt) => new Promise(r => G.gerar(D, opt, null, r));
const reencaixar = (G, D, g, alvo) => new Promise(r => G.reencaixar(D, g, alvo, r));
const min = h => { const [a, b] = h.split(':').map(Number); return a * 60 + b; };
const nao = (dia, ini, fim) => ({ dia, ini: min(ini), fim: min(fim) });   // intervalo "não pode"
const erroDe = fn => { try { fn(); return ''; } catch (e) { return e.message; } };

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

  await caso('Exemplo: estrutura real (grades, turmas, matriz, Extra por turma da manhã, turmas juntas)', () => {
    ok(D.grades.length === 7 && D.grades.slice(-2).map(g => g.nome).join() === 'Extra 1º ao 5º,Extra 6º ao EM', '7 horários de aula, com os 2 do Extra');
    ok(D.turmas.filter(t => t.segmento !== 'Extra').length === 31, '31 turmas regulares');
    ok(D.turmas.filter(t => t.segmento === 'Extra').length === 21, '21 Extras (um por turma da manhã)');
    ok(D.professores.length >= 50, 'professores das turmas e do Extra');
    const soma = {}; D.matriz.forEach(m => soma[m.serie] = (soma[m.serie] || 0) + m.aulas);
    Object.entries(soma).forEach(([s, n]) => ok(n === (s === 'Extra 1º ao 5º' ? 20 : s === 'Extra 6º ao EM' ? 15 : 30), `matriz do ${s} soma ${n}`));
    ok(Object.keys(soma).length === 14, '12 séries + 2 tipos de Extra na matriz');
    ok(D.carga.some(c => c.turmas.join('+') === '5A+5B' && c.disciplina === 'Educação Física'), 'Ed. Física 5A + 5B junta');
    ok(D.carga.some(c => c.turmas.join('+') === 'Extra 6A+Extra 6B' && c.disciplina === 'Futebol'), 'Extras do 6º ao EM juntos em grupos');
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

  await caso('Disponibilidade em intervalos (sobreposição estrita) e blocos do professor', async () => {
    const d = mini({ carga: [{ turmas: ['6A'], disciplina: 'Mat', professor: 'P', aulas: 1, duplas: 0, maxDia: 1 }] });
    d.professores[0].indisp = [nao('Seg', '07:00', '08:00')];
    ok(G.modelo(d).impede(0, 0, min('08:00'), min('08:50')) === '', 'aula que só encosta na ponta (8:00) não é bloqueada');
    ok(G.modelo(d).impede(0, 0, min('07:40'), min('08:20')) === 'indisp', 'aula que cruza o intervalo (7:40–8:20) é bloqueada');
    d.blocos = [{ professor: 'P', tipo: 'Complementação de Carga Horária', dia: 'Seg', ini: '08:40', fim: '09:00' }];
    const M = G.modelo(d);
    ok(M.impede(0, 0, min('07:10'), min('08:00')) === 'indisp', '7:10–8:00 cai no intervalo 7:00–8:00');
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
    const p = D2.professores.find(x => x.nome === alvo); p.indisp = p.indisp.concat([{ dia: D.dias[+ds], ini: h * 60, fim: h * 60 + 60 }]);
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
    d.professores[0].indisp = [nao('Seg', '07:00', '08:00')];   // P não pode 7h–8h (pega 7:00–7:40 e 7:40–8:20) → precisa de uma vaga de C
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
      'Lab de Red': 'Laboratório de Redação', 'Recreacao': 'Recreação', 'Ed. Física': 'Educação Física', 'Qui': 'Química', 'Fis': 'Física', 'Bio': 'Biologia',
      'Voleibol': 'Vôlei', 'Def. Pessoal': 'Defesa Pessoal', 'Futebol': 'Futebol' };
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
    ok(d.grades[0].nome === 'Manhã' && d.grades.length === 3, 'turno vira grade (e os 2 horários do Extra entram)');
    const it = d.grades[0].itens;
    ok(it.length === 7 && it[3].tipo === 'intervalo' && it[3].ini === '09:30' && it[3].fim === '09:50' && it[4].ini === '09:50', 'horários e intervalo reais');
    ok(d.turmas[0].grade === 'Manhã' && d.turmas[0].segmento === 'EFAF' && d.turmas[0].serie === '6º ano', 'turma com segmento/série/grade');
    ok(d.turmas[1].segmento === 'EM' && d.turmas[1].serie === '1ª série' && d.turmas[2].segmento === 'EFAI', 'EM e EFAI deduzidos');
    const p = d.professores[0];
    ok(p.disciplinas === 'Física' && p.tel === '11 9999' && p.maxDia === 5 && p.obs === 'obs', 'colunas do professor no lugar');
    const txt = p.indisp.map(x => x.dia + ' ' + x.ini + '-' + x.fim).join(',');
    ok(txt === 'Seg 420-470,Ter 590-640', 'disponibilidade migrada para o horário real da aula (' + txt + ')');
    ok(d.turmas.filter(t => t.segmento === 'Extra').map(t => t.extraDe[0]).join() === '6º A,1ª EM,3º ano', 'turmas da manhã ganham o Extra');
    ok(d.carga[0].turmas[0] === '6º A', 'carga mantida');
    ok(d.componentes.length > 30 && d.matriz.length > 50, 'componentes e matriz padrão criados');
    ok(v.props.ESQUEMA === '10', 'versão gravada');
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
    p.indisp = ['Seg', 'Ter', 'Qua', 'Qui'].map(dia => nao(dia, '07:00', '13:00'));
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
    ok(d.turmas.some(t => t.nome === 'Extra 5º B' && t.extraDe.join() === '5º B') && !d.turmas.some(t => t.nome === 'Extra 5B'), 'renomear a turma renomeia o Extra dela');
    ok(d.carga.filter(c => c.turmas.includes('Extra 5º B')).length === 7 && !d.carga.some(c => c.turmas.includes('Extra 5B')), '…e as atribuições do Extra');
    v.ctx.excluirTurma_({ nome: '5º B' }, s);
    ok(v.dados().carga.some(c => c.turmas.join('|') === '5A' && c.disciplina === 'Educação Física'), 'excluir turma tira só ela da linha junta');
    ok(!v.dados().turmas.some(t => t.nome === 'Extra 5º B') && !v.dados().carga.some(c => c.turmas.includes('Extra 5º B')), 'excluir a turma apaga o Extra dela');
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
    ok(w.props.ESQUEMA === '10' && d.versoes.length === 1 && d.versoes[0].descricao === 'Grade oficial que já estava salva', 'migração v5 → v6 guarda a grade que já existia');
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
    d.professores.push({ nome: 'S', indisp: [nao('Seg', '07:00', '08:00')] });   // quem entra não pode 7h–8h
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
    v.ctx.salvarProfessor_({ nomeAntigo: 'Otávio P.', nome: 'Otávio P.', materias: ['Matemática'], segmentos: ['EFAF'], indisp: [nao('Seg', '07:00', '08:00')], blocos: [] }, s);
    ok(JSON.stringify(v.dados().carga) === JSON.stringify(d2.carga), 'sem turmas na chamada, as atribuições não mudam');
  });

  await caso('Começar ano letivo: guarda, apaga o que muda e mantém a estrutura', () => {
    if (!oficial) return ok(false, 'sem grade oficial');
    for (const opcao of ['manter', 'apagar']) {
      const v = criarAmbiente(); v.ctx.gravarExemplo_();
      const s = { u: 'admin', nome: 'Admin', perfil: 'admin' }, erro = fn => { try { fn(); return ''; } catch (e) { return e.message; } };
      v.ctx.salvarGrade_({ grade: oficial, vigencia: '2026-02-02' }, s);
      v.ctx.salvarProfessor_(Object.assign({}, v.dados().professores.find(p => p.nome === 'Bianca'), { nomeAntigo: 'Bianca', indisp: [nao('Seg', '07:00', '08:00')], conferida: true, blocos: [] }), s);
      v.ctx.conferirEstrutura_({ ok: true });
      const d0 = v.dados();
      ok(d0.ano.conferido && d0.professores.find(p => p.nome === 'Bianca').conferida, 'antes: conferido e disponibilidade de Bianca conferida');
      ok(/ano/.test(erro(() => v.ctx.comecarAno_({ ano: '27', professores: opcao }, s))) && /professores/.test(erro(() => v.ctx.comecarAno_({ ano: '2027' }, s))), 'pede o ano e a escolha dos professores');
      v.ctx.comecarAno_({ ano: '2027', professores: opcao }, s);
      const d = v.dados();
      ok(Object.keys(d.grade).length === 0 && d.fixas.length === 0 && d.blocos.length === 0, `${opcao}: grade oficial, aulas fixas e horários reservados apagados`);
      ok(d.carga.length >= d0.carga.length && d.carga.every(c => !c.professor), `${opcao}: matérias das turmas ficam, sem professor`);
      ok(d.carga.some(c => c.turmas.join('+') === '5A+5B') && d.carga.some(c => c.turmas.join('+') === 'Extra 6A+Extra 6B') && d.carga.some(c => c.disciplina === 'Lição de Casa' && c.posicao === 1), `${opcao}: turmas juntas e Extra continuam`);
      ok(d.versoes.length === 2 && /antes de começar 2027/.test(d.versoes[0].descricao), `${opcao}: a grade de hoje foi para o histórico`);
      ok(JSON.stringify(d.grades) === JSON.stringify(d0.grades) && d.turmas.length === d0.turmas.length && d.matriz.length === d0.matriz.length && d.usuarios.length === d0.usuarios.length, `${opcao}: horários, turmas, matriz e usuários mantidos`);
      if (opcao === 'apagar') ok(d.professores.length === 0, 'apagar: professores apagados');
      else ok(d.professores.length === d0.professores.length && d.professores.every(p => !p.conferida) && JSON.stringify(d.professores.find(p => p.nome === 'Bianca').indisp) === JSON.stringify([nao('Seg', '07:00', '08:00')]), 'manter: professores ficam, voltam a "a conferir" e guardam a disponibilidade');
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
    const app = ler('App.html'), estilo = ler('Estilo.html'), comum = ler('Comum.html');
    const telas = [...app.matchAll(/\{ id: '(\w+)', nome: '([^']+)'([^\n]*)\}/g)];
    ok(telas.filter(t => !/pai:/.test(t[3])).map(t => t[2]).join(' · ') === 'Início · Grade horária · Professores · Conferência das turmas · Configuração', 'menu: ' + telas.filter(t => !/pai:/.test(t[3])).map(t => t[2]).join(' · '));
    ok(telas.filter(t => /pai: 'config'/.test(t[3])).map(t => t[2]).join(' · ') === 'Começar ano letivo · Horários das aulas · Turmas · Matriz curricular · Aulas fixas · Usuários', 'cartões da Configuração na ordem');
    ok(!/\(raro\)|Dia a dia|telaAtribuicoes/.test(app), 'sem "(raro)", sem grupos e sem a tela Atribuições');
    ok(/← Configuração/.test(app), 'botão “← Configuração”');
    ok(/abrirMenu/.test(app) && /btn-menu/.test(app) && /\.menu\.aberto/.test(app), 'menu ☰ com gaveta');
    ok(/function listaDiaTurma/.test(app) && /dias-abas/.test(app) && /só aparece no computador/.test(app), 'grade no celular: um dia por vez; todas as turmas só no computador');
    ok(/max-width:700px/.test(estilo) && /table\.cartao/.test(estilo) && /min-height:44px/.test(estilo) && /\.modal \.caixa \{ max-width:none; min-height:100%/.test(estilo), 'celular: cartões, toque de 44px e janelas em tela cheia');
    ok(/disp-grade/.test(comum) && /disp-dia/.test(comum) && /disp-hora/.test(comum) && /disp-int/.test(comum), 'quadro de disponibilidade: agenda (dias nas colunas), intervalos em cinza');
    ok(!/ontraturno/.test(app + comum + ler('Codigo.js').replace(/\/contraturno\/i?g?|Contraturno…|"Contraturno…"/g, '')), '“Contraturno” virou “Extra” em todos os textos');
    ok(/Passar \$\{l\.turmas\.join\(' \+ '\)\} de \$\{l\.professor\} para/.test(app) && /textoGrupo/.test(app) && /Não cabe:/.test(app), 'professor: passar turma, atalho por série e aviso de não caber');
    ok(/turmas completas/.test(app) && /conf-extra/.test(app) && /Sem professor \(/.test(app), 'conferência: resumo, contraturno recolhido e sem professor no topo');
  });

  await caso('Sem formulário dos professores: só o sistema, com login', () => {
    const fs = require('fs'), path = require('path'), raiz = path.join(__dirname, '..');
    ok(!fs.existsSync(path.join(raiz, 'apps-script', 'Formulario.html')) && !fs.existsSync(path.join(raiz, 'docs', 'professor')), 'sem Formulario.html e sem docs/professor/');
    const v = criarAmbiente();
    ['formLista', 'formDados', 'formEnviar', 'aprovarProfessor_', 'recusarProfessor_', 'apagarTeste_', 'hashCodigo_', 'criarProfessoresTeste_', 'criarTeste'].forEach(f => ok(typeof v.ctx[f] === 'undefined', f + ' não existe mais'));
    const ACOES = vm.runInContext('ACOES', v.ctx);
    ok(!ACOES.aprovarProfessor && !ACOES.recusarProfessor && !ACOES.apagarTeste, 'API sem aprovar, recusar e apagar teste');
    let arquivo = '';
    const pag = { evaluate: () => pag, setTitle: () => pag, setFaviconUrl: () => pag, addMetaTag: () => pag, setXFrameOptionsMode: () => pag };
    v.ctx.HtmlService = { createTemplateFromFile: f => { arquivo = f; return pag; }, XFrameOptionsMode: {} };
    v.ctx.doGet({ parameter: { form: '1' } });
    ok(arquivo === 'App', '?form=1 abre o sistema (login)');
    const docs = fs.readFileSync(path.join(raiz, 'docs', 'index.html'), 'utf8'), d404 = fs.readFileSync(path.join(raiz, 'docs', '404.html'), 'utf8');
    ok(!/form/.test(docs.replace(/formulário/g, '')), 'docs/index.html não repassa ?form=1');
    ok(/url=\//.test(d404) && /location\.replace\('\/'\)/.test(d404), 'endereço que não existe (o antigo /professor/) volta para o login');
    const app = fs.readFileSync(path.join(raiz, 'apps-script', 'App.html'), 'utf8');
    ok(!/formulário|Formulário|CPF|código do formulário|respondeu|wa\.me\/\?text/.test(app), 'telas sem formulário, CPF, código e “respondeu”');
  });

  await caso('Migração sem formulário: colunas novas, sem perder matérias, segmentos, disponibilidade nem atribuições', () => {
    const v = criarAmbiente(); v.ctx.gravarExemplo_();
    const prof = v.ss.getSheetByName('Professores');
    prof.d = [['Professor (nome curto)', 'Nome completo', 'Disciplinas', 'WhatsApp', 'Máx. aulas por dia', 'Indisponível (dia faixa)', 'Respondeu em', 'Observação', 'Segmentos', 'Código do formulário (não editar)', 'Situação (Aprovado / Aguardando aprovação)'],
      ['Bianca', 'Bianca Moreira Lins', 'Língua Portuguesa, Matemática', '11 90000-0000', 5, 'Seg 7h; Seg 8h; Ter 13h', '03/02/2026 10:00', 'só de manhã', 'EFAI', 'v1:abc:def', 'Aprovado'],
      ['Carla', 'Carla Nogueira Pires', 'Língua Inglesa', '', '', '', '', '', 'EFAI, EFAF', '', ''],
      ['Renata Exemplo Duarte', 'Renata Exemplo Duarte', 'Arte', '(11) 90000-0001', '', 'Qua 7h', '04/02/2026 09:00', 'oi', '', 'v1:x:y', 'Aguardando aprovação'],
      ['Ana (teste)', 'Ana Modelo (teste)', 'Matemática', '', '', '', '', '', 'EFAF', 'v1:a:b', 'Aprovado'],
      ['Bruno (teste)', 'Bruno Modelo (teste)', 'Matemática', '', '', '', '', '', 'EFAF', 'v1:a:b', 'Aprovado']];
    const carga = v.ss.getSheetByName('Carga');
    carga.d.find(r => r[0] === '6A' && r[1] === 'Arte')[2] = 'Ana (teste)';
    v.ss.getSheetByName('Blocos').d.push(['Bruno (teste)', 'Plantão de Dúvidas', 'Matemática', 'Seg', '14:00', '15:00']);
    v.props.SAL_CODIGO = 'sal'; v.props.PROFS_TESTE = '1'; v.props.ESQUEMA = '8'; delete v.props.SEM_FORMULARIO;   // como na planilha real: primeira vez
    v.ctx.garantirEsquema_();
    const cab = prof.d[0], d = v.dados(), P = n => d.professores.find(p => p.nome === n);
    ok(v.props.ESQUEMA === '10' && cab.length === 9 && cab[5] === 'Não pode (dia início-fim)' && cab[6] === 'Disponibilidade conferida em', 'cabeçalho novo (9 colunas)');
    ok(prof.d.slice(1).every(r => !r.slice(9).some(x => x !== '' && x !== undefined)), 'código e situação saíram da planilha');
    ok(P('Bianca').materias.join() === 'Língua Portuguesa,Matemática' && P('Bianca').segmentos.join() === 'EFAI' && P('Bianca').tel === '11 90000-0000' && P('Bianca').maxDia === 5 && P('Bianca').obs === 'só de manhã', 'matérias, segmentos e outros dados mantidos');
    ok(JSON.stringify(P('Bianca').indisp) === JSON.stringify([nao('Seg', '07:00', '09:00'), nao('Ter', '13:00', '14:00')]), 'faixas de 1h viram intervalos (e se juntam): ' + JSON.stringify(P('Bianca').indisp));
    ok(prof.d.find(r => r[0] === 'Bianca')[5] === 'Seg 07:00-09:00; Ter 13:00-14:00', 'na planilha: “Seg 07:00-09:00; Ter 13:00-14:00”');
    ok(!P('Bianca').conferida && !d.professores.some(p => p.conferida), '“respondeu” não vira “conferida”: a coordenação confere cada um');
    ok(P('Renata Exemplo Duarte') && P('Renata Exemplo Duarte').indisp.length === 1, 'quem aguardava aprovação continua, como professor comum');
    ok(!P('Bruno (teste)') && !d.blocos.some(b => /Bruno/.test(b.professor)), 'professor “(teste)” sem turmas: apagado, com os horários reservados');
    ok(P('Ana (teste)') && d.carga.find(c => c.turmas[0] === '6A' && c.disciplina === 'Arte').professor === 'Ana (teste)', 'professor “(teste)” com turma fica: a migração não mexe em atribuições');
    ok(d.carga.filter(c => c.professor === 'Bianca').length > 0, 'atribuições dos outros professores mantidas');
    ok(!v.props.SAL_CODIGO && !v.props.PROFS_TESTE, 'propriedades do formulário apagadas');
    ok(v.ss.getSheetByName('Registro').d.some(r => /Apagou os professores de teste \(Bruno \(teste\)\)/.test(r[2])) && v.ss.getSheetByName('Registro').d.some(r => /Não apagou professores de teste com atribuições \(Ana \(teste\)\)/.test(r[2])), 'fica anotado no Registro');
    // a versão antiga do site (ainda publicada) refaz o cabeçalho velho e volta o ESQUEMA para 8: a nova migra de novo sem perder "conferida"
    v.ctx.salvarProfessor_(Object.assign({}, P('Carla'), { nomeAntigo: 'Carla', conferida: true, blocos: [] }), { u: 'x' });
    const quando = v.dados().professores.find(p => p.nome === 'Carla').conferida;
    prof.d[0] = ['Professor (nome curto)', 'Nome completo', 'Disciplinas', 'WhatsApp', 'Máx. aulas por dia', 'Indisponível (dia faixa)', 'Respondeu em', 'Observação', 'Segmentos', 'Código do formulário (não editar)', 'Situação (Aprovado / Aguardando aprovação)'];
    v.props.ESQUEMA = '8'; v.ctx.garantirEsquema_();
    ok(quando && v.dados().professores.find(p => p.nome === 'Carla').conferida === quando && JSON.stringify(v.dados().professores.find(p => p.nome === 'Bianca').indisp) === JSON.stringify(P('Bianca').indisp), 'vaivém com a versão antiga: “conferida” e disponibilidade continuam');
  });

  await caso('Disponibilidade conferida: a coordenação marca no cadastro', () => {
    const v = criarAmbiente(); v.ctx.gravarExemplo_();
    const s = { u: 'teste', perfil: 'admin' }, base = n => Object.assign({}, v.dados().professores.find(p => p.nome === n), { nomeAntigo: n, blocos: [] });
    v.ctx.salvarProfessor_(Object.assign(base('Débora'), { conferida: false }), s);
    ok(!v.dados().professores.find(p => p.nome === 'Débora').conferida, 'desmarcada');
    v.ctx.salvarProfessor_(Object.assign(base('Débora'), { conferida: true, indisp: [nao('Qua', '13:00', '19:00'), { dia: 'Xyz', ini: 1, fim: 2 }, nao('Qua', '12:00', '13:00')] }), s);
    const deb = v.dados().professores.find(p => p.nome === 'Débora');
    ok(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(deb.conferida), 'marcada: guarda quando (' + deb.conferida + ')');
    ok(JSON.stringify(deb.indisp) === JSON.stringify([nao('Qua', '12:00', '19:00')]), 'intervalos válidos e juntados (o inválido sai)');
    v.ctx.gravar_('Professores', v.ctx.valores_('Professores').map(r => { if (r[0] === 'Débora') r[6] = '01/02/2026 08:00'; return r; }));
    v.ctx.salvarProfessor_(Object.assign(base('Débora'), { conferida: true }), s);
    ok(v.dados().professores.find(p => p.nome === 'Débora').conferida === '01/02/2026 08:00', 'salvar de novo mantém a data');
    ok(/Disponibilidade conferida ✓/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'apps-script', 'App.html'), 'utf8')), 'marca “Disponibilidade conferida ✓” no cadastro');
  });

  await caso('Quadro de disponibilidade: aulas reais (um horário no período) ou 30 min (vários)', () => {
    const fs = require('fs'), path = require('path'), dir = path.join(__dirname, '..', 'apps-script');
    const comum = fs.readFileSync(path.join(dir, 'Comum.html'), 'utf8'), estilo = fs.readFileSync(path.join(dir, 'Estilo.html'), 'utf8'), app = fs.readFileSync(path.join(dir, 'App.html'), 'utf8');
    const fn = nome => (new RegExp('function ' + nome + '\\([\\s\\S]*?\\r?\\n}\\r?\\n').exec(app) || [''])[0];
    const c = { console, Math, JSON, document: { addEventListener() { }, querySelectorAll: () => [] }, window: {}, D: criarAmbiente().ctx.dados_ ? null : null };
    vm.createContext(c);
    const amb2 = criarAmbiente(); amb2.ctx.gravarExemplo_(); c.D = amb2.dados();
    vm.runInContext(comum.match(/<script>([\s\S]*?)<\/script>/)[1] + '\nconst gradeDe = n => D.grades.find(g => g.nome === n);\n' + fn('gradesDoProf') + fn('turnosDisp')
      + ';this.R = { htmlDisp, dispDe, dispLista, dispAdd, dispTirar, dispCobre, gradesDoProf, turnosDisp };', c);
    const R = c.R, dias = c.D.dias;
    const so = R.turnosDisp(R.gradesDoProf(['EFAF'], []));
    ok(so.map(t => t.periodo).join() === 'Manhã,Tarde' && so[0].nota === 'EFAF Manhã' && so[1].nota === 'EFAF/EM Tarde', 'um segmento: as aulas reais da grade dele, Manhã antes de Tarde');
    ok(so[0].linhas.map(l => l.tipo === 'aula' ? l.rot : 'int').join() === '1ª,2ª,3ª,int,4ª,5ª,6ª' && so[0].linhas[0].ini === min('07:10') && so[0].linhas[0].fim === min('08:00'), 'linhas “1ª · 7:10–8:00”… com o intervalo no lugar');
    const h = R.htmlDisp(dias, so);
    ok(/<span class="disp-int">intervalo · 9:40–10:10<\/span>/.test(h), 'intervalo em cinza (linha inteira)');
    ok(/class="disp-hora"[^>]*>1ª<small>7:10–8:00<\/small>/.test(h) && h.indexOf('>Seg<') < h.indexOf('1ª<small>'), 'topo com os dias; lateral “1ª · 7:10–8:00”');
    ok(/data-dia="Seg" data-ini="420" data-fim="780" onclick="dispGrupo/.test(h) && /class="disp-hora" data-t="0" data-ini="430" data-fim="480" onclick="dispGrupo/.test(h), 'tocar no dia = manhã inteira; tocar na linha = aquele horário em todos os dias');
    const varios = R.turnosDisp(R.gradesDoProf(['EFAF', 'EM'], []));
    ok(varios[0].linhas.every(l => l.tipo === 'faixa' && l.fim - l.ini === 30) && varios[0].linhas[0].ini === min('07:00') && varios[0].linhas.slice(-1)[0].fim === min('13:00'), 'vários horários no período (EFAF × EM de manhã): faixas de 30 min');
    R.dispDe([nao('Seg', '07:00', '08:00')]);
    ok(R.dispCobre('Seg', min('08:00'), min('08:50')) === 0 && R.dispCobre('Seg', min('07:40'), min('08:20')) === 1 && R.dispCobre('Seg', min('07:10'), min('08:00')) === 2, 'livre / parte marcada (já bloqueia) / inteiro marcado');
    R.dispAdd('Seg', min('08:00'), min('08:50')); R.dispTirar('Seg', min('07:20'), min('07:40'));
    ok(JSON.stringify(R.dispLista()) === JSON.stringify([nao('Seg', '07:00', '07:20'), nao('Seg', '07:40', '08:50')]), 'marcar junta, desmarcar tira só o pedaço');
    ok(/Copiar a disponibilidade de outro professor/.test(app) && /Aulas bloqueadas por esta disponibilidade/.test(app), 'copiar de outro professor e aulas bloqueadas por horário das aulas');
    // 360px: tela cheia no celular (corpo da janela com 14px de cada lado); coluna do horário + 5 colunas com 4px de espaço
    const cel = estilo.slice(estilo.indexOf('@media (max-width:700px)'));
    const m = /\.disp-grade \{ grid-template-columns:(\d+)px repeat\(var\(--n, 5\), minmax\(0, 1fr\)\); gap:(\d+)px/.exec(cel), corpo = +(/\.modal \.corpo \{ padding:(\d+)px/.exec(cel) || [])[1];
    ok(!!m && corpo > 0, 'grade com minmax(0, 1fr): nunca estoura a largura');
    if (m) { const col = (360 - 2 * corpo - +m[1] - 5 * +m[2]) / 5; ok(+m[1] <= 56 && col >= 40, `em 360px: horário ${m[1]}px e cada dia com ${col.toFixed(1)}px`); }
    const alt = k => +(new RegExp('\\.' + k + ' \\{[^}]*min-height:(\\d+)px').exec(estilo) || [])[1];
    ok(alt('slot') >= 44 && alt('disp-dia, \\.disp-hora') >= 44, 'toque com pelo menos 44px de altura');
  });

  await caso('Capacidade por período: 40 aulas de manhã onde só cabem 30', () => {
    const v = criarAmbiente(), gp = v.ctx.gradesPadrao_(), itens = n => gp.filter(r => r[0] === n).map(r => ({ tipo: r[1] === 'Intervalo' ? 'intervalo' : 'aula', ini: r[2], fim: r[3] }));
    const L = (t, n, p) => ({ turmas: [t], disciplina: 'Mat ' + t, professor: p || 'Jean', aulas: n, duplas: 0, maxDia: 2 });
    const d = { dias: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'], grades: [{ nome: 'EFAF Manhã', itens: itens('EFAF Manhã') }, { nome: 'EM Manhã', itens: itens('EM Manhã') }, { nome: 'EFAF/EM Tarde', itens: itens('EFAF/EM Tarde') }],
      professores: [{ nome: 'Jean', indisp: [] }], turmas: [['6A', 'EFAF Manhã'], ['6B', 'EFAF Manhã'], ['1A', 'EM Manhã'], ['1B', 'EM Manhã'], ['6C', 'EFAF/EM Tarde']].map(([nome, grade]) => ({ nome, grade, segmento: 'EFAF' })),
      carga: [L('6A', 10), L('6B', 10), L('1A', 10), L('1B', 10)], fixas: [], blocos: [] };
    let M = G.modelo(d);
    ok(!M.erros.some(e => /horários livres/.test(e)), 'por horário das aulas, cabia (20 de 30 em cada): o bug antigo');
    ok(M.sobrecarga.Jean && M.sobrecarga.Jean.periodo === 'manhã' && M.sobrecarga.Jean.aulas === 40 && M.sobrecarga.Jean.livres === 30, 'por período: 40 de manhã, só cabem 30 (' + JSON.stringify(M.sobrecarga.Jean) + ')');
    ok(M.erros.includes('Jean: 40 aulas de manhã, mas só cabem 30 — passe algumas turmas para outro professor.'), 'mensagem da pendência vermelha');
    ok(JSON.stringify(M.capacidade.Jean) === JSON.stringify([{ periodo: 'manhã', aulas: 40, cabem: 30 }]), 'capacidade por período para o cadastro');
    d.carga = [L('6A', 10), L('6B', 8), L('1A', 10)];
    M = G.modelo(d);
    ok(!M.sobrecarga.Jean && M.apertado.Jean && M.apertado.Jean[0].aulas === 28 && M.apertado.Jean[0].cabem === 30, '28 de 30: “apertado” (acima de 90%)');
    d.professores[0].indisp = [nao('Seg', '07:00', '13:00')];
    ok(G.modelo(d).sobrecarga.Jean.livres === 24, 'a disponibilidade tira da capacidade (segunda de manhã fora: 24)');
    d.professores[0].indisp = []; d.carga.push(L('6C', 31));
    M = G.modelo(d);
    ok(M.capacidade.Jean.map(c => c.periodo).join() === 'manhã,tarde' && M.sobrecarga.Jean.periodo === 'tarde', 'tarde conta separado da manhã');
    const D2 = JSON.parse(JSON.stringify(D)); D2.carga.filter(c => c.professor === 'Sandra').forEach(c => c.aulas += 3);
    ok(G.modelo(D2).sobrecarga.Sandra || G.modelo(D2).apertado.Sandra, 'no exemplo, dar mais aulas a uma professora acende o aviso');
    const app = require('fs').readFileSync(require('path').join(__dirname, '..', 'apps-script', 'App.html'), 'utf8');
    ok(/Ver as turmas/.test(app) && /M\.apertado/.test(app) && /msgSobrecarga/.test(app), 'pendência vermelha com botão para as turmas, aviso de apertado e motivo no cadastro');
    ok(/nomeProvisorio/.test(app) && /não está no cadastro|não estão' : 'essas matérias não estão'|no cadastro do professor/.test(app), 'pendências de nome provisório e de matéria fora do cadastro');
  });

  await caso('Extra: um para cada turma da manhã, lendo as turmas da planilha', () => {
    const v = criarAmbiente(); v.ctx.gravarExemplo_();
    const s = { u: 'teste', perfil: 'admin' }, d0 = v.dados(), ex = d0.turmas.filter(t => t.segmento === 'Extra');
    const manha = d0.turmas.filter(t => t.segmento !== 'Extra' && /Manhã/.test(t.grade));
    ok(manha.every(t => ex.filter(x => x.extraDe.includes(t.nome)).length === 1), 'cada turma da manhã tem o seu Extra');
    ok(!ex.some(x => x.extraDe.some(t => ['1B', '6C', '1 EM C'].includes(t))), 'turmas da tarde não têm Extra');
    ok(ex.find(x => x.nome === 'Extra 1A').grade === 'Extra 1º ao 5º' && ex.find(x => x.nome === 'Extra 6B').grade === 'Extra 6º ao EM' && ex.find(x => x.nome === 'Extra 2 EM A').serie === 'Extra 6º ao EM', 'EFAI → Extra 1º ao 5º; EFAF e EM → Extra 6º ao EM');
    v.ctx.salvarTurma_({ nome: '1C', segmento: 'EFAI', serie: '1º ano', grade: 'EFAI Manhã' }, s);
    let d = v.dados(), x = d.turmas.find(t => t.nome === 'Extra 1C'), l = d.carga.filter(c => c.turmas.includes('Extra 1C'));
    ok(x && x.extraDe.join() === '1C' && x.grade === 'Extra 1º ao 5º', 'turma nova da manhã ganha o Extra');
    ok(l.length === 7 && l.every(c => !c.professor) && l.find(c => c.disciplina === 'Lição de Casa').posicao === 1 && l.find(c => c.disciplina === 'Recreação').posicao === 3, '…com a matriz do Extra, sem professor e com a aula fixa do dia');
    v.ctx.salvarTurma_({ nome: '2C', segmento: 'EFAI', serie: '2º ano', grade: 'EFAI Tarde' }, s);
    ok(!v.dados().turmas.some(t => t.nome === 'Extra 2C'), 'turma da tarde não ganha Extra');
    v.ctx.salvarTurma_({ nomeAntigo: '1C', nome: '1D', segmento: 'EFAI', serie: '1º ano', grade: 'EFAI Manhã' }, s);
    d = v.dados();
    ok(d.turmas.some(t => t.nome === 'Extra 1D' && t.extraDe.join() === '1D') && !d.turmas.some(t => t.nome === 'Extra 1C') && d.carga.filter(c => c.turmas.includes('Extra 1D')).length === 7, 'turma renomeada leva o Extra junto');
    v.ctx.salvarTurma_({ nomeAntigo: '1D', nome: '1D', segmento: 'EFAI', serie: '1º ano', grade: 'EFAI Tarde' }, s);
    ok(!v.dados().turmas.some(t => t.nome === 'Extra 1D') && !v.dados().carga.some(c => c.turmas.includes('Extra 1D')), 'turma que foi para a tarde perde o Extra');
    v.ctx.extraTurma_({ turma: '2A', tem: false }, s);
    d = v.dados();
    ok(d.turmas.find(t => t.nome === '2A').semExtra && !d.turmas.some(t => t.nome === 'Extra 2A'), '“não tem Extra”: o Extra sai');
    v.ctx.extraTurma_({ turma: '2A', tem: true }, s);
    ok(v.dados().carga.filter(c => c.turmas.includes('Extra 2A')).every(c => !c.professor) && v.dados().turmas.some(t => t.nome === 'Extra 2A'), 'volta a ter Extra (matérias da matriz, “a definir”)');
    v.ctx.excluirTurma_({ nome: '1A' }, s);
    ok(!v.dados().turmas.some(t => t.nome === 'Extra 1A') && !v.dados().carga.some(c => c.turmas.includes('Extra 1A')), 'turma apagada leva o Extra');
    // juntar e separar
    v.ctx.juntarExtra_({ turma: '3A', com: 'Extra 4A' }, s);
    d = v.dados();
    const juntas = d.carga.filter(c => c.turmas.includes('Extra 3A'));
    ok(juntas.length === 7 && juntas.every(c => c.turmas.join('+') === 'Extra 3A+Extra 4A') && !d.carga.some(c => c.turmas.join() === 'Extra 4A'), 'juntar: cada matéria vira turmas juntas (mesmo horário e professor)');
    ok(juntas.find(c => c.disciplina === 'Lição de Casa').professor === 'Mônica', '…com o professor do primeiro Extra');
    ok(/horários diferentes/.test(erroDe(() => v.ctx.juntarExtra_({ turma: 'Extra 5A', com: 'Extra 6A' }, s))), 'não junta Extras de tipos diferentes');
    v.ctx.separarExtra_({ turma: 'Extra 4A' }, s);
    d = v.dados();
    ok(d.carga.filter(c => c.turmas.join() === 'Extra 4A').length === 7 && d.carga.filter(c => c.turmas.join() === 'Extra 3A').length === 7, 'separar: cada um com as próprias aulas');
    const ACOES = vm.runInContext('ACOES', v.ctx);
    ok(['extraTurma', 'juntarExtra', 'separarExtra'].every(a => ACOES[a] && ACOES[a].p.indexOf('consulta') < 0), 'consulta não mexe no Extra');
  });

  await caso('Migração do Extra (proposta 2027): apaga o antigo, cria horários, matérias, matriz e um Extra por turma da manhã', () => {
    const v = criarAmbiente(); v.ctx.gravarExemplo_();
    const ctx = v.ctx;
    ctx.removerTurmas_(v.dados().turmas.filter(t => t.segmento === 'Extra').map(t => t.nome));
    ctx.gravar_('Config', ctx.valores_('Config').filter(r => !/^Extra/.test(r[0])).concat(ctx.gradesPadrao_([['Contraturno', '13:00-14:00 14:00-15:00 15:00-16:00 16:00-17:00'], ['Contraturno manhã', '11:00-12:00']])));
    ctx.gravar_('Turmas', ctx.valores_('Turmas').concat([['EXTRA 1º ano A', 'Extra', '', 'Contraturno'], ['6º/7º', 'Extra', '', 'Contraturno'], ['EXTRA EFAI tarde', 'Extra', '', 'Contraturno manhã']]));
    ctx.gravar_('Componentes', ctx.valores_('Componentes').filter(r => !['Defesa Pessoal', 'Futebol'].includes(r[0])).map(r => r[0] === 'Vôlei' ? ['Voleibol', 'Vôlei', ''] : r));
    ctx.gravar_('Matriz', ctx.valores_('Matriz').filter(r => !/^Extra/.test(r[0])));
    ctx.gravar_('Carga', ctx.valores_('Carga').concat([['EXTRA 1º ano A', 'Lição de Casa', 'Jussara', 4, 0, 2], ['6º/7º', 'Voleibol', 'Mônica', 2, 0, 2], ['EXTRA EFAI tarde', 'Informática', 'Kátia', 2, 0, 2]]));
    ctx.gravar_('Grade', [['EXTRA 1º ano A', 'Seg', 1, '13:00–14:00', 'Lição de Casa', 'Jussara'], ['1A', 'Seg', 1, '07:00–07:40', 'Matemática', 'Bianca']]);
    delete v.props.EXTRA_2027; v.props.ESQUEMA = '8';
    ctx.garantirEsquema_();
    const d = v.dados(), nomes = d.turmas.map(t => t.nome);
    ok(!nomes.some(n => /^EXTRA |6º\/7º/.test(n)) && !d.carga.some(c => c.turmas.some(t => /^EXTRA |6º\/7º/.test(t))), 'grupos antigos do Extra e as atribuições deles apagados');
    ok(!d.grades.some(g => /Contraturno/.test(g.nome)), 'horários “Contraturno” e “Contraturno manhã” apagados');
    const g1 = d.grades.find(g => g.nome === 'Extra 1º ao 5º'), g2 = d.grades.find(g => g.nome === 'Extra 6º ao EM');
    ok(g1 && g1.itens.map(i => i.ini + '-' + i.fim).join() === '13:00-14:00,14:00-15:00,15:00-16:00,16:00-17:00', 'Extra 1º ao 5º: 13h–17h, 4 aulas');
    ok(g2 && g2.itens.map(i => i.ini + '-' + i.fim).join() === '14:00-15:00,15:00-16:00,16:00-17:00', 'Extra 6º ao EM: 14h–17h, 3 aulas');
    const vol = d.componentes.find(c => c.nome === 'Vôlei');
    ok(vol && vol.apelidos.includes('Voleibol') && !d.componentes.some(c => c.nome === 'Voleibol') && ['Defesa Pessoal', 'Futebol', 'Lição de Casa', 'Recreação', 'Reforço', 'Teatro'].every(n => d.componentes.some(c => c.nome === n)), 'Voleibol → Vôlei; Defesa Pessoal e Futebol criados');
    ok(d.matriz.filter(m => m.serie === 'Extra 1º ao 5º').length === 7 && d.matriz.filter(m => m.serie === 'Extra 6º ao EM').length === 3, 'matriz do Extra criada');
    const ex = d.turmas.filter(t => t.segmento === 'Extra');
    ok(ex.length === 21 && ex.every(t => t.extraDe.length === 1), '21 Extras, um para cada turma da manhã');
    ok(d.carga.filter(c => c.turmas.some(t => /^Extra /.test(t))).every(c => !c.professor) && d.carga.some(c => c.turmas.join() === 'Extra 1A' && c.disciplina === 'Lição de Casa' && c.posicao === 1), 'Extras com as matérias da matriz, “a definir”');
    ok(Object.keys(d.grade).length === 2 && !d.versoes.length, 'grade oficial e histórico não mudam (aula do grupo antigo fica, sem turma, e é ignorada)');
    const reg = v.ss.getSheetByName('Registro').d.map(r => r[2]).join('\n');
    ok(/Novo Extra \(proposta 2027\): apagou 3 grupo\(s\) do Extra antigo \(EXTRA 1º ano A, 6º\/7º, EXTRA EFAI tarde\) e 3 atribuição/.test(reg) && /criou 21 Extra/.test(reg), 'o que foi apagado e criado fica no Registro');
    v.props.ESQUEMA = '8'; ctx.garantirEsquema_();
    ok(v.dados().turmas.filter(t => t.segmento === 'Extra').length === 21, 'rodar de novo não duplica');
  });

  await caso('Publicação: a migração não altera o que já existe (professores, turmas regulares, atribuições, matriz, fixas, usuários, histórico) e faz backup', () => {
    const v = criarAmbiente(); v.ctx.gravarExemplo_();
    const ctx = v.ctx, s0 = { u: 'x', nome: 'X' };
    // planilha como está hoje (v8): Extra antigo, horários "Contraturno", Voleibol, sem matriz do Extra, professores com faixas de 1h, histórico e grade
    ctx.removerTurmas_(v.dados().turmas.filter(t => t.segmento === 'Extra').map(t => t.nome));
    ctx.gravar_('Config', ctx.valores_('Config').filter(r => !/^Extra/.test(r[0])).concat(ctx.gradesPadrao_([['Contraturno', '13:00-14:00 14:00-15:00'], ['Contraturno manhã', '11:00-12:00']])));
    ctx.gravar_('Turmas', ctx.valores_('Turmas').map(r => r.slice(0, 4)).concat([['EXTRA 1º ano A', 'Extra', '', 'Contraturno'], ['EXTRA EFAI tarde', 'Extra', '', 'Contraturno manhã']]));
    ctx.gravar_('Componentes', ctx.valores_('Componentes').filter(r => !['Defesa Pessoal', 'Futebol'].includes(r[0])).map(r => r[0] === 'Vôlei' ? ['Voleibol', 'Vôlei', ''] : r));
    ctx.gravar_('Matriz', ctx.valores_('Matriz').filter(r => !/^Extra/.test(r[0])).map(r => r.slice(0, 3)));
    ctx.gravar_('Carga', ctx.valores_('Carga').map(r => r.slice(0, 6)).concat([['EXTRA 1º ano A', 'Lição de Casa', 'Jussara', 4, 0, 2], ['EXTRA EFAI tarde', 'Voleibol', 'Mônica', 2, 0, 2]]));
    ctx.gravar_('Fixas', [['3 EM A', 'Sex', 1, 'Matemática'], ['EXTRA 1º ano A', 'Seg', 1, 'Lição de Casa']]);
    ctx.salvarGrade_({ grade: { '1A|0|0': { disciplina: 'Matemática', professor: 'Bianca' }, 'EXTRA 1º ano A|0|0': { disciplina: 'Lição de Casa', professor: 'Jussara' } }, vigencia: '2026-02-02' }, s0);
    const prof = v.ss.getSheetByName('Professores');
    prof.d = [['Professor (nome curto)', 'Nome completo', 'Disciplinas', 'WhatsApp', 'Máx. aulas por dia', 'Indisponível (dia faixa)', 'Respondeu em', 'Observação', 'Segmentos', 'Código do formulário (não editar)', 'Situação (Aprovado / Aguardando aprovação)']]
      .concat(prof.d.slice(1).map((r, i) => [r[0], r[1], r[2] + (r[0] === 'Mônica' ? ', Voleibol' : ''), r[3], r[4], i % 5 === 0 ? 'Seg 7h; Seg 8h; Qua 13h' : '', '03/02/2026 10:00', '', r[8], 'v1:a:b', 'Aprovado']));
    const copia = n => JSON.parse(JSON.stringify(v.ss.getSheetByName(n).d));
    const antes = { prof: copia('Professores'), carga: copia('Carga'), turmas: copia('Turmas'), matriz: ctx.valores_('Matriz').map(r => r.slice(0, 3)), fixas: copia('Fixas'), usuarios: copia('Usuários'), hist: copia('Histórico da grade'), grade: copia('Grade'), blocos: copia('Blocos') };
    ['EXTRA_2027', 'SEM_FORMULARIO', 'BACKUP_V9'].forEach(k => delete v.props[k]); v.props.ESQUEMA = '8';
    ctx.garantirEsquema_();
    const d = v.dados(), mesmo = (x, y) => JSON.stringify(x) === JSON.stringify(y);
    const cheias = l => l.slice(1).filter(r => r[0] !== '' && r[0] !== undefined);   // a planilha simulada guarda linhas vazias depois de limpar
    // professores: mesmos nomes, matérias, segmentos e demais dados; disponibilidade igual (só muda o formato)
    ok(mesmo(d.professores.map(p => p.nome), cheias(antes.prof).map(r => r[0])), 'nenhum professor apagado ou renomeado');
    ok(d.professores.every((p, i) => { const r = antes.prof[i + 1]; return p.materias.join(', ') === r[2] && p.segmentos.join(', ') === r[8] && p.completo === r[1] && p.tel === String(r[3]) && p.maxDia === (+r[4] || 0); }), 'matérias (inclusive Voleibol), segmentos e dados de cada professor iguais');
    const faixas = l => l.flatMap(x => { const o = []; for (let m = x.ini; m < x.fim; m += 60) o.push(x.dia + ' ' + m / 60 + 'h'); return o; }).join('; ');
    ok(d.professores.every((p, i) => faixas(p.indisp) === antes.prof[i + 1][5]), 'disponibilidade convertida sem perder nada (volta exatamente às faixas antigas)');
    // atribuições das turmas regulares, turmas regulares, matriz, fixas, usuários, histórico, grade oficial e horários reservados
    const reg = r => !/^EXTRA /.test(String(r[0])) && !/^Extra /.test(String(r[0]));
    const a1 = ctx.valores_('Carga').filter(reg).map(r => r.slice(0, 6)), b1 = cheias(antes.carga).filter(reg).map(r => r.slice(0, 6));
    ok(mesmo(a1, b1), 'atribuições das turmas regulares iguais (linha por linha)');
    ok(mesmo(ctx.valores_('Turmas').filter(reg).map(r => r.slice(0, 4)), cheias(antes.turmas).filter(reg).map(r => r.slice(0, 4))), 'turmas regulares iguais');
    ok(mesmo(ctx.valores_('Matriz').filter(r => !/^Extra/.test(r[0])).map(r => r.slice(0, 3)), antes.matriz), 'matriz das séries igual (a do Extra só é acrescentada)');
    ok(mesmo(copia('Fixas'), antes.fixas) && mesmo(copia('Usuários'), antes.usuarios) && mesmo(copia('Histórico da grade'), antes.hist) && mesmo(copia('Grade'), antes.grade), 'aulas fixas, usuários, histórico e grade oficial intactos');
    ok(mesmo(copia('Blocos'), antes.blocos), 'horários reservados intactos');
    // o que pode mudar
    ok(!d.turmas.some(t => /^EXTRA /.test(t.nome)) && !d.carga.some(c => c.turmas.some(t => /^EXTRA /.test(t))), 'grupos antigos do Extra e as atribuições deles apagados');
    ok(d.turmas.filter(t => t.segmento === 'Extra').length === 21 && d.componentes.some(c => c.nome === 'Vôlei' && c.apelidos.includes('Voleibol')), 'Extras novos e Vôlei na lista de matérias');
    // backup
    const bk = n => v.ss.getSheetByName('Backup antes da v8 · ' + n);
    ok(['Professores', 'Carga', 'Turmas'].every(n => bk(n) && bk(n).isSheetHidden()), 'abas ocultas “Backup antes da v8 · Professores / Carga / Turmas”');
    ok(mesmo(bk('Professores').d, antes.prof) && mesmo(bk('Carga').d, antes.carga) && mesmo(bk('Turmas').d, antes.turmas), 'o backup é a cópia de antes de qualquer mudança');
    v.props.ESQUEMA = '8'; ctx.garantirEsquema_();
    ok(Object.keys(v.ss.abas).filter(n => /^Backup|^Cópia/.test(n)).length === 3 && mesmo(bk('Professores').d, antes.prof), 'backup uma vez só (rodar de novo não refaz nem sobrescreve)');
    ok(v.ss.getSheetByName('Registro').d.some(r => /Cópia de segurança \(abas ocultas\)/.test(r[2])), 'backup anotado no Registro');
    const cod = require('fs').readFileSync(require('path').join(__dirname, '..', 'apps-script', 'Codigo.js'), 'utf8'), mig = cod.slice(cod.indexOf('function migrarExtra_'), cod.indexOf('// v5: professor ganha'));
    ok(!/renomearMateria_|guardarVersao_|removerTurmas_|ABA\.fixas|ABA\.grade|ABA\.hist|ABA\.usuarios/.test(mig), 'migrarExtra_ não toca em fixas, grade, histórico, usuários nem renomeia matérias');
  });

  await caso('Matriz do Extra: aplicar preenche os Extras sem professor e leva a aula fixa do dia', () => {
    const v = criarAmbiente(); v.ctx.gravarExemplo_();
    const s = { u: 'teste', perfil: 'admin' };
    const m1 = D.matriz.filter(m => m.serie === 'Extra 1º ao 5º'), m2 = D.matriz.filter(m => m.serie === 'Extra 6º ao EM');
    ok(m1.map(m => m.componente + ' ' + m.aulas).join(', ') === 'Lição de Casa 5, Recreação 5, Reforço 2, Língua Inglesa 2, Língua Espanhola 2, Teatro 2, Defesa Pessoal 2', '1º–5º: ' + m1.map(m => m.componente + ' ' + m.aulas).join(', '));
    ok(m1.find(m => m.componente === 'Lição de Casa').posicao === 1 && m1.find(m => m.componente === 'Recreação').posicao === 3, 'Lição de Casa na 1ª aula, Recreação na 3ª');
    ok(m2.map(m => m.componente + ' ' + m.aulas).join(', ') === 'Defesa Pessoal 5, Vôlei 5, Futebol 5', '6º–EM: Defesa Pessoal, Vôlei e Futebol (5 cada)');
    v.ctx.gravar_('Carga', v.ctx.valores_('Carga').filter(r => !(r[0] === 'Extra 2A' && r[1] === 'Teatro')).map(r => r[0] === 'Extra 3A' && r[1] === 'Recreação' ? [r[0], r[1], r[2], r[3], r[4], r[5], ''] : r));
    const prev = v.ctx.previaMatriz_({ series: ['Extra 1º ao 5º'] });
    ok(prev.length === 2 && prev.some(m => m.turma === 'Extra 2A' && m.novas.join() === 'Teatro (2)') && prev.some(m => m.turma === 'Extra 3A' && /Recreação: sempre na 3ª aula/.test(m.mudam.join())), 'prévia: falta Teatro no Extra 2A; Recreação do Extra 3A volta para a 3ª aula');
    v.ctx.aplicarMatriz_({ series: ['Extra 1º ao 5º'] }, s);
    const c = v.dados().carga;
    ok(c.find(x => x.turmas.join() === 'Extra 2A' && x.disciplina === 'Teatro').professor === '' && c.find(x => x.turmas.join() === 'Extra 3A' && x.disciplina === 'Recreação').posicao === 3, 'aplicar: matéria nova “a definir” e aula fixa do dia de volta');
    const mz = v.dados().matriz.map(m => ({ serie: m.serie, componente: m.componente, aulas: m.aulas, posicao: m.posicao }));
    mz.find(m => m.serie === 'Extra 6º ao EM' && m.componente === 'Vôlei').posicao = 2;
    mz.find(m => m.serie === 'Extra 6º ao EM' && m.componente === 'Vôlei').aulas = 6;
    ok(/não cabem sempre na 2ª aula/.test(erroDe(() => v.ctx.salvarMatriz_({ matriz: mz, componentes: v.dados().componentes }, s))), 'matriz recusa “sempre na” com mais aulas que dias');
    const app = require('fs').readFileSync(require('path').join(__dirname, '..', 'apps-script', 'App.html'), 'utf8');
    ok(/SEGS_MATRIZ = \['EFAI', 'EFAF', 'EM', 'Extra'\]/.test(app) && /function mzPosSel/.test(app), 'aba Extra na Matriz curricular, com “sempre na Xª aula”');
  });

  await caso('Posição fixa: “sempre na Xª aula do dia” é regra obrigatória do gerador', async () => {
    const it = ['13:00-14:00', '14:00-15:00', '15:00-16:00', '16:00-17:00'].map(x => ({ tipo: 'aula', ini: x.split('-')[0], fim: x.split('-')[1] }));
    const d = { dias: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'], grades: [{ nome: 'Ext', itens: it }], professores: ['P', 'Q', 'R', 'S'].map(nome => ({ nome, indisp: [] })),
      turmas: [{ nome: 'X1', segmento: 'Extra', grade: 'Ext' }, { nome: 'X2', segmento: 'Extra', grade: 'Ext' }], fixas: [], blocos: [],
      carga: [{ turmas: ['X1'], disciplina: 'LC', professor: 'P', aulas: 5, duplas: 0, maxDia: 2, posicao: 1 }, { turmas: ['X1'], disciplina: 'Rec', professor: 'Q', aulas: 5, duplas: 0, maxDia: 2, posicao: 3 },
        { turmas: ['X1'], disciplina: 'Ref', professor: 'R', aulas: 10, duplas: 0, maxDia: 2 }, { turmas: ['X2'], disciplina: 'LC', professor: 'S', aulas: 5, duplas: 0, maxDia: 2, posicao: 1 },
        { turmas: ['X2'], disciplina: 'Ref', professor: 'P', aulas: 15, duplas: 0, maxDia: 3 }] };
    const r = await gerar(G, d, { tentativas: 5, semente: 9 });
    ok(r.opcoes.length > 0, 'gerou (' + r.gargalos.join(' | ') + ')');
    r.opcoes.forEach(o => ok([0, 1, 2, 3, 4].every(dd => o.grade[`X1|${dd}|0`].disciplina === 'LC' && o.grade[`X1|${dd}|2`].disciplina === 'Rec' && o.grade[`X2|${dd}|0`].disciplina === 'LC'), 'LC sempre na 1ª aula e Rec sempre na 3ª, todo dia'));
    if (r.opcoes.length) {
      const g = JSON.parse(JSON.stringify(r.opcoes[0].grade)), a = g['X1|0|0'], b = g['X1|0|1']; g['X1|0|0'] = b; g['X1|0|1'] = a;
      ok(G.validar(d, g).problemas.some(p => /LC deveria ficar sempre na 1ª aula/.test(p)), 'a validação aponta LC fora da 1ª aula');
    }
    const ruim = JSON.parse(JSON.stringify(d)); ruim.carga[2].posicao = 1;
    ok(G.modelo(ruim).erros.some(e => /não cabem sempre na 1ª aula/.test(e)), '10 aulas não cabem sempre na 1ª aula (uma por dia)');
    ruim.carga[2] = { turmas: ['X1'], disciplina: 'Ref', professor: 'R', aulas: 2, duplas: 0, maxDia: 2, posicao: 1 };
    ok(G.modelo(ruim).erros.some(e => /Turma X1: 7 aulas precisam ficar sempre na 1ª aula/.test(e)), 'duas matérias na 1ª aula com 7 aulas: não cabe');
    ruim.carga[2] = { turmas: ['X1'], disciplina: 'Ref', professor: 'R', aulas: 2, duplas: 1, maxDia: 2, posicao: 2 };
    ok(G.modelo(ruim).erros.some(e => /aula dupla não combina/.test(e)), 'aula dupla + aula fixa do dia: recusado');
    if (oficial) ok([0, 1, 2, 3, 4].every(dd => oficial[`Extra 1A|${dd}|0`].disciplina === 'Lição de Casa' && oficial[`Extra 5B|${dd}|2`].disciplina === 'Recreação'), 'no exemplo, Lição de Casa na 1ª e Recreação na 3ª aula do Extra');
  });

  await caso('Equipe do Extra: pessoas necessárias ao mesmo tempo × disponíveis, por horário e por matéria', () => {
    const fs = require('fs'), path = require('path'), app = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'App.html'), 'utf8');
    const fonte = (/function equipeExtra\([\s\S]*?\r?\n}\r?\n/.exec(app) || [''])[0];
    const c = { console, Math, JSON }; vm.createContext(c);
    vm.runInContext(`const minutos = h => { const m = /^(\\d{1,2}):(\\d{2})/.exec(String(h || '')); return m ? +m[1] * 60 + +m[2] : NaN; };
      const hora = m => Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0'), horaH = m => m % 60 ? hora(m) : m / 60 + 'h', faixaH = (a, b) => horaH(a) + '–' + horaH(b);
      const aulasDe = g => g ? g.itens.filter(i => i.tipo !== 'intervalo').map(i => ({ ini: minutos(i.ini), fim: minutos(i.fim) })) : [];
      const turmaDe = n => D.turmas.find(t => t.nome === n), gradeDe = n => D.grades.find(g => g.nome === n), profPorNome = n => D.professores.find(p => p.nome === n);
      const ehExtra = n => (turmaDe(n) || {}).segmento === 'Extra';
      ${fonte}; this.equipe = d => { D = d; return equipeExtra(d.carga); }; let D;`, c);
    const E = c.equipe(JSON.parse(JSON.stringify(D))), h = x => E.horarios.find(y => y.ini === min(x));
    ok(E.horarios.map(x => x.ini / 60 + '-' + x.fim / 60).join() === '13-14,14-15,15-16,16-17', 'horários do Extra: 13h–17h');
    ok(h('13:00').precisa === 6 && h('14:00').turmas === 21 && h('14:00').precisa === 13, '14h–15h: 21 turmas (13 grupos, com as juntas) → precisa de 13 pessoas');
    ok(h('14:00').ha.every(n => n === 21) && h('13:00').ha[2] === 20, 'há 21 pessoas; quarta 13h–14h, 20 (uma não pode)');
    const lc = E.materias.find(x => x.disciplina === 'Lição de Casa'), fut = E.materias.find(x => x.disciplina === 'Futebol');
    ok(lc.precisa === 6 && lc.ha === 6 && /sempre na 1ª aula \(13h–14h\)/.test(lc.quando), 'Lição de Casa: 6 ao mesmo tempo na 1ª aula; há 6');
    ok(fut.precisa === 3 && fut.ha === 3, 'Futebol: 35 aulas em 15 horários → pelo menos 3 pessoas; há 3');
    const d2 = JSON.parse(JSON.stringify(D));
    d2.carga.filter(l => l.turmas.some(t => /^Extra/.test(t)) && !['Nelson', 'Quitéria', 'Tiago', 'Jussara', 'Natália', 'Mônica'].includes(l.professor)).forEach(l => { l.professor = 'Nelson'; });
    const E2 = c.equipe(d2), h2 = E2.horarios.find(y => y.ini === min('14:00'));
    ok(h2.precisa === 13 && h2.ha[0] === 6 && E2.materias.find(x => x.disciplina === 'Futebol').ha === 2, 'menos gente: 14h–15h precisa de 13, há 6');
    d2.carga.push({ turmas: ['1B'], disciplina: 'Teste', professor: 'Jussara', aulas: 1, duplas: 0, maxDia: 1 });
    ok(c.equipe(d2).choques.some(x => x.professor === 'Jussara' && x.grades.join() === 'EFAI Tarde'), 'aponta quem dá Extra e tem aula regular à tarde no mesmo horário');
    ok(/Equipe do Extra: falta gente em/.test(app) && /precisa de \$\{f\.h\.precisa\}/.test(app) && /function atEquipe/.test(app), 'pendência “falta gente” e aba “Equipe do Extra” na Conferência');
  });

  // ===================== Extra: mensagens, equipes, agrupamento, distribuição e V1 incompleta =====================
  const X = carregarScript('Extra.html', 'Extra'), copia = o => JSON.parse(JSON.stringify(o)), s0 = { u: 'teste', nome: 'Teste', perfil: 'admin' };
  const appTxt = require('fs').readFileSync(require('path').join(__dirname, '..', 'apps-script', 'App.html'), 'utf8');
  const doTipo = (d, tipo) => l => l.turmas.every(t => (d.turmas.find(x => x.nome === t) || {}).serie === tipo);

  await caso('Aula fixa do dia: mensagem com o motivo real (todas as turmas ao mesmo tempo) e seletor com quem já está ocupado', async () => {
    const d = copia(D);
    d.carga.filter(c => ['Extra 1A', 'Extra 2A', 'Extra 3A'].includes(c.turmas.join()) && c.disciplina === 'Lição de Casa').forEach(c => { c.professor = 'Giovana'; });
    const M = G.modelo(d);
    ok(M.erros.includes('Lição de Casa é às 13h em todas as turmas ao mesmo tempo. Giovana só pode ficar com 1 turma (hoje está em 3: Extra 1A, Extra 2A, Extra 3A).'), 'mensagem: ' + M.erros.filter(e => /Giovana/.test(e)).join(' | '));
    ok(M.posFixa.length === 1 && M.posFixa[0].professor === 'Giovana' && M.posFixa[0].cabem === 1 && M.posFixa[0].n === 3, 'posFixa para a pendência e para a linha da turma');
    const r = await gerar(G, d, { tentativas: 1 });
    ok(!r.opcoes.length && r.erros.some(e => /Giovana só pode ficar com 1 turma/.test(e)), 'o gerador recusa com a mensagem clara (em vez de “não coube”)');
    const d2 = copia(D); d2.carga.find(c => c.turmas.join() === 'Extra 1A' && c.disciplina === 'Lição de Casa').professor = 'Priscila';   // não pode Qua 13h–14h
    ok(G.modelo(d2).erros.includes('Lição de Casa é sempre às 13h, mas Priscila não pode nesse horário em 1 dia (Extra 1A tem 5 aulas às 13h).'), 'uma turma só, mas sem um dia livre às 13h');
    ok(G.modelo(D).posFixa.length === 0, 'no exemplo, ninguém em duas turmas na mesma aula fixa');
    // seletor: quem já está na Lição de Casa de outro Extra vai para o fim, com o motivo
    const fn = nome => (new RegExp('function ' + nome + '\\([\\s\\S]*?\\r?\\n}\\r?\\n').exec(appTxt) || [''])[0];
    const c = { console, Math, JSON }; vm.createContext(c);
    vm.runInContext((/const artigo = [^\n]*\n/.exec(appTxt) || [''])[0] + fn('ocupadosNaAula') + `
      const aulasTurma = n => n.startsWith('Extra') ? [{ ini: 780, fim: 840 }, { ini: 840, fim: 900 }, { ini: 900, fim: 960 }, { ini: 960, fim: 1020 }] : [];
      this.ocup = (carga, i) => { AT = { carga }; return ocupadosNaAula(carga[i]); }; let AT; const D = { dias: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'] };`, c);
    const cg = copia(D.carga), i2 = cg.findIndex(l => l.turmas.join() === 'Extra 1A' && l.disciplina === 'Lição de Casa');
    const o = c.ocup(cg, i2);
    ok(o['Natália'] === 'já está na Lição de Casa do Extra 2A' && o['Mônica'] === 'já está na Lição de Casa do Extra 3A', 'motivo ao lado do nome: ' + JSON.stringify(o));
    ok(!o['Jussara'] && !o['Giovana'], 'quem só tem esta turma ou está livre às 13h não aparece como ocupado');
    ok(/Já ocupados neste horário/.test(appTxt) && /opcoesProf\(listasProf\(l\.disciplina, seg, t\.serie\), l\.disciplina, seg, l\.professor, '', ocup\)/.test(appTxt), 'ocupados no fim da lista do seletor da turma');
    ok(/Tirar matérias fora da matriz/.test(appTxt) && /function atTirarFora/.test(appTxt) && /Estas matérias não estão na matriz/.test(appTxt), 'turma com aulas demais: “Tirar matérias fora da matriz”, mostrando quais antes');
  });

  await caso('Equipe do Extra: pessoas necessárias por matéria (aula fixa, disponibilidade, aulas regulares), com e sem Extras juntados', () => {
    const C = X.conta(D, D.carga), m = (tipo, disc, cc) => (cc || C).find(x => x.tipo === tipo && x.disciplina === disc);
    const lc = m('Extra 1º ao 5º', 'Lição de Casa');
    ok(lc.texto === 'Lição de Casa · 1º ao 5º: 6 grupos às 13h → precisa de 6 pessoas. Equipe: 6 ✓' && lc.ok, lc.texto);
    const ref = m('Extra 1º ao 5º', 'Reforço');
    ok(ref.texto === 'Reforço · 1º ao 5º: 6 grupos, 12 aulas por semana em 10 horários possíveis → precisa de 2 pessoas. Equipe: 6 ✓', ref.texto);
    const fut = m('Extra 6º ao EM', 'Futebol');
    ok(fut.grupos === 7 && fut.precisa === 3 && fut.equipe.length === 3 && fut.ok, 'Futebol 6º ao EM: Extras juntados contam como um grupo (7) → 35 aulas em 15 horários → 3 pessoas: ' + fut.texto);
    ok(C.every(x => x.ok), 'no exemplo, todas as equipes dão conta');
    // juntando dois Extras, um grupo a menos
    const v = criarAmbiente(); v.ctx.gravarExemplo_(); v.ctx.juntarExtra_({ turma: 'Extra 1A', com: 'Extra 2A' }, s0);
    const d1 = v.dados(), lc1 = m('Extra 1º ao 5º', 'Lição de Casa', X.conta(d1, d1.carga));
    ok(lc1.grupos === 5 && lc1.precisa === 5 && /5 grupos às 13h → precisa de 5 pessoas/.test(lc1.texto), 'com Extra 1A + 2A juntos: ' + lc1.texto);
    // equipe pequena: falta gente e vem a sugestão de juntar em grupos
    const d2 = copia(D);
    d2.carga.filter(l => doTipo(d2, 'Extra 1º ao 5º')(l) && l.disciplina === 'Lição de Casa').forEach(l => { l.professor = ''; });
    d2.equipes = d2.equipes.filter(e => !(e.disciplina === 'Lição de Casa' && !['Jussara', 'Natália'].includes(e.professor)));
    let lc2 = m('Extra 1º ao 5º', 'Lição de Casa', X.conta(d2, d2.carga));
    ok(lc2.texto === 'Lição de Casa · 1º ao 5º: 6 grupos às 13h → precisa de 6 pessoas. Equipe: 2 ✗' && !lc2.ok, lc2.texto);
    ok(lc2.sugestao && lc2.sugestao.grupos === 2 && lc2.sugestao.texto === 'Com 2 pessoas, junte o Extra em 2 grupos', 'sugestão: ' + JSON.stringify(lc2.sugestao));
    // disponibilidade: Priscila não pode quarta 13h–14h → não fecha um grupo de 5 aulas às 13h
    d2.equipes.push({ tipo: 'Extra 1º ao 5º', disciplina: 'Lição de Casa', professor: 'Priscila' });
    lc2 = m('Extra 1º ao 5º', 'Lição de Casa', X.conta(d2, d2.carga));
    ok(lc2.equipe.length === 3 && lc2.cabem === 2 && lc2.notas.Priscila === 'não pode às 13h em 1 dia', 'quem não pode em algum dia às 13h não conta como um grupo: ' + JSON.stringify(lc2.notas));
    // aulas regulares à tarde no mesmo horário
    d2.equipes.push({ tipo: 'Extra 1º ao 5º', disciplina: 'Lição de Casa', professor: 'Bianca' });
    lc2 = m('Extra 1º ao 5º', 'Lição de Casa', X.conta(d2, d2.carga));
    ok(lc2.cabem === 3 && !lc2.notas.Bianca, 'Bianca (1B à tarde) ainda tem folga à tarde para um grupo: ' + JSON.stringify(lc2.notas));
    d2.carga.push({ turmas: ['1B'], disciplina: 'Projeto', professor: 'Bianca', aulas: 12, duplas: 0, maxDia: 3 });   // a tarde dela fica cheia
    lc2 = m('Extra 1º ao 5º', 'Lição de Casa', X.conta(d2, d2.carga));
    ok(lc2.notas.Bianca === 'tem aulas regulares à tarde' && lc2.cabem === 2, 'com a tarde cheia de aulas regulares, não sobra para um grupo inteiro: ' + JSON.stringify(lc2.notas) + ' cabem ' + lc2.cabem);
    ok(/function atEquipe/.test(appTxt) && /\+ Nova pessoa/.test(appTxt) && /segmentos: \['Extra'\]/.test(appTxt) && /Ver como ficaria/.test(appTxt), 'tela: chips da equipe, “+ Nova pessoa” (com segmento Extra e a matéria) e “Ver como ficaria”');
  });

  await caso('Sugestão de agrupamento por série (editável) e “juntar em grupos” no servidor', () => {
    const g2 = X.agrupar(D, 'Extra 1º ao 5º', 2);
    ok(JSON.stringify(g2) === JSON.stringify([{ turmas: ['Extra 1A', 'Extra 2A', 'Extra 3A'], rotulo: '1º–3º ano' }, { turmas: ['Extra 4A', 'Extra 5A', 'Extra 5B'], rotulo: '4º–5º ano' }]), '2 grupos: ' + JSON.stringify(g2));
    ok(X.agrupar(D, 'Extra 1º ao 5º', 5).map(g => g.rotulo).join() === '1º ano,2º ano,3º ano,4º ano,5º ano', '5 grupos: um por série');
    ok(X.agrupar(D, 'Extra 1º ao 5º', 6).every(g => g.turmas.length === 1) && X.agrupar(D, 'Extra 1º ao 5º', 1)[0].rotulo === '1º–5º ano', '6 grupos: cada Extra sozinho; 1 grupo: 1º–5º ano');
    const e2 = X.agrupar(D, 'Extra 6º ao EM', 2);
    ok(e2.map(g => g.rotulo + ':' + g.turmas.length).join() === '6º–9º ano:8,1ª–3ª série:7', '6º ao EM em 2: ' + e2.map(g => g.rotulo + ':' + g.turmas.length).join());
    const v = criarAmbiente(); v.ctx.gravarExemplo_();
    v.ctx.agruparExtra_({ tipo: 'Extra 1º ao 5º', grupos: g2.map(g => g.turmas) }, s0);
    let d = v.dados(), lcs = d.carga.filter(l => l.disciplina === 'Lição de Casa' && doTipo(d, 'Extra 1º ao 5º')(l));
    ok(lcs.length === 2 && lcs[0].turmas.join(' + ') === 'Extra 1A + Extra 2A + Extra 3A' && lcs[0].professor === 'Jussara' && lcs[1].professor === 'Adriana', 'cada matéria vira turmas juntas, com o professor do primeiro Extra do grupo');
    ok(X.conta(d, d.carga).find(x => x.disciplina === 'Lição de Casa').texto.startsWith('Lição de Casa · 1º ao 5º: 2 grupos às 13h → precisa de 2 pessoas'), 'depois de juntar: 2 grupos às 13h');
    ok(d.carga.filter(l => doTipo(d, 'Extra 6º ao EM')(l)).length === 21, 'o outro tipo não muda');
    ok(/Cada Extra precisa ficar em um grupo/.test(erroDe(() => v.ctx.agruparExtra_({ tipo: 'Extra 1º ao 5º', grupos: [['Extra 1A', 'Extra 2A']] }, s0))), 'recusa se faltar algum Extra');
    v.ctx.agruparExtra_({ tipo: 'Extra 1º ao 5º', grupos: X.agrupar(d, 'Extra 1º ao 5º', 6).map(g => g.turmas) }, s0);
    d = v.dados();
    ok(d.carga.filter(l => doTipo(d, 'Extra 1º ao 5º')(l)).every(l => l.turmas.length === 1) && d.carga.find(l => l.turmas.join() === 'Extra 3A' && l.disciplina === 'Lição de Casa').professor === 'Jussara', 'separar de novo: cada Extra com as próprias aulas (e o professor do grupo)');
    const ACOES = vm.runInContext('ACOES', v.ctx);
    ok(ACOES.agruparExtra && ACOES.agruparExtra.p.indexOf('consulta') < 0, 'consulta não agrupa');
    ok(/function abrirAgrupar/.test(appTxt) && /agMover/.test(appTxt) && /Extra\.agrupar/.test(appTxt), 'prévia editável (mudar turma de grupo) antes de aplicar');
  });

  await caso('Distribuir automaticamente: equipe, carga equilibrada, Lição de Casa e Recreação com a mesma pessoa, 📌 mantido', () => {
    const d = copia(D), tipo = 'Extra 1º ao 5º', dt = doTipo(d, tipo);
    d.carga.filter(dt).forEach(l => { l.professor = ''; });
    d.carga.find(l => l.turmas.join() === 'Extra 4A' && l.disciplina === 'Língua Inglesa').professor = 'Giovana';
    d.carga.find(l => l.turmas.join() === 'Extra 4A' && l.disciplina === 'Língua Inglesa').fixado = true;
    const r = X.distribuir(d, d.carga, { tipo });
    const ls = r.carga.filter(dt), eq = (disc) => X.equipe(d, d.carga, tipo, disc);
    ok(!r.faltas.length && ls.every(l => l.professor && eq(l.disciplina).includes(l.professor)), 'todo grupo com alguém da equipe da matéria: ' + r.faltas.join(' | '));
    const de = (t, disc) => ls.find(l => l.turmas.join() === t && l.disciplina === disc).professor;
    ok(['Extra 1A', 'Extra 2A', 'Extra 3A', 'Extra 4A', 'Extra 5A', 'Extra 5B'].every(t => de(t, 'Lição de Casa') === de(t, 'Recreação')), 'Lição de Casa e Recreação do mesmo grupo com a mesma pessoa');
    ok(new Set(ls.filter(l => l.disciplina === 'Lição de Casa').map(l => l.professor)).size === 6, '6 grupos às 13h → 6 pessoas diferentes');
    ok(de('Extra 4A', 'Língua Inglesa') === 'Giovana', '📌 mantido');
    const ing = ls.filter(l => l.disciplina === 'Língua Inglesa').map(l => l.professor);
    ok(ing.filter(n => n === 'Giovana').length === 3 && ing.filter(n => n === 'Hugo').length === 3, 'Inglês equilibrado entre as 2 pessoas da equipe: ' + ing.join());
    ok(r.mudancas.length === ls.length - 1 && Object.keys(r.porPessoa).length >= 10 && r.porPessoa.Giovana.aulas === 6, 'prévia: mudanças (menos a fixada) e aulas por pessoa: ' + r.mudancas.length + '/' + ls.length);
    ok(G.modelo(Object.assign({}, d, { carga: r.carga })).erros.length === 0, 'o resultado passa no gerador (ninguém em duas turmas na mesma aula fixa)');
    // equipe pequena: explica onde falta gente
    const d2 = copia(d); d2.equipes = d2.equipes.filter(e => !(e.disciplina === 'Lição de Casa' && !['Jussara', 'Natália'].includes(e.professor)));
    const r2 = X.distribuir(d2, d2.carga, { tipo, juntarFixas: false });
    ok(r2.faltas.some(f => /^Lição de Casa · 1º ao 5º: ficou sem professor em 4 grupos \(.*\) — todos da equipe já têm um grupo às 13h ou não podem nesse horário\.$/.test(f)), 'faltas: ' + r2.faltas.join(' | '));
    // só preencher o que está vazio
    const d3 = copia(D); d3.carga.find(l => l.turmas.join() === 'Extra 1A' && l.disciplina === 'Teatro').professor = '';
    const r3 = X.distribuir(d3, d3.carga, { tipo, soVazias: true });
    ok(r3.mudancas.length === 1 && r3.mudancas[0].disciplina === 'Teatro' && ['Laura', 'Mauro'].includes(r3.mudancas[0].para), '“só o que está sem professor” não muda quem já está escolhido');
    ok(/Distribuir automaticamente/.test(appTxt) && /Salvar esta distribuição/.test(appTxt) && /Onde falta gente/.test(appTxt) && /function atFixar/.test(appTxt), 'tela: prévia antes de salvar, onde falta gente e 📌');
  });

  await caso('Equipe e 📌 gravados com as atribuições; migração v9 → v10 não altera professores, turmas nem atribuições', () => {
    const v = criarAmbiente(); v.ctx.gravarExemplo_();
    const d = v.dados();
    ok(d.equipes.some(e => e.tipo === 'Extra 1º ao 5º' && e.disciplina === 'Lição de Casa' && e.professor === 'Jussara'), 'exemplo já vem com a equipe de cada matéria');
    const carga = copia(d.carga), l = carga.find(x => x.turmas.join() === 'Extra 1A' && x.disciplina === 'Língua Inglesa'); l.fixado = true;
    carga.find(x => x.turmas.join() === 'Extra 2A' && x.disciplina === 'Teatro').fixado = true;
    carga.find(x => x.turmas.join() === 'Extra 2A' && x.disciplina === 'Teatro').professor = '';
    v.ctx.salvarAtribuicoes_({ carga, antes: d.carga, equipes: d.equipes.concat([{ tipo: 'Extra 1º ao 5º', disciplina: 'Teatro', professor: 'Bianca' }]) }, s0);
    let d2 = v.dados();
    ok(d2.carga.find(x => x.turmas.join() === 'Extra 1A' && x.disciplina === 'Língua Inglesa').fixado === true, '📌 gravado');
    ok(d2.carga.find(x => x.turmas.join() === 'Extra 2A' && x.disciplina === 'Teatro').fixado === false, 'sem professor, não fica fixado');
    const bi = d2.professores.find(p => p.nome === 'Bianca');
    ok(d2.equipes.some(e => e.professor === 'Bianca' && e.disciplina === 'Teatro') && bi.materias.includes('Teatro') && bi.segmentos.includes('Extra'), 'quem entra na equipe ganha a matéria e o segmento Extra no cadastro');
    ok(/Outra pessoa mudou/.test(erroDe(() => v.ctx.salvarAtribuicoes_({ carga, antes: d.carga, equipes: [] }, s0))), 'a proteção contra edição simultânea vale também para o 📌');
    v.ctx.salvarProfessor_(Object.assign({}, bi, { nomeAntigo: 'Bianca', nome: 'Bianca M', blocos: [] }), s0);
    ok(v.dados().equipes.some(e => e.professor === 'Bianca M'), 'renomear o professor renomeia na equipe');
    // migração: planilha como está hoje (v9: Carga com 7 colunas, sem a aba da equipe)
    const w = criarAmbiente(); w.ctx.gravarExemplo_();
    w.ss.getSheetByName('Carga').d.forEach(r => { r.length = 7; });
    w.ss.deleteSheet(w.ss.getSheetByName('Equipe do Extra'));
    w.ctx.gravar_('Professores', w.ctx.valores_('Professores').concat([['Zeca (teste)', 'Zeca Modelo (teste)', '', '', '', '', '', '', '']]));
    const tira = n => JSON.stringify(w.ss.getSheetByName(n).d.slice(1).filter(r => r[0]).map(r => r.slice(0, 7)));
    const antes = { p: tira('Professores'), t: tira('Turmas'), c: tira('Carga'), g: tira('Grade'), f: tira('Fixas') };
    w.props.ESQUEMA = '9'; w.ctx.garantirEsquema_();
    ok(w.props.ESQUEMA === '10', 'versão 10');
    ok(tira('Professores') === antes.p && tira('Turmas') === antes.t && tira('Carga') === antes.c && tira('Grade') === antes.g && tira('Fixas') === antes.f, 'professores (inclusive “(teste)”), turmas, atribuições, grade e fixas iguais');
    ok(w.ss.getSheetByName('Carga').d[0][7] === 'Fixado na distribuição (📌)' && w.ss.getSheetByName('Equipe do Extra').d[0].join() === 'Tipo do Extra,Matéria,Professor', 'só o cabeçalho da coluna 📌 e a aba “Equipe do Extra” (vazia)');
    ok(!w.dados().equipes.length && w.dados().carga.every(c => c.fixado === false), 'nada fixado nem equipe escolhida depois da migração');
  });

  await caso('Gerar uma V1 mesmo incompleta: “a definir” vira professor provisório da turma; o Extra é opcional', async () => {
    const d = copia(D);
    d.carga.filter(c => c.turmas.join() === '6A').slice(0, 3).forEach(c => { c.professor = ''; });
    d.carga.filter(c => c.turmas.join() === 'Extra 1A').forEach(c => { c.professor = ''; });
    ok(G.modelo(d).erros.some(e => /falta escolher o professor/.test(e)), 'sem a opção: “falta escolher o professor”');
    const P = G.preparar(d, { aDefinir: true });
    ok(P.professores.filter(p => G.provisorio(p.nome)).map(p => p.nome).sort().join() === 'A definir · 6A,A definir · Extra 1A' && P.carga.every(c => c.professor), 'um professor provisório por turma: ' + P.professores.filter(p => p.provisorio).map(p => p.nome).join());
    ok(d.carga.filter(c => c.turmas.join() === '6A' && !c.professor).length === 3, 'não mexe nos dados originais');
    const r = await gerar(G, P, { tentativas: 6, semente: 5 });
    ok(r.opcoes.length > 0, 'gerou: ' + r.gargalos.join(' | '));
    if (r.opcoes.length) {
      const g = r.opcoes[0].grade, defs = Object.values(g).filter(c => G.provisorio(c.professor));
      ok(defs.some(c => c.professor === 'A definir · 6A') && defs.some(c => c.professor === 'A definir · Extra 1A'), 'aulas “a definir” na grade (6A e Extra 1A)');
      ok(G.validar(P, g).problemas.length === 0 && sobreposicoes(P, g) === 0, 'sem conflitos');
      ok(!Object.keys(r.opcoes[0].metricas.parado).some(G.provisorio), '“a definir” não entra no tempo parado');
      const d2 = copia(d); d2.carga.filter(c => c.turmas.join() === '6A' && !c.professor)[0].professor = 'Igor';
      ok(G.validar(G.preparar(d2, { aDefinir: true }), g).problemas.some(p => /está “a definir” na grade, mas agora é de Igor\. Use “Trocar professor”\./.test(p)), 'professor escolhido depois: a conferência pede “Trocar professor”');
      // servidor: anota no histórico; troca “a definir” → professor
      const v = criarAmbiente(); v.ctx.gravarExemplo_();
      v.ctx.gravar_('Carga', v.ctx.valores_('Carga').map(x => { if (x[0] === '6A' && d.carga.some(c => c.turmas.join() === '6A' && c.disciplina === x[1] && !c.professor) || x[0] === 'Extra 1A') x[2] = ''; return x; }));
      v.ctx.salvarGrade_({ grade: g, vigencia: '2026-03-02' }, s0);
      ok(new RegExp('^Salvou como oficial \\(com ' + defs.length + ' aula\\(s\\) a definir\\)$').test(v.dados().versoes[0].descricao), 'histórico: ' + v.dados().versoes[0].descricao);
      const disc = d.carga.find(c => c.turmas.join() === '6A' && !c.professor).disciplina, g2 = copia(g);
      Object.keys(g2).forEach(k => { if (g2[k].professor === 'A definir · 6A' && g2[k].disciplina === disc) g2[k].professor = 'Igor'; });
      v.ctx.substituir_({ sai: 'A definir · 6A', entra: 'Igor', linhas: [{ turmas: '6A', disciplina: disc }], grade: g2, vigencia: '2026-03-09' }, s0);
      const dv = v.dados();
      ok(dv.carga.find(c => c.turmas.join() === '6A' && c.disciplina === disc).professor === 'Igor' && /^Troca: a definir \(6A\) → Igor/.test(dv.versoes[0].descricao), '“Trocar professor” com Sai = a definir · 6A: ' + dv.versoes[0].descricao);
    }
    // só a parte regular
    const S = G.preparar(D, { extra: false });
    ok(!S.turmas.some(t => t.segmento === 'Extra') && !S.carga.some(c => /^Extra /.test(c.turmas[0])) && S.turmas.length === 31, 'sem o Extra: só as 31 turmas regulares');
    const r2 = await gerar(G, S, { tentativas: 4, semente: 8 });
    ok(r2.opcoes.length > 0 && !Object.keys(r2.opcoes[0].grade).some(k => /^Extra /.test(k)) && G.validar(S, r2.opcoes[0].grade).problemas.length === 0, 'gera só a parte regular, sem conflitos');
    if (r2.opcoes.length) {
      const v = criarAmbiente(); v.ctx.gravarExemplo_();
      v.ctx.salvarGrade_({ grade: r2.opcoes[0].grade, vigencia: '2026-03-02' }, s0);
      ok(v.dados().versoes[0].descricao === 'Salvou como oficial (sem o Extra)', 'histórico: ' + v.dados().versoes[0].descricao);
    }
    ok(/Gerar mesmo com matérias a definir/.test(appTxt) && /Incluir o Extra/.test(appTxt) && /Gerador\.preparar\(D, \{ aDefinir: GR\.aDefinir, extra: GR\.comExtra \}\)/.test(appTxt), 'opções na Grade horária');
    ok(/estiloCel/.test(appTxt) && /var\(--alerta-bg\)/.test(appTxt) && /Salvar como oficial mesmo assim\?/.test(appTxt), '“a definir” em amarelo e confirmação ao salvar como oficial');
  });

  console.log(`\n${total - falhas}/${total} verificações ok.`);
  if (falhas) process.exit(1);
})();
