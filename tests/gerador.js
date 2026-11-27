// Testes do servidor (Codigo.js) e do gerador (Gerador.html) com a escola de exemplo e casos pequenos.
// Uso: node tests/gerador.js
const { criarAmbiente } = require('./ambiente'), vm = require('vm');
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
    ok(v.props.ESQUEMA === '9', 'versão gravada');
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
    ok(w.props.ESQUEMA === '9' && d.versoes.length === 1 && d.versoes[0].descricao === 'Grade oficial que já estava salva', 'migração v5 → v6 guarda a grade que já existia');
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
      ['Ana (teste)', 'Ana Modelo (teste)', 'Matemática', '', '', '', '', '', 'EFAF', 'v1:a:b', 'Aprovado']];
    const carga = v.ss.getSheetByName('Carga');
    carga.d.find(r => r[0] === '6A' && r[1] === 'Arte')[2] = 'Ana (teste)';
    v.ss.getSheetByName('Blocos').d.push(['Ana (teste)', 'Plantão de Dúvidas', 'Matemática', 'Seg', '14:00', '15:00']);
    v.props.SAL_CODIGO = 'sal'; v.props.PROFS_TESTE = '1'; v.props.ESQUEMA = '8';
    v.ctx.garantirEsquema_();
    const cab = prof.d[0], d = v.dados(), P = n => d.professores.find(p => p.nome === n);
    ok(v.props.ESQUEMA === '9' && cab.length === 9 && cab[5] === 'Não pode (dia início-fim)' && cab[6] === 'Disponibilidade conferida em', 'cabeçalho novo (9 colunas)');
    ok(prof.d.slice(1).every(r => !r.slice(9).some(x => x !== '' && x !== undefined)), 'código e situação saíram da planilha');
    ok(P('Bianca').materias.join() === 'Língua Portuguesa,Matemática' && P('Bianca').segmentos.join() === 'EFAI' && P('Bianca').tel === '11 90000-0000' && P('Bianca').maxDia === 5 && P('Bianca').obs === 'só de manhã', 'matérias, segmentos e outros dados mantidos');
    ok(JSON.stringify(P('Bianca').indisp) === JSON.stringify([nao('Seg', '07:00', '09:00'), nao('Ter', '13:00', '14:00')]), 'faixas de 1h viram intervalos (e se juntam): ' + JSON.stringify(P('Bianca').indisp));
    ok(prof.d.find(r => r[0] === 'Bianca')[5] === 'Seg 07:00-09:00; Ter 13:00-14:00', 'na planilha: “Seg 07:00-09:00; Ter 13:00-14:00”');
    ok(!P('Bianca').conferida && !d.professores.some(p => p.conferida), '“respondeu” não vira “conferida”: a coordenação confere cada um');
    ok(P('Renata Exemplo Duarte') && P('Renata Exemplo Duarte').indisp.length === 1, 'quem aguardava aprovação continua, como professor comum');
    ok(!d.professores.some(p => /teste/.test(p.nome)), 'professores “(teste)” apagados');
    ok(d.carga.find(c => c.turmas[0] === '6A' && c.disciplina === 'Arte').professor === '' && !d.blocos.some(b => /teste/.test(b.professor)), '…as turmas deles ficam sem professor e os horários reservados saem');
    ok(d.carga.filter(c => c.professor === 'Bianca').length > 0, 'atribuições dos outros professores mantidas');
    ok(!v.props.SAL_CODIGO && !v.props.PROFS_TESTE, 'propriedades do formulário apagadas');
    ok(v.ss.getSheetByName('Registro').d.some(r => /Apagou os professores de teste \(Ana \(teste\)\)/.test(r[2])), 'fica anotado no Registro');
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
    const fn = nome => (new RegExp('function ' + nome + '\\([\\s\\S]*?\\n}\\n').exec(app) || [''])[0];
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
    ok(Object.keys(d.grade).length === 1 && d.versoes.some(x => /antes do novo Extra/.test(x.descricao)), 'grade oficial: o Extra antigo sai e a versão anterior fica guardada');
    const reg = v.ss.getSheetByName('Registro').d.map(r => r[2]).join('\n');
    ok(/Novo Extra \(proposta 2027\): apagou 3 grupo\(s\) do Extra antigo \(EXTRA 1º ano A, 6º\/7º, EXTRA EFAI tarde\) e 3 atribuição/.test(reg) && /criou 21 Extra/.test(reg), 'o que foi apagado e criado fica no Registro');
    v.props.ESQUEMA = '8'; ctx.garantirEsquema_();
    ok(v.dados().turmas.filter(t => t.segmento === 'Extra').length === 21, 'rodar de novo não duplica');
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
    const fonte = (/function equipeExtra\([\s\S]*?\n}\n/.exec(app) || [''])[0];
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

  console.log(`\n${total - falhas}/${total} verificações ok.`);
  if (falhas) process.exit(1);
})();
