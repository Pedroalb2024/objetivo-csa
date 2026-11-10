// ================= GRADE HORÁRIA · OBJETIVO CSA — servidor (Apps Script) =================
// ENDEREÇO DO SITE: o único lugar para trocar quando houver domínio próprio (ex.: 'https://horarios.objetivocsa.com.br/').
// Dali vêm os arquivos (logo.png, logo-branco.png, icone.png da pasta docs/) e o link do sistema e do formulário (?form=1).
const SITE = 'https://pedroalb2024.github.io/objetivo-csa/';
const CONFIG = {
  ESCOLA: 'Objetivo CSA',
  ASSETS: SITE,
  URL_PUBLICA: SITE,
  CREDITO: 'ALBIX',
  SESSAO_HORAS: 6,
};
const ESQUEMA = '6';   // versão das colunas da planilha; mudou → migrar_() roda sozinho uma vez
const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'];
const SERIES = {
  EFAI: ['1º ano', '2º ano', '3º ano', '4º ano', '5º ano'],
  EFAF: ['6º ano', '7º ano', '8º ano', '9º ano'],
  EM: ['1ª série', '2ª série', '3ª série'],
  Extra: [],
};
const FAIXAS = { 'Manhã': [7, 8, 9, 10, 11, 12], 'Tarde': [13, 14, 15, 16, 17, 18] };   // faixas de 1h da disponibilidade
const TIPOS_BLOCO = ['Complementação de Carga Horária', 'Plantão de Dúvidas'];
const ABA = { config: 'Config', prof: 'Professores', turmas: 'Turmas', carga: 'Carga', fixas: 'Fixas', grade: 'Grade',
  matriz: 'Matriz', comp: 'Componentes', blocos: 'Blocos', usuarios: 'Usuários', registro: 'Registro', hist: 'Histórico da grade' };
const CAB = {
  'Config': ['Grade de horário', 'Tipo (Aula/Intervalo)', 'Início', 'Fim'],
  'Professores': ['Professor (nome curto)', 'Nome completo', 'Disciplinas', 'WhatsApp', 'Máx. aulas por dia', 'Indisponível (dia faixa)', 'Respondeu em', 'Observação', 'Segmentos'],
  'Turmas': ['Turma', 'Segmento (EFAI/EFAF/EM/Extra)', 'Série', 'Grade de horário'],
  'Carga': ['Turma(s)', 'Disciplina', 'Professor', 'Aulas/semana', 'Aulas duplas', 'Máx. por dia'],
  'Fixas': ['Turma', 'Dia', 'Aula nº', 'Disciplina'],
  'Grade': ['Turma', 'Dia', 'Aula nº', 'Horário', 'Disciplina', 'Professor'],
  'Matriz': ['Série', 'Componente', 'Aulas/semana'],
  'Componentes': ['Componente', 'Sigla', 'Apelidos (aSc), separados por ;'],
  'Blocos': ['Professor', 'Tipo', 'Disciplina', 'Dia', 'Início', 'Fim'],
  'Usuários': ['Usuário', 'Senha', 'Nome', 'Perfil (admin / coordenacao / consulta)', 'Ativo (Sim/Não)', 'Último acesso'],
  'Registro': ['Data', 'Usuário', 'Ação'],
  'Histórico da grade': ['Versão', 'Data', 'Usuário', 'O que mudou', 'Válida a partir de', 'Parte', 'Dados (não editar)'],
};
const MAX_VERSOES = 80, PARTE_MAX = 40000;   // versões guardadas no histórico; tamanho de cada pedaço (limite da célula: 50 mil)
const PERFIS = ['admin', 'coordenacao', 'consulta'];

// ---------------- Páginas ----------------
function doGet(e) {
  const form = !!(e && e.parameter && 'form' in e.parameter);
  const t = HtmlService.createTemplateFromFile(form ? 'Formulario' : 'App');
  t.cfg = cfg_();
  return t.evaluate()
    .setTitle((form ? 'Disponibilidade · ' : 'Grade Horária · ') + CONFIG.ESCOLA)
    .setFaviconUrl(CONFIG.ASSETS + 'icone.png')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function cfg_() {
  const a = CONFIG.ASSETS;
  return { escola: CONFIG.ESCOLA, credito: CONFIG.CREDITO, logo: a ? a + 'logo.png' : '', logoBranco: a ? a + 'logo-branco.png' : '' };
}
function incluir_(arquivo) { return HtmlService.createHtmlOutputFromFile(arquivo).getContent(); }

// ---------------- Login e sessão ----------------
function login(usuario, senha) {
  garantirEsquema_();
  usuario = String(usuario || '').trim().toLowerCase();
  const cache = CacheService.getScriptCache(), kf = 'falha_' + usuario;
  if (+(cache.get(kf) || 0) >= 5) throw new Error('Muitas tentativas erradas. Aguarde 10 minutos.');
  const u = acharUsuario_(usuario);
  if (!u || u.senha !== String(senha || '')) {
    cache.put(kf, String(+(cache.get(kf) || 0) + 1), 600);
    throw new Error('Usuário ou senha incorretos.');
  }
  if (!u.ativo) throw new Error('Usuário desativado. Fale com o administrador.');
  cache.remove(kf);
  const s = { u: u.usuario, nome: u.nome || u.usuario, perfil: u.perfil };
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().slice(0, 8);
  cache.put('sessao_' + token, JSON.stringify(s), CONFIG.SESSAO_HORAS * 3600);
  aba_(ABA.usuarios).getRange(u.linha, 6).setValue(agora_());
  registrar_(s.u, 'Entrou no sistema');
  return { token: token, usuario: s };
}

function sair(token) { CacheService.getScriptCache().remove('sessao_' + token); return true; }

function sessao_(token) {
  const cache = CacheService.getScriptCache(), k = 'sessao_' + String(token || '');
  const bruto = token && cache.get(k);
  if (!bruto) throw new Error('SESSAO_EXPIRADA');
  const s = JSON.parse(bruto), u = acharUsuario_(s.u);       // confere a cada chamada: desativou, perdeu acesso na hora
  if (!u || !u.ativo) { cache.remove(k); throw new Error('SESSAO_EXPIRADA'); }
  s.perfil = u.perfil; s.nome = u.nome || u.usuario;
  cache.put(k, JSON.stringify(s), CONFIG.SESSAO_HORAS * 3600);
  return s;
}

function acharUsuario_(usuario) {
  const v = valores_(ABA.usuarios);
  for (let i = 0; i < v.length; i++) {
    if (txt_(v[i][0]).toLowerCase() !== String(usuario).toLowerCase()) continue;
    return { linha: i + 2, usuario: txt_(v[i][0]).toLowerCase(), senha: txt_(v[i][1]), nome: txt_(v[i][2]),
      perfil: PERFIS.indexOf(txt_(v[i][3]).toLowerCase()) >= 0 ? txt_(v[i][3]).toLowerCase() : 'consulta', ativo: sim_(v[i][4]) };
  }
  return null;
}

// ---------------- API única (toda tela passa por aqui) ----------------
const EDITA = ['admin', 'coordenacao'];
const ACOES = {
  carregar:         { p: ['admin', 'coordenacao', 'consulta'], f: (d, s) => dados_(s) },
  salvarGrades:     { p: EDITA, f: salvarGrades_ },
  salvarProfessor:  { p: EDITA, f: salvarProfessor_ },
  excluirProfessor: { p: EDITA, f: excluirProfessor_ },
  salvarTurma:      { p: EDITA, f: salvarTurma_ },
  excluirTurma:     { p: EDITA, f: excluirTurma_ },
  salvarCarga:      { p: EDITA, f: salvarCarga_ },
  salvarAtribuicoes:{ p: EDITA, f: salvarAtribuicoes_ },
  salvarFixas:      { p: EDITA, f: salvarFixas_ },
  salvarGrade:      { p: EDITA, f: salvarGrade_ },
  lerVersao:        { p: ['admin', 'coordenacao', 'consulta'], f: lerVersao_, leitura: true },
  restaurarVersao:  { p: EDITA, f: restaurarVersao_ },
  substituir:       { p: EDITA, f: substituir_ },
  salvarMatriz:     { p: EDITA, f: salvarMatriz_ },
  previaMatriz:     { p: EDITA, f: previaMatriz_, leitura: true },
  aplicarMatriz:    { p: EDITA, f: aplicarMatriz_ },
  conferirEstrutura:{ p: EDITA, f: conferirEstrutura_ },
  comecarAno:       { p: ['admin'], f: comecarAno_ },
  salvarUsuario:    { p: ['admin'], f: salvarUsuario_ },
  excluirUsuario:   { p: ['admin'], f: excluirUsuario_ },
};

function api(token, acao, dados) {
  garantirEsquema_();
  const s = sessao_(token), a = ACOES[acao];
  if (!a) throw new Error('Ação desconhecida.');
  if (a.p.indexOf(s.perfil) < 0) throw new Error('Seu perfil não tem permissão para isso.');
  if (acao === 'carregar') return dados_(s);
  if (a.leitura) return a.f(dados || {}, s);
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const msg = a.f(dados || {}, s);
    if (msg) registrar_(s.u, msg);
    return dados_(s);          // devolve tudo atualizado
  } finally { lock.releaseLock(); }
}

function dados_(s) {
  const D = {
    dias: DIAS, escola: CONFIG.ESCOLA, usuario: s, linkBase: linkBase_(), linkForm: linkBase_() + '?form=1',
    series: SERIES, faixas: FAIXAS, tiposBloco: TIPOS_BLOCO,
    grades: lerGrades_(),
    professores: lerProfessores_(),
    turmas: lerTurmas_(),
    carga: lerCarga_(),
    fixas: valores_(ABA.fixas).map(r => ({ turma: txt_(r[0]), dia: txt_(r[1]), aula: num_(r[2]), disciplina: txt_(r[3]) })),
    matriz: lerMatriz_(),
    componentes: lerComponentes_(),
    blocos: lerBlocos_(),
    grade: {},
    versoes: lerVersoes_().slice(0, 50),
  };
  D.vigencia = D.versoes.length ? D.versoes[0].vigencia : '';
  const pr = PropertiesService.getScriptProperties();
  D.ano = { ano: pr.getProperty('ANO_LETIVO') || '', conferido: pr.getProperty('ESTRUTURA_CONFERIDA') === '1' };
  valores_(ABA.grade).forEach(r => {
    const d = DIAS.indexOf(txt_(r[1])), a = num_(r[2]) - 1;
    if (d >= 0 && a >= 0) D.grade[txt_(r[0]) + '|' + d + '|' + a] = { disciplina: txt_(r[4]), professor: txt_(r[5]) };
  });
  if (s.perfil === 'admin') {
    D.usuarios = valores_(ABA.usuarios).map(r => ({ usuario: txt_(r[0]).toLowerCase(), senha: txt_(r[1]), nome: txt_(r[2]),
      perfil: txt_(r[3]).toLowerCase(), ativo: sim_(r[4]), ultimo: txt_(r[5]) }));
    const sh = aba_(ABA.registro), n = sh.getLastRow();
    D.registro = n < 2 ? [] : sh.getRange(Math.max(2, n - 39), 1, Math.min(40, n - 1), 3).getValues().reverse()
      .map(r => ({ quando: r[0] instanceof Date ? Utilities.formatDate(r[0], tz_(), 'dd/MM HH:mm') : txt_(r[0]), usuario: txt_(r[1]), acao: txt_(r[2]) }));
  }
  return D;
}

// ---------------- Grades de horário ----------------
function salvarGrades_(d) {
  const grades = (d.grades || []).map(g => ({ nome: String(g.nome || '').trim(), nomeAntigo: String(g.nomeAntigo || '').trim(),
    itens: (g.itens || []).map(i => ({ tipo: i.tipo === 'intervalo' ? 'intervalo' : 'aula', ini: normHora_(i.ini), fim: normHora_(i.fim) })) }));
  if (!grades.length) throw new Error('Cadastre pelo menos um período com horários de aula.');
  const nomes = grades.map(g => g.nome);
  if (nomes.some(n => !n) || new Set(nomes.map(n => n.toLowerCase())).size !== nomes.length) throw new Error('Cada período precisa de um nome diferente.');
  grades.forEach(g => { const e = problemaGrade_(g.itens); if (e) throw new Error(g.nome + ': ' + e); });
  const renomeia = {}; grades.forEach(g => { if (g.nomeAntigo && g.nomeAntigo !== g.nome) renomeia[g.nomeAntigo] = g.nome; });
  const semGrade = lerTurmas_().filter(t => nomes.indexOf(renomeia[t.grade] || t.grade) < 0).map(t => t.nome);
  if (semGrade.length) throw new Error('Estas turmas usam um período que seria removido: ' + semGrade.join(', '));
  Object.keys(renomeia).forEach(de => trocarValor_(ABA.turmas, 3, de, renomeia[de]));
  const linhas = [];
  grades.forEach(g => g.itens.forEach(i => linhas.push([g.nome, i.tipo === 'intervalo' ? 'Intervalo' : 'Aula', i.ini, i.fim])));
  gravar_(ABA.config, linhas);
  return 'Alterou os horários das aulas';
}

// Confere uma lista de itens {tipo, ini, fim}: devolve o problema ou ''
function problemaGrade_(itens) {
  if (!itens.some(i => i.tipo !== 'intervalo')) return 'precisa de pelo menos uma aula.';
  let ant = null;
  for (let k = 0; k < itens.length; k++) {
    const i = itens[k], a = minutos_(i.ini), b = minutos_(i.fim), nome = (i.tipo === 'intervalo' ? 'intervalo' : 'aula') + ' ' + (k + 1);
    if (isNaN(a) || isNaN(b)) return `${nome}: horário no formato hh:mm.`;
    if (a % 10 || b % 10) return `${nome}: use horários de 10 em 10 minutos.`;
    if (b <= a) return `${nome}: o fim precisa ser depois do início.`;
    if (ant !== null && a < ant) return `${nome}: começa antes do fim do item anterior.`;
    ant = b;
  }
  return '';
}

// ---------------- Cadastros ----------------
// Cadastro do professor. Se vier "carga" (aba Turmas e matérias), grava também as atribuições, com a mesma proteção
// da Conferência das turmas: "cargaAntes" = como estavam quando a tela abriu.
function salvarProfessor_(d) {
  const nome = String(d.nome || '').trim(), antigo = String(d.nomeAntigo || '').trim();
  if (!nome) throw new Error('Informe o nome curto do professor.');
  if (d.carga) conferirAntes_(d.cargaAntes);
  const v = valores_(ABA.prof);
  const i = antigo ? v.findIndex(r => txt_(r[0]) === antigo) : -1;
  if (v.some((r, j) => j !== i && txt_(r[0]).toLowerCase() === nome.toLowerCase())) throw new Error('Já existe um professor com esse nome.');
  const blocos = (d.blocos || []).map((b, k) => {
    const lin = `Horário reservado ${k + 1}`, ini = normHora_(b.ini), fim = normHora_(b.fim);
    if (TIPOS_BLOCO.indexOf(b.tipo) < 0) throw new Error(`${lin}: escolha o tipo.`);
    if (DIAS.indexOf(b.dia) < 0) throw new Error(`${lin}: escolha o dia.`);
    if (!ini || !fim || minutos_(fim) <= minutos_(ini)) throw new Error(`${lin}: informe início e fim (hh:mm).`);
    if (minutos_(ini) % 10 || minutos_(fim) % 10) throw new Error(`${lin}: use horários de 10 em 10 minutos.`);
    return [nome, b.tipo, b.tipo === 'Plantão de Dúvidas' ? String(b.disciplina || '').trim() : '', b.dia, ini, fim];
  });
  const materias = Array.isArray(d.materias) ? d.materias : lista_(d.disciplinas);
  const segmentos = (d.segmentos || []).filter(x => SERIES[x]);
  const linha = [nome, String(d.completo || '').trim(), [...new Set(materias.map(m => String(m).trim()).filter(String))].join(', '), String(d.tel || '').trim(), +d.maxDia || '',
    gravarIndisp_(filtrarIndisp_(d.indisp)), i >= 0 ? txt_(v[i][6]) : '', i >= 0 ? txt_(v[i][7]) : '', Object.keys(SERIES).filter(x => segmentos.indexOf(x) >= 0).join(', ')];
  if (i >= 0) v[i] = linha; else v.push(linha);
  gravar_(ABA.prof, v);
  gravar_(ABA.blocos, valores_(ABA.blocos).filter(r => txt_(r[0]) !== (antigo || nome)).concat(blocos));
  if (i >= 0 && antigo !== nome) { trocarValor_(ABA.carga, 2, antigo, nome); trocarValor_(ABA.grade, 5, antigo, nome); }
  if (d.carga) gravarCarga_(d.carga);
  return (i >= 0 ? 'Editou professor ' : 'Cadastrou professor ') + nome + (d.carga ? ' (com turmas e matérias)' : '');
}

function excluirProfessor_(d) {
  const usos = lerCarga_().filter(c => c.professor === d.nome).map(c => c.turmas.join(' + ') + ' (' + c.disciplina + ')');
  if (usos.length) throw new Error('Este professor ainda tem aulas em: ' + usos.join(', ') + '. Tire as turmas dele antes (no cadastro do professor, em “Turmas e matérias”) ou use “Trocar professor” na grade.');
  gravar_(ABA.prof, valores_(ABA.prof).filter(r => txt_(r[0]) !== d.nome));
  gravar_(ABA.blocos, valores_(ABA.blocos).filter(r => txt_(r[0]) !== d.nome));
  return 'Excluiu professor ' + d.nome;
}

function salvarTurma_(d) {
  const nome = String(d.nome || '').trim(), antigo = String(d.nomeAntigo || '').trim(), seg = String(d.segmento || ''), serie = String(d.serie || '').trim();
  if (!nome) throw new Error('Informe o nome da turma.');
  if (nome.indexOf('+') >= 0 || nome.indexOf('|') >= 0) throw new Error('O nome da turma não pode ter "+" nem "|".');
  if (!SERIES[seg]) throw new Error('Escolha o segmento.');
  if (seg !== 'Extra' && SERIES[seg].indexOf(serie) < 0) throw new Error('Escolha a série.');
  if (!lerGrades_().some(g => g.nome === d.grade)) throw new Error('Escolha o horário das aulas da turma.');
  const v = valores_(ABA.turmas), i = antigo ? v.findIndex(r => txt_(r[0]) === antigo) : -1;
  if (v.some((r, j) => j !== i && txt_(r[0]).toLowerCase() === nome.toLowerCase())) throw new Error('Já existe uma turma com esse nome.');
  const linha = [nome, seg, seg === 'Extra' ? '' : serie, d.grade];
  if (i >= 0) v[i] = linha; else v.push(linha);
  gravar_(ABA.turmas, v);
  if (i >= 0 && antigo !== nome) {
    gravar_(ABA.carga, valores_(ABA.carga).map(r => { r[0] = listaTurmas_(r[0]).map(t => t === antigo ? nome : t).join(' + '); return r; }));
    [ABA.fixas, ABA.grade].forEach(a => trocarValor_(a, 0, antigo, nome));
  }
  return (i >= 0 ? 'Editou turma ' : 'Criou turma ') + nome;
}

function excluirTurma_(d) {
  gravar_(ABA.carga, valores_(ABA.carga).map(r => { r[0] = listaTurmas_(r[0]).filter(t => t !== d.nome).join(' + '); return r; }).filter(r => r[0]));
  [ABA.turmas, ABA.fixas, ABA.grade].forEach(a => gravar_(a, valores_(a).filter(r => txt_(r[0]) !== d.nome)));
  return 'Excluiu turma ' + d.nome;
}

// Disciplinas de uma turma. Linha com "juntas" vale para várias turmas ao mesmo tempo (ex.: "5A + 5B").
function salvarCarga_(d) {
  const turma = d.turma, turmas = {}, profs = valores_(ABA.prof).map(r => txt_(r[0]));
  lerTurmas_().forEach(t => turmas[t.nome] = t);
  if (!turmas[turma]) throw new Error('Turma não encontrada.');
  const novas = (d.linhas || []).filter(l => String(l.disciplina || '').trim()).map(l => {
    const disc = String(l.disciplina).trim(), prof = String(l.professor || '').trim();
    const juntas = [...new Set((l.juntas || []).filter(t => t && t !== turma))];
    juntas.forEach(t => {
      if (!turmas[t]) throw new Error(`${disc}: turma ${t} não encontrada.`);
      if (turmas[t].grade !== turmas[turma].grade) throw new Error(`${disc}: ${t} tem outro horário das aulas. Turmas juntas precisam ter o mesmo horário.`);
    });
    if (prof && profs.indexOf(prof) < 0) throw new Error(`${disc}: professor não encontrado.`);
    if (!(+l.aulas > 0)) throw new Error(`${disc}: informe as aulas por semana.`);
    return [[turma].concat(juntas).join(' + '), disc, prof, +l.aulas, +l.duplas || 0, +l.maxDia || maxDiaPadrao_(+l.aulas)];
  });
  const final = valores_(ABA.carga).filter(r => listaTurmas_(r[0]).indexOf(turma) < 0).concat(novas);
  conferirDuplicadas_(final);
  gravar_(ABA.carga, final);
  limparFixas_(final);
  return 'Alterou as matérias da turma ' + turma;
}

// Conferência das turmas: grava a carga inteira (quem dá cada matéria em cada turma). "antes" = carga quando a tela abriu;
// se outra pessoa mudou nesse meio-tempo, recusa para não apagar o trabalho dela.
function salvarAtribuicoes_(d) {
  conferirAntes_(d.antes);
  const n = gravarCarga_(d.carga || []);
  return 'Alterou as atribuições (' + n + ' linhas)';
}
function conferirAntes_(antes) {
  if (antes && JSON.stringify(normCarga_(lerCarga_())) !== JSON.stringify(normCarga_(antes))) throw new Error('Outra pessoa mudou as turmas e professores enquanto você editava. Feche sem salvar e abra de novo.');
}
function gravarCarga_(lista) {
  const turmas = {}, profs = valores_(ABA.prof).map(r => txt_(r[0]));
  lerTurmas_().forEach(t => turmas[t.nome] = t);
  const linhas = lista.map(c => {
    const ts = [...new Set(listaTurmas_(c.turmas))], disc = String(c.disciplina || '').trim(), prof = String(c.professor || '').trim(), rot = ts.join(' + ');
    if (!ts.length || !disc) throw new Error('Há uma atribuição sem turma ou sem matéria.');
    ts.forEach(t => { if (!turmas[t]) throw new Error(`${disc}: turma ${t} não encontrada.`); });
    if (new Set(ts.map(t => turmas[t].grade)).size > 1) throw new Error(`${disc} (${rot}): turmas juntas precisam usar o mesmo horário das aulas.`);
    if (prof && profs.indexOf(prof) < 0) throw new Error(`${disc} (${rot}): professor não encontrado.`);
    if (!(+c.aulas > 0)) throw new Error(`${disc} (${rot}): informe as aulas por semana.`);
    if ((+c.duplas || 0) * 2 > +c.aulas) throw new Error(`${disc} (${rot}): aulas duplas demais para ${+c.aulas} aulas.`);
    return [rot, disc, prof, +c.aulas, +c.duplas || 0, +c.maxDia || maxDiaPadrao_(+c.aulas)];
  });
  conferirDuplicadas_(linhas);
  gravar_(ABA.carga, linhas);
  limparFixas_(linhas);
  return linhas.length;
}
function normCarga_(c) { return (c || []).map(x => [listaTurmas_(x.turmas).join(' + '), txt_(x.disciplina), txt_(x.professor), +x.aulas || 0, +x.duplas || 0, +x.maxDia || 0].join('|')).sort(); }

function conferirDuplicadas_(linhas) {
  const vistos = {};
  linhas.forEach(r => listaTurmas_(r[0]).forEach(t => {
    const k = t + '|' + txt_(r[1]).toLowerCase();
    if (vistos[k]) throw new Error(`${t} ficaria com ${txt_(r[1])} duas vezes.`);
    vistos[k] = 1;
  }));
}
function limparFixas_(carga) {   // fixas de disciplinas que saíram da carga saem junto
  const ok = {}; carga.forEach(r => listaTurmas_(r[0]).forEach(t => ok[t + '|' + txt_(r[1])] = 1));
  gravar_(ABA.fixas, valores_(ABA.fixas).filter(r => ok[txt_(r[0]) + '|' + txt_(r[3])]));
}

function salvarFixas_(d) {
  const linhas = (d.fixas || []).filter(f => f.turma && f.disciplina).map(f => [f.turma, f.dia, +f.aula, f.disciplina]);
  gravar_(ABA.fixas, linhas);
  return 'Alterou aulas fixas (' + linhas.length + ')';
}

function salvarGrade_(d, s) {
  const vig = vigencia_(d.vigencia), n = gravarGrade_(d.grade || {});
  guardarVersao_(s, 'Salvou como oficial', vig);
  return `Salvou a grade como oficial (${n} aulas), válida a partir de ${vig}`;
}
function gravarGrade_(grade) {
  const ordem = {}, aulasDe = {}, grades = {};
  lerGrades_().forEach(g => grades[g.nome] = aulasGrade_(g));
  lerTurmas_().forEach((t, i) => { ordem[t.nome] = i; aulasDe[t.nome] = grades[t.grade] || []; });
  const linhas = Object.keys(grade).map(k => {
    const p = k.split('|'), c = grade[k], x = (aulasDe[p[0]] || [])[+p[2]];
    return [p[0], DIAS[+p[1]], +p[2] + 1, x ? hhmm_(x.ini) + '–' + hhmm_(x.fim) : '', c.disciplina, c.professor, p[0] in ordem ? ordem[p[0]] : 999, +p[1]];
  }).sort((x, y) => x[6] - y[6] || x[7] - y[7] || x[2] - y[2]).map(r => r.slice(0, 6));
  gravar_(ABA.grade, linhas);
  return linhas.length;
}

// ---------------- Histórico de versões da grade oficial ----------------
// Cada "Salvar como oficial", troca de professor e restauração guarda uma cópia da grade e das atribuições (carga).
// A cópia vai em JSON, dividida em pedaços (uma linha por pedaço), porque a célula aceita no máximo 50 mil caracteres.
function vigencia_(v) {   // "2026-11-16" ou "16/11/2026" → "16/11/2026"; vazio = hoje
  const t = txt_(v);
  if (!t) return agora_().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t) || /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  if (!m) throw new Error('Data “válida a partir de” inválida.');
  const [a, me, di] = m[1].length === 4 ? [+m[1], +m[2], +m[3]] : [+m[3], +m[2], +m[1]];
  const dt = new Date(a, me - 1, di);
  if (dt.getFullYear() !== a || dt.getMonth() !== me - 1 || dt.getDate() !== di) throw new Error('Data “válida a partir de” inválida.');
  return ('0' + di).slice(-2) + '/' + ('0' + me).slice(-2) + '/' + a;
}
function lerVersoes_() {   // mais recente primeiro; só as colunas leves
  const sh = aba_(ABA.hist), n = sh.getLastRow();
  if (n < 2) return [];
  const data = (v, f) => v instanceof Date ? Utilities.formatDate(v, tz_(), f) : txt_(v);
  return sh.getRange(2, 1, n - 1, 6).getValues().filter(r => num_(r[0]) > 0 && num_(r[5]) === 1)
    .map(r => ({ versao: num_(r[0]), data: data(r[1], 'dd/MM/yyyy HH:mm'), usuario: txt_(r[2]), descricao: txt_(r[3]), vigencia: data(r[4], 'dd/MM/yyyy') }))
    .sort((x, y) => y.versao - x.versao);
}
function guardarVersao_(s, descricao, vigencia) {
  const vs = lerVersoes_(), n = vs.length ? vs[0].versao + 1 : 1;
  const json = JSON.stringify({ g: valores_(ABA.grade).map(r => [txt_(r[0]), txt_(r[1]), num_(r[2]), txt_(r[4]), txt_(r[5])]), c: valores_(ABA.carga) });
  const partes = []; for (let i = 0; i < json.length || !partes.length; i += PARTE_MAX) partes.push('#' + json.slice(i, i + PARTE_MAX));   // "#": o pedaço nunca começa com "=" ou "+"
  const quando = agora_(), quem = s ? s.nome || s.u : 'planilha';
  acrescentar_(ABA.hist, partes.map((p, i) => [n, quando, quem, descricao, vigencia, i + 1, p]));
  if (vs.length + 1 > MAX_VERSOES) {   // guarda só as últimas
    const corte = vs[MAX_VERSOES - 2].versao;   // a nova + as MAX_VERSOES - 1 mais recentes
    gravar_(ABA.hist, valores_(ABA.hist).filter(r => num_(r[0]) >= corte));
  }
  return n;
}
function dadosVersao_(n) {
  const partes = valores_(ABA.hist).filter(r => num_(r[0]) === n).sort((x, y) => num_(x[5]) - num_(y[5]));
  if (!partes.length) throw new Error('Versão não encontrada.');
  return JSON.parse(partes.map(r => String(r[6]).replace(/^#/, '')).join(''));
}
function gradeDaVersao_(v) {
  const g = {};
  v.g.forEach(r => { const d = DIAS.indexOf(r[1]); if (d >= 0 && r[2] > 0) g[r[0] + '|' + d + '|' + (r[2] - 1)] = { disciplina: r[3], professor: r[4] }; });
  return g;
}
function lerVersao_(d) {
  const n = +d.versao, info = lerVersoes_().filter(x => x.versao === n)[0];
  if (!info) throw new Error('Versão não encontrada.');
  return { info: info, grade: gradeDaVersao_(dadosVersao_(n)) };
}
function restaurarVersao_(d, s) {
  const n = +d.versao, info = lerVersoes_().filter(x => x.versao === n)[0];
  if (!info) throw new Error('Versão não encontrada.');
  const v = dadosVersao_(n);
  gravar_(ABA.carga, v.c);
  limparFixas_(v.c);
  gravarGrade_(gradeDaVersao_(v));
  guardarVersao_(s, `Voltou para a versão de ${info.data.slice(0, 10)} (${info.descricao})`, info.vigencia);
  return `Restaurou a versão ${n} da grade (${info.data})`;
}

// ---------------- Começar ano letivo ----------------
// Guarda a grade atual no histórico; apaga a grade oficial, quem dá cada matéria (as matérias de cada turma ficam, sem professor),
// as aulas fixas e os horários reservados. Professores: mantém (e volta a "não respondeu o formulário") ou apaga.
// Mantém horários das aulas, turmas, matriz e usuários. Depois acerta as matérias das turmas pela matriz.
function comecarAno_(d, s) {
  const ano = String(d.ano || '').trim();
  if (!/^20\d\d$/.test(ano)) throw new Error('Informe o ano (ex.: 2027).');
  if (d.professores !== 'manter' && d.professores !== 'apagar') throw new Error('Escolha o que fazer com os professores.');
  if (valores_(ABA.grade).length) guardarVersao_(s, `Grade do fim do ano (antes de começar ${ano})`, '');
  gravar_(ABA.grade, []); gravar_(ABA.fixas, []); gravar_(ABA.blocos, []);
  const carga = valores_(ABA.carga).map(r => { r[2] = ''; return r; });
  const series = [].concat(SERIES.EFAI, SERIES.EFAF, SERIES.EM);
  const r = calcMatriz_(lerTurmas_(), carga, lerMatriz_(), lerComponentes_(), series, false);
  conferirDuplicadas_(r.carga);
  gravar_(ABA.carga, r.carga);
  if (d.professores === 'apagar') gravar_(ABA.prof, []);
  else gravar_(ABA.prof, valores_(ABA.prof).map(p => { p[6] = ''; return p; }));
  const pr = PropertiesService.getScriptProperties();
  pr.setProperty('ANO_LETIVO', ano); pr.deleteProperty('ESTRUTURA_CONFERIDA');
  return `Começou o ano letivo ${ano} (professores ${d.professores === 'apagar' ? 'apagados' : 'mantidos'})`;
}
function conferirEstrutura_(d) {
  const pr = PropertiesService.getScriptProperties();
  if (d.ok === false) { pr.deleteProperty('ESTRUTURA_CONFERIDA'); return 'Desmarcou: horários, turmas e matriz conferidos'; }
  pr.setProperty('ESTRUTURA_CONFERIDA', '1');
  return 'Marcou: horários, turmas e matriz conferidos';
}

function substituir_(d, s) {
  const profs = valores_(ABA.prof).map(r => txt_(r[0]));
  if (profs.indexOf(d.entra) < 0) throw new Error('Professor que entra não encontrado.');
  const linhas = {}; (d.linhas || []).forEach(l => linhas[listaTurmas_(l.turmas).join(' + ') + '|' + l.disciplina] = 1);
  let n = 0;
  gravar_(ABA.carga, valores_(ABA.carga).map(r => {
    if (txt_(r[2]) === d.sai && linhas[listaTurmas_(r[0]).join(' + ') + '|' + txt_(r[1])]) { r[2] = d.entra; n++; }
    return r;
  }));
  const vig = vigencia_(d.vigencia);
  gravarGrade_(d.grade || {});
  guardarVersao_(s, d.sai === d.entra ? `Nova disponibilidade: ${d.entra}` : `Troca: ${d.sai} → ${d.entra}`, vig);
  return (d.sai === d.entra ? 'Reencaixou as aulas de ' + d.entra : `Trocou ${d.sai} por ${d.entra} (${n} matéria/turma)`) + `, válida a partir de ${vig}`;
}

// ---------------- Matriz curricular e componentes ----------------
function salvarMatriz_(d) {
  const comps = (d.componentes || []).map(c => ({ nome: String(c.nome || '').trim(), nomeAntigo: String(c.nomeAntigo || '').trim(), sigla: String(c.sigla || '').trim(),
    apelidos: (Array.isArray(c.apelidos) ? c.apelidos : String(c.apelidos || '').split(';')).map(a => String(a).trim()).filter(String) })).filter(c => c.nome);
  const chaves = {}, nomes = {};
  comps.forEach(c => {
    if (nomes[c.nome.toLowerCase()]) throw new Error(`Matéria repetida: ${c.nome}.`);
    nomes[c.nome.toLowerCase()] = 1;
    [...new Set([c.nome, c.sigla].concat(c.apelidos).filter(String).map(normalizar_))].forEach(k => {
      if (chaves[k] && chaves[k] !== c.nome) throw new Error(`"${k}" aparece em ${chaves[k]} e em ${c.nome}. Cada sigla ou outro nome só pode indicar uma matéria.`);
      chaves[k] = c.nome;
    });
  });
  const renomeia = {}; comps.forEach(c => { if (c.nomeAntigo && c.nomeAntigo !== c.nome) renomeia[c.nomeAntigo] = c.nome; });
  const todas = [].concat(SERIES.EFAI, SERIES.EFAF, SERIES.EM), vistas = {};
  const matriz = (d.matriz || []).map(m => {
    const comp = renomeia[m.componente] || String(m.componente || '').trim(), n = Math.round(+m.aulas);
    if (todas.indexOf(m.serie) < 0) throw new Error(`Série inválida: ${m.serie}.`);
    if (!nomes[comp.toLowerCase()]) throw new Error(`${comp}: cadastre a matéria (Matriz curricular → Matérias e siglas).`);
    if (!(n >= 1 && n <= 40)) throw new Error(`${comp} (${m.serie}): aulas por semana inválidas.`);
    if (vistas[m.serie + '|' + comp]) throw new Error(`${comp} aparece duas vezes no ${m.serie}.`);
    vistas[m.serie + '|' + comp] = 1;
    return [m.serie, comp, n];
  });
  Object.keys(renomeia).forEach(de => { trocarValor_(ABA.carga, 1, de, renomeia[de]); trocarValor_(ABA.fixas, 3, de, renomeia[de]); trocarValor_(ABA.grade, 4, de, renomeia[de]); });
  gravar_(ABA.comp, comps.map(c => [c.nome, c.sigla, c.apelidos.join('; ')]));
  gravar_(ABA.matriz, matriz);
  return 'Alterou a matriz curricular';
}

function previaMatriz_(d) { return calcMatriz_(lerTurmas_(), valores_(ABA.carga), lerMatriz_(), lerComponentes_(), d.series || [], !!d.remover).mudancas; }

function aplicarMatriz_(d) {
  const r = calcMatriz_(lerTurmas_(), valores_(ABA.carga), lerMatriz_(), lerComponentes_(), d.series || [], !!d.remover);
  conferirDuplicadas_(r.carga);
  gravar_(ABA.carga, r.carga);
  limparFixas_(r.carga);
  return `Aplicou a matriz (${r.mudancas.length} turma(s) alterada(s))`;
}

// Preenche a carga das turmas das séries escolhidas pela matriz. Mantém professor, duplas e turmas juntas.
// Linhas novas ficam com professor "a definir". remover = tira da turma o que não está na matriz.
function calcMatriz_(turmas, cargaLinhas, matriz, componentes, series, remover) {
  const alvo = {}; matriz.forEach(m => (alvo[m.serie] = alvo[m.serie] || {})[m.componente] = m.aulas);
  const rows = cargaLinhas.map(r => r.slice()), mudancas = [];
  const canon = nome => acharComponente_(nome, componentes) || txt_(nome);
  turmas.filter(t => t.segmento !== 'Extra' && series.indexOf(t.serie) >= 0 && alvo[t.serie]).forEach(t => {
    const mapa = alvo[t.serie], m = { turma: t.nome, novas: [], mudam: [], saem: [] };
    const minhas = rows.filter(r => listaTurmas_(r[0]).indexOf(t.nome) >= 0);
    Object.keys(mapa).forEach(comp => {
      const n = mapa[comp], r = minhas.find(x => canon(x[1]) === comp);
      if (!r) { rows.push([t.nome, comp, '', n, 0, maxDiaPadrao_(n)]); m.novas.push(`${comp} (${n})`); return; }
      if (txt_(r[1]) !== comp) { m.mudam.push(`${txt_(r[1])} → ${comp}`); r[1] = comp; }
      if (num_(r[3]) !== n) {
        m.mudam.push(`${comp}: ${num_(r[3])} → ${n}`);
        r[3] = n; r[4] = Math.min(num_(r[4]), Math.floor(n / 2)); r[5] = Math.max(num_(r[5]), Math.ceil(n / 5));
      }
    });
    if (remover) minhas.forEach(r => {
      if (mapa[canon(r[1])]) return;
      m.saem.push(txt_(r[1]));
      r[0] = listaTurmas_(r[0]).filter(x => x !== t.nome).join(' + ');
    });
    if (m.novas.length || m.mudam.length || m.saem.length) mudancas.push(m);
  });
  return { carga: rows.filter(r => txt_(r[0])), mudancas };
}

// Acha o componente por nome, sigla ou apelido do aSc (sem acento, maiúscula ou ponto). '' = não achou.
function acharComponente_(texto, componentes) {
  const k = normalizar_(texto); if (!k) return '';
  for (const c of componentes) if (normalizar_(c.nome) === k || normalizar_(c.sigla) === k || (c.apelidos || []).some(a => normalizar_(a) === k)) return c.nome;
  return '';
}
function normalizar_(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trim(); }
function maxDiaPadrao_(n) { return Math.max(Math.ceil(n / 5), Math.min(n, 2)); }

function salvarUsuario_(d, s) {
  const usuario = String(d.usuario || '').trim().toLowerCase(), antigo = String(d.usuarioAntigo || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) throw new Error('Usuário: 3 a 30 caracteres, sem espaços nem acentos.');
  if (String(d.senha || '').length < 4) throw new Error('A senha precisa ter pelo menos 4 caracteres.');
  if (PERFIS.indexOf(d.perfil) < 0) throw new Error('Perfil inválido.');
  if (antigo === s.u && (d.perfil !== 'admin' || !d.ativo)) throw new Error('Você não pode tirar o seu próprio acesso de administrador.');
  const v = valores_(ABA.usuarios), i = antigo ? v.findIndex(r => txt_(r[0]).toLowerCase() === antigo) : -1;
  if (v.some((r, j) => j !== i && txt_(r[0]).toLowerCase() === usuario)) throw new Error('Esse usuário já existe.');
  const linha = [usuario, String(d.senha), String(d.nome || '').trim(), d.perfil, d.ativo ? 'Sim' : 'Não', i >= 0 ? txt_(v[i][5]) : ''];
  if (i >= 0) v[i] = linha; else v.push(linha);
  gravar_(ABA.usuarios, v);
  return (i >= 0 ? 'Editou usuário ' : 'Criou usuário ') + usuario;
}

function excluirUsuario_(d, s) {
  if (String(d.usuario).toLowerCase() === s.u) throw new Error('Você não pode excluir o seu próprio usuário.');
  gravar_(ABA.usuarios, valores_(ABA.usuarios).filter(r => txt_(r[0]).toLowerCase() !== String(d.usuario).toLowerCase()));
  return 'Excluiu usuário ' + d.usuario;
}

// ---------------- Formulário dos professores (link único, sem login) ----------------
function formLista() {
  garantirEsquema_();
  const disc = discPorProf_();
  return { escola: CONFIG.ESCOLA, dias: DIAS, faixas: FAIXAS,
    profs: lerProfessores_().map(p => ({ nome: p.nome, completo: p.completo, disciplinas: p.disciplinas || disc[p.nome] || '' }))
      .sort((a, b) => (a.completo || a.nome).localeCompare(b.completo || b.nome, 'pt')) };
}

function formDados(nome) {
  const p = lerProfessores_().find(x => x.nome === nome);
  if (!p) throw new Error('Professor não encontrado.');
  return { indisp: p.indisp, obs: p.obs, respondeuEm: p.respondeuEm };
}

function formEnviar(d) {
  garantirEsquema_();
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const v = valores_(ABA.prof), nome = String(d.nome || '').trim().replace(/\s+/g, ' '), quando = agora_();
    if (nome.length < 3) throw new Error('Informe seu nome completo.');
    const indisp = gravarIndisp_(filtrarIndisp_(d.indisp));
    const obs = String(d.obs || '').slice(0, 500), disc = String(d.disciplinas || '').trim().slice(0, 120), tel = String(d.tel || '').trim().slice(0, 30);
    let i = v.findIndex(r => txt_(r[0]).toLowerCase() === nome.toLowerCase());
    if (d.novo && i >= 0) throw new Error('Esse nome já está na lista. Volte e selecione-o.');
    if (!d.novo && i < 0) throw new Error('Professor não encontrado.');
    const comps = lerComponentes_(), discNorm = lista_(disc).map(x => acharComponente_(x, comps) || x).join(', ');
    if (i < 0) { v.push([nome, nome, discNorm, tel, '', indisp, quando, obs, '']); i = v.length - 1; }
    else { v[i][5] = indisp; v[i][6] = quando; v[i][7] = obs; if (disc) v[i][2] = discNorm; if (tel) v[i][3] = tel; }
    gravar_(ABA.prof, v);
    registrar_('formulário', (d.novo ? 'Novo professor: ' : 'Disponibilidade: ') + nome);
    return { quando: quando };
  } finally { lock.releaseLock(); }
}

function discPorProf_() {
  const m = {};
  lerCarga_().forEach(c => { m[c.professor] = m[c.professor] || []; if (m[c.professor].indexOf(c.disciplina) < 0) m[c.professor].push(c.disciplina); });
  Object.keys(m).forEach(p => m[p] = m[p].join(', '));
  return m;
}

// ---------------- Leitura das abas ----------------
function lerGrades_() {
  const m = {}, ordem = [];
  valores_(ABA.config).forEach(r => {
    const nome = txt_(r[0]);
    if (!m[nome]) { m[nome] = { nome: nome, itens: [] }; ordem.push(m[nome]); }
    m[nome].itens.push({ tipo: /^int/i.test(txt_(r[1])) ? 'intervalo' : 'aula', ini: hora_(r[2]), fim: hora_(r[3]) });
  });
  return ordem;
}
function aulasGrade_(g) { return g.itens.filter(i => i.tipo !== 'intervalo').map(i => ({ ini: minutos_(i.ini), fim: minutos_(i.fim) })); }
function lerProfessores_() {
  return valores_(ABA.prof).map(r => ({ nome: txt_(r[0]), completo: txt_(r[1]), disciplinas: txt_(r[2]), tel: txt_(r[3]), maxDia: num_(r[4]),
    indisp: lerIndisp_(r[5]), respondeuEm: txt_(r[6]), obs: txt_(r[7]), materias: lista_(r[2]), segmentos: lista_(r[8]).filter(x => SERIES[x]) }));
}
function lerTurmas_() { return valores_(ABA.turmas).map(r => ({ nome: txt_(r[0]), segmento: txt_(r[1]), serie: txt_(r[2]), grade: txt_(r[3]) })); }
function lerCarga_() {
  return valores_(ABA.carga).map(r => ({ turmas: listaTurmas_(r[0]), disciplina: txt_(r[1]), professor: txt_(r[2]), aulas: num_(r[3]), duplas: num_(r[4]), maxDia: num_(r[5]) }));
}
function lerMatriz_() { return valores_(ABA.matriz).map(r => ({ serie: txt_(r[0]), componente: txt_(r[1]), aulas: num_(r[2]) })).filter(m => m.componente && m.aulas > 0); }
function lerComponentes_() { return valores_(ABA.comp).map(r => ({ nome: txt_(r[0]), sigla: txt_(r[1]), apelidos: txt_(r[2]).split(';').map(a => a.trim()).filter(String) })); }
function lerBlocos_() {
  return valores_(ABA.blocos).map(r => ({ professor: txt_(r[0]), tipo: txt_(r[1]), disciplina: txt_(r[2]), dia: txt_(r[3]), ini: hora_(r[4]), fim: hora_(r[5]) }));
}
function lista_(v) { return String(v || '').split(/[,;]/).map(x => x.trim()).filter(String); }
function listaTurmas_(v) { return (Array.isArray(v) ? v : String(v || '').split('+')).map(t => String(t).trim()).filter(String); }

// Disponibilidade: "Seg 7h; Seg 13h" (faixa de 1h em que NÃO pode) <-> ["Seg|7", "Seg|13"]
function lerIndisp_(v) {
  return String(v || '').split(';').map(x => x.trim()).map(x => /^(\S+)\s+(\d{1,2})h$/.exec(x)).filter(m => m).map(m => m[1] + '|' + (+m[2]));
}
function filtrarIndisp_(lista) {
  const ok = {}; DIAS.forEach(d => Object.keys(FAIXAS).forEach(p => FAIXAS[p].forEach(h => ok[d + '|' + h] = 1)));
  return [...new Set((lista || []).filter(k => ok[k]))];
}
function gravarIndisp_(lista) {
  return lista.slice().sort((a, b) => { const x = a.split('|'), y = b.split('|'); return DIAS.indexOf(x[0]) - DIAS.indexOf(y[0]) || x[1] - y[1]; })
    .map(k => k.replace('|', ' ') + 'h').join('; ');
}

// ---------------- Planilha: leitura e escrita ----------------
function planilha_() {
  const id = PropertiesService.getScriptProperties().getProperty('PLANILHA_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActive();
}
function tz_() { return planilha_().getSpreadsheetTimeZone(); }
function agora_() { return Utilities.formatDate(new Date(), tz_(), 'dd/MM/yyyy HH:mm'); }

function aba_(nome) {
  const ss = planilha_();
  let sh = ss.getSheetByName(nome);
  if (!sh) { sh = ss.insertSheet(nome); cabecalho_(sh, nome); }
  return sh;
}
function cabecalho_(sh, nome) {
  const cab = CAB[nome];
  sh.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold').setBackground('#041339').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  if (nome !== ABA.registro) sh.getRange(2, 1, sh.getMaxRows() - 1, cab.length).setNumberFormat('@'); // texto puro (senhas, horários, códigos)
}
function valores_(nome) {
  const sh = aba_(nome), n = sh.getLastRow(), nc = CAB[nome].length;
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, nc).getValues().filter(r => txt_(r[0]) !== '');
}
function gravar_(nome, linhas) {
  const sh = aba_(nome), nc = CAB[nome].length, n = sh.getLastRow();
  if (n > 1) sh.getRange(2, 1, n - 1, nc).clearContent();
  garantirLinhas_(sh, nome, linhas.length + 1);
  if (linhas.length) sh.getRange(2, 1, linhas.length, nc).setValues(linhas.map(r => { const x = r.slice(0, nc); while (x.length < nc) x.push(''); return x.map(v => v === undefined || v === null ? '' : v); }));
}
function acrescentar_(nome, linhas) {   // escreve no fim da aba
  const sh = aba_(nome), nc = CAB[nome].length, ini = sh.getLastRow() + 1;
  garantirLinhas_(sh, nome, ini + linhas.length - 1);
  sh.getRange(ini, 1, linhas.length, nc).setValues(linhas);
}
function garantirLinhas_(sh, nome, n) {   // a aba precisa ter linhas suficientes (getRange fora da aba dá erro)
  const m = sh.getMaxRows();
  if (n <= m) return;
  sh.insertRowsAfter(m, n - m);
  if (nome !== ABA.registro) sh.getRange(m + 1, 1, n - m, CAB[nome].length).setNumberFormat('@');
}
function trocarValor_(nome, col, de, para) {
  gravar_(nome, valores_(nome).map(r => { if (txt_(r[col]) === de) r[col] = para; return r; }));
}
function registrar_(usuario, acao) { aba_(ABA.registro).appendRow([new Date(), usuario, acao]); }

function txt_(v) { return String(v === null || v === undefined ? '' : v).trim(); }
function num_(v) { return v === '' || v === null ? 0 : Number(v) || 0; }
function sim_(v) { return v === true || /^(sim|s|true|1|x)$/i.test(txt_(v)); }
function minutos_(h) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(h || '').trim()); return m ? +m[1] * 60 + +m[2] : NaN; }
function hhmm_(m) { return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + m % 60).slice(-2); }
function normHora_(v) { const m = minutos_(v); return isNaN(m) ? '' : hhmm_(m); }
function hora_(v) { return v instanceof Date ? Utilities.formatDate(v, tz_(), 'HH:mm') : (normHora_(txt_(v)) || txt_(v)); }
function linkBase_() { return CONFIG.URL_PUBLICA || ScriptApp.getService().getUrl(); }

// ---------------- Migração (colunas antigas -> atuais) ----------------
function garantirEsquema_() {
  const pr = PropertiesService.getScriptProperties();
  if (pr.getProperty('ESQUEMA') === ESQUEMA) return;
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    if (pr.getProperty('ESQUEMA') !== ESQUEMA) { migrar_(); pr.setProperty('ESQUEMA', ESQUEMA); }
  } finally { lock.releaseLock(); }
}

// v3 -> v4: turnos viram grades de horário; turmas ganham segmento/série; disponibilidade por aula vira faixa de 1h;
// professores ganham "Nome completo"; abas novas Matriz, Componentes e Blocos.
function migrar_() {
  const ss = planilha_();
  const cab = nome => { const sh = ss.getSheetByName(nome); return sh && sh.getLastRow() >= 1 ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(txt_) : null; };
  const brutas = nome => {
    const sh = ss.getSheetByName(nome), n = sh.getLastRow(), nc = sh.getLastColumn();
    return n < 2 ? [] : sh.getRange(2, 1, n - 1, nc).getValues().filter(r => txt_(r[0]));
  };
  const regravar = (nome, linhas) => { const sh = ss.getSheetByName(nome); sh.clearContents(); cabecalho_(sh, nome); gravar_(nome, linhas); };

  let turnos = {};
  const hc = cab(ABA.config);
  if (hc && hc[0] === 'Turno') {
    const linhas = [];
    brutas(ABA.config).forEach(r => {
      const t = { nome: txt_(r[0]), aulas: num_(r[1]), inicio: hora_(r[2]), duracao: num_(r[3]) || 50, intervaloApos: num_(r[4]), intervaloMin: num_(r[5]) };
      const ini0 = minutos_(t.inicio) || 420; t.horarios = [];
      for (let a = 0; a < t.aulas; a++) {
        const ini = ini0 + a * t.duracao + (t.intervaloApos && a >= t.intervaloApos ? t.intervaloMin : 0);
        if (t.intervaloApos && a === t.intervaloApos && t.intervaloMin) linhas.push([t.nome, 'Intervalo', hhmm_(ini - t.intervaloMin), hhmm_(ini)]);
        linhas.push([t.nome, 'Aula', hhmm_(ini), hhmm_(ini + t.duracao)]);
        t.horarios.push([ini, ini + t.duracao]);
      }
      turnos[t.nome] = t;
    });
    regravar(ABA.config, linhas);
  }
  const hp = cab(ABA.prof), semSegmentos = !!hp && hp.indexOf('Segmentos') < 0, semHistorico = !ss.getSheetByName(ABA.hist);
  if (hp && hp[1] === 'Disciplinas') {
    regravar(ABA.prof, brutas(ABA.prof).map(r => [r[0], '', r[1], r[2], r[3], converterIndisp_(txt_(r[4]), turnos), r[5], r[6]]));
  }
  const ht = cab(ABA.turmas);
  if (ht && ht[1] === 'Turno') {
    regravar(ABA.turmas, brutas(ABA.turmas).map(r => { const p = deduzirSerie_(txt_(r[0])); return [r[0], p.segmento, p.serie, r[1]]; }));
  }
  Object.keys(CAB).forEach(nome => cabecalho_(aba_(nome), nome));
  if (!valores_(ABA.comp).length) gravar_(ABA.comp, COMPONENTES_PADRAO.map(c => c.slice()));
  if (!valores_(ABA.matriz).length) gravar_(ABA.matriz, matrizPadrao_());
  if (semSegmentos) completarProfessores_();
  if (semHistorico && valores_(ABA.grade).length) guardarVersao_(null, 'Grade oficial que já estava salva', '');   // v6: histórico de versões
}

// v5: professor ganha "Segmentos" e as matérias passam a ser componentes da Matriz (escolhidos por clique).
// Completa com o que ele já dá na carga e troca apelidos/siglas pelo nome do componente.
function completarProfessores_() {
  const comps = lerComponentes_(), seg = {}, usos = {};
  lerTurmas_().forEach(t => seg[t.nome] = t.segmento);
  lerCarga_().forEach(c => {
    const x = usos[c.professor] = usos[c.professor] || { m: [], s: [] };
    x.m.push(c.disciplina); c.turmas.forEach(t => { if (seg[t]) x.s.push(seg[t]); });
  });
  gravar_(ABA.prof, valores_(ABA.prof).map(r => {
    const x = usos[txt_(r[0])] || { m: [], s: [] };
    const mats = [...new Set(lista_(r[2]).map(m => acharComponente_(m, comps) || m).concat(x.m))];
    const segs = lista_(r[8]).length ? lista_(r[8]) : Object.keys(SERIES).filter(k => x.s.indexOf(k) >= 0);
    r[2] = mats.join(', '); r[8] = segs.join(', ');
    return r;
  }));
}

// "Seg Manhã 1" (aula do turno antigo) -> "Seg 7h" (faixa de 1h com maior sobreposição)
function converterIndisp_(v, turnos) {
  const novas = [];
  String(v || '').split(';').map(x => x.trim()).filter(String).forEach(x => {
    if (/^\S+\s+\d{1,2}h$/.test(x)) return novas.push(lerIndisp_(x)[0]);
    const p = x.split(/\s+/), t = turnos[p.slice(1, -1).join(' ')], a = +p[p.length - 1] - 1;
    if (!t || !t.horarios[a]) return;
    const [ini, fim] = t.horarios[a]; let melhor = -1, mh = 0;
    [].concat(FAIXAS['Manhã'], FAIXAS['Tarde']).forEach(h => { const s = Math.min(fim, h * 60 + 60) - Math.max(ini, h * 60); if (s > melhor) { melhor = s; mh = h; } });
    if (melhor > 0) novas.push(p[0] + '|' + mh);
  });
  return gravarIndisp_([...new Set(novas)]);
}

function deduzirSerie_(nome) {
  const n = String(nome).toUpperCase(), m = /^(\d)/.exec(n);
  if (/EXTRA|\//.test(n) || n === 'EM') return { segmento: 'Extra', serie: '' };
  if (m && /\bEM\b/.test(n) && +m[1] <= 3) return { segmento: 'EM', serie: m[1] + 'ª série' };
  if (m && +m[1] >= 1 && +m[1] <= 5) return { segmento: 'EFAI', serie: m[1] + 'º ano' };
  if (m && +m[1] >= 6) return { segmento: 'EFAF', serie: m[1] + 'º ano' };
  return { segmento: '', serie: '' };
}

// ---------------- Estrutura padrão da escola (sem nomes de pessoas) ----------------
const GRADES_PADRAO = [   // "i" = intervalo
  ['EFAI Manhã', '07:00-07:40 07:40-08:20 i08:20-08:50 08:50-09:30 09:30-10:10 i10:10-10:40 10:40-11:20 11:20-12:00'],
  ['EFAI Tarde', '13:00-13:40 13:40-14:20 i14:20-14:50 14:50-15:30 15:30-16:10 i16:10-16:40 16:40-17:20 17:20-18:00'],
  ['EFAF Manhã', '07:10-08:00 08:00-08:50 08:50-09:40 i09:40-10:10 10:10-11:00 11:00-11:50 11:50-12:40'],
  ['EFAF/EM Tarde', '13:10-14:00 14:00-14:50 14:50-15:40 i15:40-16:10 16:10-17:00 17:00-17:50 17:50-18:40'],
  ['EM Manhã', '07:10-08:00 08:00-08:50 i08:50-09:10 09:10-10:00 10:00-10:50 i10:50-11:10 11:10-12:00 12:00-12:50'],
  ['Contraturno', '13:00-14:00 14:00-15:00 15:00-16:00 16:00-17:00'],
  ['Contraturno manhã', '11:00-12:00'],
];
function gradesPadrao_() {
  const linhas = [];
  GRADES_PADRAO.forEach(([nome, s]) => s.split(' ').forEach(x => { const iv = x[0] === 'i', p = x.replace('i', '').split('-'); linhas.push([nome, iv ? 'Intervalo' : 'Aula', p[0], p[1]]); }));
  return linhas;
}
const COMPONENTES_PADRAO = [   // [componente, sigla, apelidos do aSc]
  ['Língua Portuguesa', 'Port', 'Líng. Port.'], ['Língua Inglesa', 'Ingl', 'Ling. Ingl.'], ['Língua Espanhola', 'Esp', 'Ling. Esp.'],
  ['Educação Física', 'Ed. Fís.', 'Ed. Física'], ['Arte', 'Arte', ''], ['Matemática', 'Mat', ''], ['Ciências', 'Ciên', 'Cienc.'],
  ['História/Geografia', 'Hist/Geo', 'Geo/His'], ['Informática', 'Info', ''], ['Movimento', 'Mov', ''], ['Projeto de Vida Integrado', 'PVI', 'Proj. V. Int.'],
  ['História', 'Hist', ''], ['Geografia', 'Geo', ''], ['Leitura e Produção de Texto', 'LPT', 'Leit. Prod. Text.'], ['Laboratório de Ciências', 'Lab', ''],
  ['Educação Financeira', 'Ed. Fin.', 'Ed. Financ.'], ['Projeto de Vida', 'PV', 'Proj. Vid.'], ['História das Religiões', 'Hist. Relig.', ''],
  ['Biologia', 'Bio', ''], ['Física', 'Fís', ''], ['Química', 'Quí', ''], ['Filosofia', 'Filo', ''], ['Sociologia', 'Soc', ''], ['Redação', 'Red', ''],
  ['Geografia Avançada', 'Geo Av', ''], ['História Avançada', 'Hist Av', ''], ['Projeto de Vida e Empregabilidade', 'PV Empreg', 'Proj V Empreg'],
  ['Biologia Avançada', 'Bio Av', ''], ['Química Avançada', 'Quí Av', ''], ['Física Avançada', 'Fís Av', ''], ['Matemática Avançada', 'Mat Av', ''],
  // contraturno (grupos EXTRA)
  ['Lição de Casa', 'Lição', 'Licao de Casa'], ['Atividades Lúdicas', 'Ativ. Lúd.', ''], ['Teatro', 'Teatro', ''], ['Arte e Natureza', 'Arte Nat.', ''],
  ['Futsal', 'Futsal', ''], ['Voleibol', 'Vôlei', ''], ['Jogos', 'Jogos', ''], ['Reforço', 'Reforço', ''], ['Recreação', 'Recreação', 'Recreacao'],
  ['Iniciação às Lutas', 'Lutas', 'Inic. às Lutas'], ['Laboratório de Redação', 'Lab Red', 'Lab de Red'], ['Maker', 'Maker', ''],
  ['Olimpíada de Matemática', 'Olimp. Mat', ''], ['Olimpíada de Física', 'Olimp. Fís', ''],
];
const MATRIZ_PADRAO = {   // Matriz curricular 2025: aulas semanais por série
  EFAI: [['Língua Portuguesa', 7, 8, 8, 8, 8], ['Língua Inglesa', 3, 3, 3, 3, 3], ['Educação Física', 2, 2, 2, 2, 2], ['Arte', 2, 2, 2, 2, 2],
    ['Matemática', 8, 8, 8, 8, 8], ['Ciências', 2, 2, 2, 2, 2], ['História/Geografia', 2, 2, 2, 2, 2], ['Língua Espanhola', 1, 1, 1, 1, 1],
    ['Informática', 1, 1, 1, 1, 1], ['Movimento', 1, 0, 0, 0, 0], ['Projeto de Vida Integrado', 1, 1, 1, 1, 1]],
  EFAF: [['Língua Portuguesa', 4, 4, 4, 4], ['Língua Inglesa', 2, 2, 2, 2], ['Educação Física', 2, 2, 1, 1], ['Arte', 1, 1, 1, 1], ['Matemática', 5, 5, 5, 5],
    ['Ciências', 4, 4, 4, 4], ['História', 4, 4, 3, 3], ['Geografia', 3, 3, 4, 3], ['Língua Espanhola', 1, 1, 1, 1], ['Leitura e Produção de Texto', 2, 2, 2, 2],
    ['Laboratório de Ciências', 0, 0, 1, 1], ['Educação Financeira', 1, 1, 1, 1], ['Projeto de Vida', 1, 1, 1, 1], ['História das Religiões', 0, 0, 0, 1]],
  EM: [['Língua Portuguesa', 4, 4, 3], ['Língua Inglesa', 2, 2, 1], ['Educação Física', 1, 1, 1], ['Arte', 2, 0, 0], ['Projeto de Vida', 1, 1, 0],
    ['Matemática', 3, 3, 4], ['Biologia', 2, 2, 3], ['Física', 3, 2, 3], ['Química', 3, 2, 3], ['História', 2, 3, 2], ['Geografia', 2, 3, 2],
    ['Filosofia', 0, 1, 0], ['Sociologia', 0, 0, 1], ['Redação', 1, 2, 1], ['Geografia Avançada', 1, 0, 1], ['História Avançada', 1, 0, 1],
    ['Projeto de Vida e Empregabilidade', 0, 0, 1], ['Biologia Avançada', 0, 1, 1], ['Química Avançada', 0, 1, 1], ['Física Avançada', 1, 1, 1],
    ['Matemática Avançada', 1, 1, 0]],
};
function matrizPadrao_() {
  const linhas = [];
  Object.keys(MATRIZ_PADRAO).forEach(seg => SERIES[seg].forEach((serie, i) => MATRIZ_PADRAO[seg].forEach(c => { if (c[i + 1] > 0) linhas.push([serie, c[0], c[i + 1]]); })));
  return linhas;
}

// ---------------- Menu da planilha (só para você) ----------------
function onOpen() {
  SpreadsheetApp.getUi().createMenu('⚙️ Grade Horária')
    .addItem('1. Preparar planilha', 'prepararPlanilha')
    .addItem('Criar dados de exemplo', 'criarExemplo')
    .addItem('Limpar dados da escola', 'limparDados')
    .addToUi();
}

function prepararPlanilha() {
  const ss = SpreadsheetApp.getActive();
  PropertiesService.getScriptProperties().setProperty('PLANILHA_ID', ss.getId());
  const msg = prepararAbas_();
  const pad = ss.getSheetByName('Página1') || ss.getSheetByName('Sheet1');
  if (pad && ss.getSheets().length > 1 && pad.getLastRow() === 0) ss.deleteSheet(pad);
  SpreadsheetApp.getUi().alert(msg);
}
function prepararAbas_() {
  migrar_();
  PropertiesService.getScriptProperties().setProperty('ESQUEMA', ESQUEMA);
  if (!valores_(ABA.config).length) gravar_(ABA.config, gradesPadrao_());
  let msg = 'Planilha pronta.';
  if (!valores_(ABA.usuarios).length) {
    const senha = Utilities.getUuid().slice(0, 8);
    gravar_(ABA.usuarios, [['admin', senha, 'Administrador', 'admin', 'Sim', '']]);
    msg += '\n\nUsuário: admin\nSenha: ' + senha + '\n\n(fica na aba Usuários)';
  }
  return msg;
}

function criarExemplo() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Dados de exemplo', 'Apaga grades, professores, turmas, matriz, carga, fixas, blocos e grade e coloca uma escola fictícia com a estrutura do Objetivo CSA. Usuários são mantidos. Continuar?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  PropertiesService.getScriptProperties().setProperty('PLANILHA_ID', SpreadsheetApp.getActive().getId());
  gravarExemplo_();
  SpreadsheetApp.getActive().toast('Exemplo criado.');
}
function gravarExemplo_() {
  prepararAbas_();
  const x = dadosExemplo_();
  gravar_(ABA.config, x.config); gravar_(ABA.comp, x.componentes); gravar_(ABA.matriz, x.matriz);
  gravar_(ABA.turmas, x.turmas); gravar_(ABA.prof, x.professores); gravar_(ABA.carga, x.carga);
  gravar_(ABA.fixas, x.fixas); gravar_(ABA.blocos, x.blocos); gravar_(ABA.grade, []); gravar_(ABA.hist, []);
  registrar_('planilha', 'Criou dados de exemplo');
}

function limparDados() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Limpar dados', 'Apaga professores, turmas, atribuições, aulas fixas, horários reservados, grade e histórico (mantém grades de horário, matriz e usuários). Continuar?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  [ABA.prof, ABA.turmas, ABA.carga, ABA.fixas, ABA.blocos, ABA.grade, ABA.hist].forEach(a => gravar_(a, []));
  registrar_('planilha', 'Limpou os dados da escola');
}

// Escola fictícia com a estrutura real: 7 grades, 31 turmas regulares + 11 grupos EXTRA, matriz 2025, turmas juntas,
// atividades de contraturno, complementação e plantões. Todos os nomes de pessoas são inventados.
function dadosExemplo_() {
  const turmas = [];
  const T = (grade, seg, lista) => lista.forEach(([nome, serie]) => turmas.push([nome, seg, serie || '', grade]));
  T('EFAI Manhã', 'EFAI', [['1A', '1º ano'], ['2A', '2º ano'], ['3A', '3º ano'], ['4A', '4º ano'], ['5A', '5º ano'], ['5B', '5º ano']]);
  T('EFAI Tarde', 'EFAI', [['1B', '1º ano'], ['2B', '2º ano'], ['3B', '3º ano'], ['4B', '4º ano'], ['5C', '5º ano']]);
  T('EFAF Manhã', 'EFAF', [['6A', '6º ano'], ['6B', '6º ano'], ['7A', '7º ano'], ['7B', '7º ano'], ['8A', '8º ano'], ['8B', '8º ano'], ['9A', '9º ano'], ['9B', '9º ano']]);
  T('EFAF/EM Tarde', 'EFAF', [['6C', '6º ano'], ['7C', '7º ano'], ['8C', '8º ano'], ['9C', '9º ano']]);
  T('EFAF/EM Tarde', 'EM', [['1 EM C', '1ª série']]);
  T('EM Manhã', 'EM', [['1 EM A', '1ª série'], ['1 EM B', '1ª série'], ['2 EM A', '2ª série'], ['2 EM B', '2ª série'], ['2 EM C', '2ª série'], ['3 EM A', '3ª série'], ['3 EM B', '3ª série']]);
  T('Contraturno', 'Extra', [['EXTRA 1º ano A'], ['EXTRA 2º ano A'], ['EXTRA 3º ano A'], ['EXTRA 4º ano A'], ['EXTRA 5º ano A'], ['EXTRA 5º ano B'], ['6º/7º'], ['8º/9º'], ['EM']]);
  T('Contraturno manhã', 'Extra', [['EXTRA EFAI tarde'], ['EXTRA EFAF tarde']]);

  const professores = [   // [nome curto, nome completo, indisponível]
    ['Bianca', 'Bianca Moreira Lins'], ['Cecília', 'Cecília Prado Gomes'], ['Débora', 'Débora Campos Reis'], ['Elaine', 'Elaine Furtado Sá'],
    ['Fernanda', 'Fernanda Rocha Vidal'], ['Gabriela', 'Gabriela Teles Amaral'], ['Carla', 'Carla Nogueira Pires'], ['Denise', 'Denise Lacerda Brito'],
    ['Eduardo', 'Eduardo Siqueira Melo'], ['Fabiano', 'Fabiano Coutinho Dias'], ['Gustavo', 'Gustavo Barreto Leal'], ['Helena', 'Helena Quintana Cruz'],
    ['Igor', 'Igor Valadares Paiva'], ['Joana', 'Joana Ventura Maia', 'Seg 7h; Seg 8h; Seg 9h; Seg 10h; Seg 11h; Seg 12h'], ['Kátia', 'Kátia Aragão Neves'],
    ['Lúcia', 'Lúcia Fontes Rangel'], ['Marcos', 'Marcos Tavares Bento'], ['Nádia', 'Nádia Correia Leme'], ['Otávio', 'Otávio Peixoto Sales'],
    ['Paula', 'Paula Godinho Viana'], ['Rafael', 'Rafael Ximenes Couto'], ['Sandra', 'Sandra Moura Falcão'], ['Tânia', 'Tânia Bastos Queiroz'],
    ['Ulisses', 'Ulisses Ferraz Lobo'], ['Vera', 'Vera Antunes Rios', 'Sex 7h; Sex 8h'], ['Wagner', 'Wagner Pacheco Dutra'], ['Yara', 'Yara Mendonça Sodré'],
    ['Roberto', 'Roberto Cardoso Viegas', 'Ter 13h; Ter 14h; Ter 15h; Ter 16h; Ter 17h; Ter 18h'], ['Sílvia', 'Sílvia Brandão Lima'],
    ['Alice', 'Alice Monteiro Saraiva'], ['Breno', 'Breno Albuquerque Rosa'], ['Caio', 'Caio Machado Torres'],
    ['Diana', 'Diana Figueira Lopes', 'Qua 7h; Qua 8h; Qua 9h; Qua 10h; Qua 11h; Qua 12h; Qui 7h; Qui 8h; Qui 9h; Qui 10h; Qui 11h; Qui 12h'],
    ['Elias', 'Elias Bittencourt Faria'], ['Flávia', 'Flávia Rezende Prates'], ['Gilberto', 'Gilberto Sampaio Matos', 'Sex 13h; Sex 14h; Sex 15h; Sex 16h; Sex 17h; Sex 18h'],
    ['Heitor', 'Heitor Damasceno Luz'], ['Isabela', 'Isabela Guimarães Cunha'], ['Jussara', 'Jussara Medeiros Rolim'], ['Natália', 'Natália Esteves Pinho'],
    ['Mônica', 'Mônica Arruda Vilela'],
  ].map((p, i) => [p[0], p[1], '', '', '', p[2] || '', i % 4 === 3 ? '' : '03/02/2026 ' + (8 + i % 9) + ':' + String(10 + i).slice(-2), '', '']);   // 3 em cada 4 já responderam o formulário

  // Quem dá cada componente em cada turma regular
  const POLI = { '1A': 'Bianca', '1B': 'Bianca', '2A': 'Cecília', '2B': 'Cecília', '3A': 'Débora', '3B': 'Débora', '4A': 'Elaine', '4B': 'Elaine', '5A': 'Fernanda', '5C': 'Fernanda', '5B': 'Gabriela' };
  const em = (t, m67, m89, tarde) => /^[67][AB]$/.test(t) ? m67 : /^[89][AB]$/.test(t) ? m89 : tarde;
  const quem = (t, seg, serie, comp) => {
    if (seg === 'EFAI') return ({ 'Língua Inglesa': ['1A', '2A', '3A', '4A', '5A', '5B'].indexOf(t) >= 0 ? 'Carla' : 'Denise', 'Educação Física': 'Fabiano', 'Movimento': 'Fabiano',
      'Arte': 'Helena', 'Língua Espanhola': 'Joana', 'Informática': 'Kátia' })[comp] || POLI[t];
    if (seg === 'EFAF') return ({
      'Língua Portuguesa': em(t, 'Lúcia', 'Marcos', 'Nádia'), 'Leitura e Produção de Texto': em(t, 'Lúcia', 'Marcos', 'Nádia'),
      'Língua Inglesa': em(t, 'Denise', 'Denise', 'Carla'), 'Educação Física': 'Gustavo', 'Arte': 'Igor', 'Língua Espanhola': 'Joana', 'Projeto de Vida': 'Sílvia',
      'Matemática': em(t, 'Otávio', 'Paula', 'Rafael'), 'Educação Financeira': em(t, 'Otávio', 'Paula', 'Rafael'),
      'Ciências': em(t, 'Sandra', 'Tânia', 'Ulisses'), 'Laboratório de Ciências': em(t, 'Sandra', 'Tânia', 'Ulisses'),
      'História': em(t, 'Vera', 'Wagner', /^[67]C$/.test(t) ? 'Wagner' : 'Vera'), 'História das Religiões': 'Wagner',
      'Geografia': em(t, 'Yara', /^8/.test(t) ? 'Yara' : 'Roberto', 'Roberto') })[comp];
    const s = serie[0];
    return ({ 'Língua Portuguesa': s === '2' ? 'Breno' : 'Alice', 'Redação': s === '2' ? 'Breno' : 'Alice', 'Língua Inglesa': 'Eduardo', 'Educação Física': 'Gustavo',
      'Arte': 'Igor', 'Projeto de Vida': 'Sílvia', 'Projeto de Vida e Empregabilidade': 'Sílvia', 'Matemática': s === '2' ? 'Diana' : 'Caio',
      'Matemática Avançada': s === '2' ? 'Diana' : 'Caio', 'Biologia': 'Elias', 'Biologia Avançada': 'Elias', 'Física': s === '2' ? 'Ulisses' : 'Flávia',
      'Física Avançada': 'Flávia', 'Química': 'Gilberto', 'Química Avançada': 'Gilberto', 'História': 'Heitor', 'História Avançada': 'Heitor',
      'Geografia': 'Isabela', 'Geografia Avançada': 'Isabela', 'Filosofia': 'Roberto', 'Sociologia': 'Roberto' })[comp];
  };
  const matriz = matrizPadrao_(), carga = [];
  const linha = (ts, comp, prof, n, duplas) => carga.push([ts, comp, prof, n, duplas || 0, maxDiaPadrao_(n)]);
  turmas.filter(t => t[1] !== 'Extra').forEach(([t, seg, serie]) => matriz.filter(m => m[0] === serie).forEach(([, comp, n]) => {
    if (comp === 'Educação Física' && (t === '5A' || t === '5B')) return;   // turma junta (abaixo)
    linha(t, comp, quem(t, seg, serie, comp), n, (seg === 'EFAI' && comp === 'Arte') || (serie === '2ª série' && comp === 'Redação') ? 1 : 0);
  }));
  linha('5A + 5B', 'Educação Física', 'Fabiano', 2);
  // Contraturno (grupos EXTRA)
  ['EXTRA 1º ano A', 'EXTRA 2º ano A', 'EXTRA 3º ano A', 'EXTRA 4º ano A', 'EXTRA 5º ano A', 'EXTRA 5º ano B'].forEach((t, i) => {
    const mon = i < 3 ? 'Jussara' : 'Natália';
    linha(t, 'Lição de Casa', mon, 4); linha(t, 'Atividades Lúdicas', mon, 2); linha(t, 'Teatro', 'Igor', 1); linha(t, 'Jogos', 'Mônica', 1);
    if (i < 3) linha(t, 'Arte e Natureza', 'Helena', 1);
  });
  linha('6º/7º + 8º/9º', 'Teatro', 'Igor', 2);
  linha('6º/7º', 'Futsal', 'Mônica', 2);
  linha('8º/9º + EM', 'Voleibol', 'Mônica', 2);
  linha('EM', 'Olimpíada de Matemática', 'Caio', 1);
  linha('EXTRA EFAI tarde', 'Informática', 'Kátia', 2); linha('EXTRA EFAI tarde', 'Iniciação às Lutas', 'Mônica', 1);
  linha('EXTRA EFAF tarde', 'Maker', 'Kátia', 1); linha('EXTRA EFAF tarde', 'Reforço', 'Nádia', 2);

  const seg = {}, usos = {};   // matérias e segmentos de cada professor, coerentes com o que ele dá
  turmas.forEach(t => seg[t[0]] = t[1]);
  carga.forEach(c => { const x = usos[c[2]] = usos[c[2]] || { m: [], s: [] }; if (x.m.indexOf(c[1]) < 0) x.m.push(c[1]); c[0].split(' + ').forEach(t => { if (x.s.indexOf(seg[t]) < 0) x.s.push(seg[t]); }); });
  professores.forEach(p => { const x = usos[p[0]] || { m: [], s: [] }; p[2] = x.m.join(', '); p[8] = Object.keys(SERIES).filter(k => x.s.indexOf(k) >= 0).join(', '); });
  const blocos = [
    ['Helena', 'Complementação de Carga Horária', '', 'Sex', '07:00', '08:20'],
    ['Eduardo', 'Complementação de Carga Horária', '', 'Seg', '13:10', '14:50'],
    ['Wagner', 'Complementação de Carga Horária', '', 'Qua', '11:50', '12:40'],
    ['Caio', 'Plantão de Dúvidas', 'Matemática', 'Ter', '14:00', '15:00'],
    ['Flávia', 'Plantão de Dúvidas', 'Física', 'Qui', '14:00', '15:00'],
    ['Isabela', 'Plantão de Dúvidas', 'Geografia', 'Seg', '14:00', '15:00'],
  ];
  return { config: gradesPadrao_(), componentes: COMPONENTES_PADRAO.map(c => c.slice()), matriz, turmas, professores, carga,
    fixas: [['3 EM A', 'Sex', 1, 'Matemática']], blocos };
}
