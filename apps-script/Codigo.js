// ================= GRADE HORÁRIA · OBJETIVO CSA — servidor (Apps Script) =================
// ENDEREÇO DO SITE: o único lugar para trocar quando houver domínio próprio (ex.: 'https://horarios.objetivocsa.com.br/').
// Dali vêm os arquivos (logo.png, logo-branco.png, icone.png da pasta docs/) e o link do sistema.
const SITE = 'https://objetivocsa.github.io/';
const CONFIG = {
  ESCOLA: 'Objetivo CSA',
  ASSETS: SITE,
  URL_PUBLICA: SITE,
  CREDITO: 'ALBIX',
  SESSAO_HORAS: 6,
};
const ESQUEMA = '9';   // versão das colunas da planilha; mudou → migrar_() roda sozinho uma vez
const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'];
// Séries de cada segmento. No Extra, a "série" é o tipo do Extra (também é o nome do horário das aulas e da matriz).
const SERIES = {
  EFAI: ['1º ano', '2º ano', '3º ano', '4º ano', '5º ano'],
  EFAF: ['6º ano', '7º ano', '8º ano', '9º ano'],
  EM: ['1ª série', '2ª série', '3ª série'],
  Extra: ['Extra 1º ao 5º', 'Extra 6º ao EM'],
};
// Extra (proposta 2027): cada turma regular da MANHÃ tem o seu Extra à tarde, ligado a ela.
const TIPO_EXTRA = { EFAI: 'Extra 1º ao 5º', EFAF: 'Extra 6º ao EM', EM: 'Extra 6º ao EM' };
const MEIO_DIA = 13 * 60;   // aula que começa antes das 13h é da manhã
// Períodos do dia (quadro de disponibilidade), em ordem
const PERIODOS = [{ periodo: 'Manhã', ini: 7 * 60, fim: MEIO_DIA }, { periodo: 'Tarde', ini: MEIO_DIA, fim: 19 * 60 }];
const TIPOS_BLOCO = ['Complementação de Carga Horária', 'Plantão de Dúvidas'];
const ABA = { config: 'Config', prof: 'Professores', turmas: 'Turmas', carga: 'Carga', fixas: 'Fixas', grade: 'Grade',
  matriz: 'Matriz', comp: 'Componentes', blocos: 'Blocos', usuarios: 'Usuários', registro: 'Registro', hist: 'Histórico da grade' };
const CAB = {
  'Config': ['Grade de horário', 'Tipo (Aula/Intervalo)', 'Início', 'Fim'],
  'Professores': ['Professor (nome curto)', 'Nome completo', 'Matérias', 'WhatsApp', 'Máx. aulas por dia', 'Não pode (dia início-fim)', 'Disponibilidade conferida em', 'Observação', 'Segmentos'],
  'Turmas': ['Turma', 'Segmento (EFAI/EFAF/EM/Extra)', 'Série (Extra: tipo)', 'Grade de horário', 'Extra de (turma da manhã)', 'Sem Extra (Sim)'],
  'Carga': ['Turma(s)', 'Disciplina', 'Professor', 'Aulas/semana', 'Aulas duplas', 'Máx. por dia', 'Sempre na aula nº'],
  'Fixas': ['Turma', 'Dia', 'Aula nº', 'Disciplina'],
  'Grade': ['Turma', 'Dia', 'Aula nº', 'Horário', 'Disciplina', 'Professor'],
  'Matriz': ['Série', 'Componente', 'Aulas/semana', 'Sempre na aula nº'],
  'Componentes': ['Componente', 'Sigla', 'Apelidos (aSc), separados por ;'],
  'Blocos': ['Professor', 'Tipo', 'Disciplina', 'Dia', 'Início', 'Fim'],
  'Usuários': ['Usuário', 'Senha', 'Nome', 'Perfil (admin / coordenacao / consulta)', 'Ativo (Sim/Não)', 'Último acesso'],
  'Registro': ['Data', 'Usuário', 'Ação'],
  'Histórico da grade': ['Versão', 'Data', 'Usuário', 'O que mudou', 'Válida a partir de', 'Parte', 'Dados (não editar)'],
};
const MAX_VERSOES = 80, PARTE_MAX = 40000;   // versões guardadas no histórico; tamanho de cada pedaço (limite da célula: 50 mil)
const PERFIS = ['admin', 'coordenacao', 'consulta'];

// ---------------- Páginas ----------------
function doGet() {   // sempre o sistema (o antigo ?form=1, do formulário dos professores, também abre o login)
  const t = HtmlService.createTemplateFromFile('App');
  t.cfg = cfg_();
  return t.evaluate()
    .setTitle('Grade Horária · ' + CONFIG.ESCOLA)
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
  extraTurma:       { p: EDITA, f: extraTurma_ },
  juntarExtra:      { p: EDITA, f: juntarExtra_ },
  separarExtra:     { p: EDITA, f: separarExtra_ },
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
    dias: DIAS, escola: CONFIG.ESCOLA, usuario: s, linkBase: linkBase_(),
    series: SERIES, periodos: PERIODOS, tipoExtra: TIPO_EXTRA, tiposBloco: TIPOS_BLOCO,
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
  return 'Alterou os horários das aulas' + resumoExtras_(sincronizarExtras_());   // turma que mudou de manhã para tarde (ou o contrário) acerta o Extra
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
// A disponibilidade é marcada só pela coordenação, aqui; "conferida" = a coordenação terminou de marcar a deste professor.
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
  const conferida = d.conferida ? (i >= 0 && txt_(v[i][6])) || agora_() : '';
  const linha = [nome, String(d.completo || '').trim(), [...new Set(materias.map(m => String(m).trim()).filter(String))].join(', '), String(d.tel || '').trim(), +d.maxDia || '',
    gravarIndisp_(filtrarIndisp_(d.indisp)), conferida, i >= 0 ? txt_(v[i][7]) : '', Object.keys(SERIES).filter(x => segmentos.indexOf(x) >= 0).join(', ')];
  if (i >= 0) v[i] = linha; else v.push(linha);
  gravar_(ABA.prof, v);
  gravar_(ABA.blocos, valores_(ABA.blocos).filter(r => txt_(r[0]) !== (antigo || nome)).concat(blocos));
  if (i >= 0 && antigo !== nome) { trocarValor_(ABA.carga, 2, antigo, nome); trocarValor_(ABA.grade, 5, antigo, nome); }
  if (d.carga) gravarCarga_(d.carga);
  return (i >= 0 ? 'Editou professor ' : 'Cadastrou professor ') + nome + (d.carga ? ' (com turmas e matérias)' : '');
}

function excluirProfessor_(d) {
  const usos = lerCarga_().filter(c => c.professor === d.nome).map(c => c.turmas.join(' + ') + ' (' + c.disciplina + ')');
  if (usos.length) throw new Error('Este professor ainda tem aulas em: ' + usos.join(', ') + '. Tire as turmas antes (no cadastro do professor, em “Turmas e matérias”) ou use “Trocar professor” na grade.');
  gravar_(ABA.prof, valores_(ABA.prof).filter(r => txt_(r[0]) !== d.nome));
  gravar_(ABA.blocos, valores_(ABA.blocos).filter(r => txt_(r[0]) !== d.nome));
  return 'Excluiu professor ' + d.nome;
}

function salvarTurma_(d) {
  const nome = String(d.nome || '').trim(), antigo = String(d.nomeAntigo || '').trim(), seg = String(d.segmento || ''), serie = String(d.serie || '').trim();
  if (!nome) throw new Error('Informe o nome da turma.');
  if (nome.indexOf('+') >= 0 || nome.indexOf('|') >= 0) throw new Error('O nome da turma não pode ter "+" nem "|".');
  if (!SERIES[seg]) throw new Error('Escolha o segmento.');
  if (SERIES[seg].indexOf(serie) < 0) throw new Error(seg === 'Extra' ? 'Escolha o tipo do Extra.' : 'Escolha a série.');
  if (!lerGrades_().some(g => g.nome === d.grade)) throw new Error('Escolha o horário das aulas da turma.');
  const v = valores_(ABA.turmas), i = antigo ? v.findIndex(r => txt_(r[0]) === antigo) : -1;
  if (v.some((r, j) => j !== i && txt_(r[0]).toLowerCase() === nome.toLowerCase())) throw new Error('Já existe uma turma com esse nome.');
  const linha = [nome, seg, serie, d.grade, seg === 'Extra' && i >= 0 ? txt_(v[i][4]) : '', seg !== 'Extra' && i >= 0 ? txt_(v[i][5]) : ''];
  if (i >= 0) v[i] = linha; else v.push(linha);
  let renExtra = null;
  if (i >= 0 && antigo !== nome) {   // o Extra da turma vai junto: a ligação muda e, se o nome era "Extra <turma>", o Extra é renomeado
    v.forEach(r => { if (txt_(r[1]) === 'Extra') r[4] = listaTurmas_(r[4]).map(t => t === antigo ? nome : t).join(' + '); });
    const ea = 'Extra ' + antigo, en = 'Extra ' + nome, j = v.findIndex(r => txt_(r[0]) === ea && listaTurmas_(r[4]).indexOf(nome) >= 0);
    if (j >= 0 && !v.some(r => txt_(r[0]).toLowerCase() === en.toLowerCase())) { v[j][0] = en; renExtra = [ea, en]; }
  }
  gravar_(ABA.turmas, v);
  if (i >= 0 && antigo !== nome) renomearTurma_(antigo, nome);
  if (renExtra) renomearTurma_(renExtra[0], renExtra[1]);
  return (i >= 0 ? 'Editou turma ' : 'Criou turma ') + nome + resumoExtras_(sincronizarExtras_());
}

function excluirTurma_(d) {
  removerTurmas_([d.nome]);
  return 'Excluiu turma ' + d.nome + resumoExtras_(sincronizarExtras_());
}
// Troca o nome da turma nas atribuições (turmas juntas também), aulas fixas e grade oficial
function renomearTurma_(antigo, nome) {
  gravar_(ABA.carga, valores_(ABA.carga).map(r => { r[0] = listaTurmas_(r[0]).map(t => t === antigo ? nome : t).join(' + '); return r; }));
  [ABA.fixas, ABA.grade].forEach(a => trocarValor_(a, 0, antigo, nome));
}
// Tira turmas de tudo: cadastro, atribuições (em turmas juntas, só ela sai da linha), aulas fixas e grade oficial
function removerTurmas_(nomes) {
  const fora = t => nomes.indexOf(t) >= 0;
  gravar_(ABA.carga, valores_(ABA.carga).map(r => { r[0] = listaTurmas_(r[0]).filter(t => !fora(t)).join(' + '); return r; }).filter(r => txt_(r[0])));
  [ABA.turmas, ABA.fixas, ABA.grade].forEach(a => gravar_(a, valores_(a).filter(r => !fora(txt_(r[0])))));
}

// ---------------- Extra: um para cada turma regular da manhã ----------------
// Lê as turmas da planilha (nada fixo no código): turma regular cujo horário das aulas começa antes das 13h e que não está
// marcada "sem Extra" tem um Extra ligado a ela ("Extra 1A"), do tipo do segmento (TIPO_EXTRA). Turma nova ganha o Extra
// (com as matérias da matriz do Extra, sem professor); turma apagada, que foi para a tarde ou ficou "sem Extra" leva o Extra junto.
// Extras sem ligação (grupos criados à mão) não são mexidos. Devolve { novas, apagadas } ou null se nada mudou.
function sincronizarExtras_() {
  const grades = lerGrades_(), v = valores_(ABA.turmas), nomes = new Set(v.map(r => txt_(r[0]).toLowerCase()));
  const manha = {}; grades.forEach(g => { const a = aulasGrade_(g)[0]; manha[g.nome] = !!a && a.ini < MEIO_DIA; });
  const origem = {}; v.forEach(r => { if (TIPO_EXTRA[txt_(r[1])] && manha[txt_(r[3])] && !sim_(r[5])) origem[txt_(r[0])] = TIPO_EXTRA[txt_(r[1])]; });
  const apagadas = [], novas = [], cobertas = {};
  let mudou = false;
  v.forEach(r => {
    if (txt_(r[1]) !== 'Extra' || !txt_(r[4])) return;
    const de = listaTurmas_(r[4]), ok = de.filter(t => origem[t]);
    if (ok.length !== de.length) { mudou = true; if (ok.length) r[4] = ok.join(' + '); else apagadas.push(txt_(r[0])); }
    ok.forEach(t => cobertas[t] = 1);
  });
  Object.keys(origem).forEach(t => {
    if (cobertas[t]) return;
    const tipo = origem[t], outro = v.find(r => txt_(r[1]) === 'Extra' && txt_(r[2]) === tipo);
    const grade = grades.some(g => g.nome === tipo) ? tipo : outro ? txt_(outro[3]) : '';   // o horário com o nome do tipo ou o dos outros Extras do tipo
    if (!grade) return;   // sem horário do Extra (a migração cria); não inventa
    let nome = 'Extra ' + t;
    for (let k = 2; nomes.has(nome.toLowerCase()); k++) nome = 'Extra ' + t + ' (' + k + ')';
    nomes.add(nome.toLowerCase());
    v.push([nome, 'Extra', tipo, grade, t, '']); novas.push(nome);
  });
  if (!mudou && !novas.length) return null;
  gravar_(ABA.turmas, v);
  if (apagadas.length) removerTurmas_(apagadas);
  if (novas.length) {   // matérias da matriz do Extra, com professor "a definir"
    const r = calcMatriz_(lerTurmas_().filter(t => novas.indexOf(t.nome) >= 0), valores_(ABA.carga), lerMatriz_(), lerComponentes_(), SERIES.Extra, false);
    gravar_(ABA.carga, r.carga);
  }
  return { novas, apagadas };
}
function resumoExtras_(x) {
  return !x ? '' : (x.novas.length ? ` (criou ${x.novas.join(', ')})` : '') + (x.apagadas.length ? ` (apagou ${x.apagadas.join(', ')})` : '');
}
// "Esta turma não tem Extra" (ou volta a ter)
function extraTurma_(d) {
  const v = valores_(ABA.turmas), i = v.findIndex(r => txt_(r[0]) === d.turma);
  if (i < 0 || !TIPO_EXTRA[txt_(v[i][1])]) throw new Error('Turma não encontrada.');
  v[i][5] = d.tem ? '' : 'Sim';
  gravar_(ABA.turmas, v);
  return (d.tem ? `A turma ${d.turma} voltou a ter Extra` : `A turma ${d.turma} ficou sem Extra`) + resumoExtras_(sincronizarExtras_());
}
// O Extra de uma turma (aceita o nome da turma da manhã ou do próprio Extra)
function extraAlvo_(nome) {
  const ts = lerTurmas_();
  return ts.find(t => t.nome === nome && t.segmento === 'Extra') || ts.find(t => t.segmento === 'Extra' && t.extraDe.indexOf(nome) >= 0) || null;
}
// Junta o Extra de duas turmas num grupo só: cada matéria em comum vira uma linha de turmas juntas (mesmo horário, mesmo professor)
function juntarExtra_(d) {
  const a = extraAlvo_(d.turma), b = extraAlvo_(d.com);
  if (!a || !b) throw new Error('Essa turma não tem Extra.');
  if (a.nome === b.nome) throw new Error('Escolha outra turma.');
  if (a.grade !== b.grade) throw new Error(`${a.nome} e ${b.nome} têm horários diferentes (${a.grade} e ${b.grade}). Só dá para juntar Extras do mesmo tipo.`);
  const rows = valores_(ABA.carga), em = (r, t) => listaTurmas_(r[0]).indexOf(t) >= 0;
  let n = 0;
  rows.forEach(r => {
    if (!txt_(r[0]) || !em(r, a.nome) || em(r, b.nome)) return;
    const o = rows.find(x => x !== r && txt_(x[0]) && em(x, b.nome) && txt_(x[1]) === txt_(r[1]));
    if (!o) return;
    r[0] = [...new Set(listaTurmas_(r[0]).concat(listaTurmas_(o[0])))].join(' + ');
    if (!txt_(r[2])) r[2] = o[2];
    o[0] = ''; n++;
  });
  if (!n) throw new Error(`${a.nome} e ${b.nome} já estão juntos ou não têm matérias em comum.`);
  const final = rows.filter(r => txt_(r[0]));
  conferirDuplicadas_(final); gravar_(ABA.carga, final); limparFixas_(final);
  return `Juntou ${a.nome} com ${b.nome} (${n} matéria(s))`;
}
function separarExtra_(d) {
  const a = extraAlvo_(d.turma);
  if (!a) throw new Error('Essa turma não tem Extra.');
  const rows = valores_(ABA.carga), novas = [];
  rows.forEach(r => {
    const ts = listaTurmas_(r[0]);
    if (ts.indexOf(a.nome) < 0 || ts.length < 2) return;
    r[0] = ts.filter(t => t !== a.nome).join(' + ');
    const x = r.slice(); x[0] = a.nome; novas.push(x);
  });
  if (!novas.length) throw new Error(`${a.nome} não está junto com outro Extra.`);
  gravar_(ABA.carga, rows.concat(novas));
  return `Separou ${a.nome} dos outros Extras`;
}

// Disciplinas de uma turma. Linha com "juntas" vale para várias turmas ao mesmo tempo (ex.: "5A + 5B").
function salvarCarga_(d) {
  const turma = d.turma, turmas = {}, profs = nomesProfessores_();
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
    return [[turma].concat(juntas).join(' + '), disc, prof, +l.aulas, +l.duplas || 0, +l.maxDia || maxDiaPadrao_(+l.aulas), +l.posicao || ''];
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
  const turmas = {}, profs = nomesProfessores_(), nAulas = {};
  lerGrades_().forEach(g => nAulas[g.nome] = aulasGrade_(g).length);
  lerTurmas_().forEach(t => turmas[t.nome] = t);
  const linhas = lista.map(c => {
    const ts = [...new Set(listaTurmas_(c.turmas))], disc = String(c.disciplina || '').trim(), prof = String(c.professor || '').trim(), rot = ts.join(' + ');
    if (!ts.length || !disc) throw new Error('Há uma atribuição sem turma ou sem matéria.');
    ts.forEach(t => { if (!turmas[t]) throw new Error(`${disc}: turma ${t} não encontrada.`); });
    if (new Set(ts.map(t => turmas[t].grade)).size > 1) throw new Error(`${disc} (${rot}): turmas juntas precisam usar o mesmo horário das aulas.`);
    if (prof && profs.indexOf(prof) < 0) throw new Error(`${disc} (${rot}): professor não encontrado.`);
    if (!(+c.aulas > 0)) throw new Error(`${disc} (${rot}): informe as aulas por semana.`);
    if ((+c.duplas || 0) * 2 > +c.aulas) throw new Error(`${disc} (${rot}): aulas duplas demais para ${+c.aulas} aulas.`);
    const pos = +c.posicao || 0;
    if (pos) {   // "sempre na Xª aula do dia": uma por dia, naquela posição
      if (pos > (nAulas[turmas[ts[0]].grade] || 0)) throw new Error(`${disc} (${rot}): o horário das aulas da turma não tem ${pos}ª aula.`);
      if (+c.duplas) throw new Error(`${disc} (${rot}): aula dupla não combina com “sempre na ${pos}ª aula”.`);
      if (+c.aulas > DIAS.length) throw new Error(`${disc} (${rot}): ${+c.aulas} aulas não cabem sempre na ${pos}ª aula (uma por dia).`);
    }
    return [rot, disc, prof, +c.aulas, +c.duplas || 0, +c.maxDia || maxDiaPadrao_(+c.aulas), pos || ''];
  });
  conferirDuplicadas_(linhas);
  gravar_(ABA.carga, linhas);
  limparFixas_(linhas);
  return linhas.length;
}
function normCarga_(c) { return (c || []).map(x => [listaTurmas_(x.turmas).join(' + '), txt_(x.disciplina), txt_(x.professor), +x.aulas || 0, +x.duplas || 0, +x.maxDia || 0, +x.posicao || 0].join('|')).sort(); }

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
  const v = dadosVersao_(n), existe = {};
  lerTurmas_().forEach(t => existe[t.nome] = 1);   // turmas que não existem mais (ex.: grupos do Extra antigo) ficam de fora
  const carga = v.c.map(r => { const x = r.slice(); x[0] = listaTurmas_(x[0]).filter(t => existe[t]).join(' + '); return x; }).filter(r => txt_(r[0])), g = gradeDaVersao_(v);
  Object.keys(g).forEach(k => { if (!existe[k.split('|')[0]]) delete g[k]; });
  gravar_(ABA.carga, carga);
  limparFixas_(carga);
  gravarGrade_(g);
  guardarVersao_(s, `Voltou para a versão de ${info.data.slice(0, 10)} (${info.descricao})`, info.vigencia);
  return `Restaurou a versão ${n} da grade (${info.data})`;
}

// ---------------- Começar ano letivo ----------------
// Guarda a grade atual no histórico; apaga a grade oficial, quem dá cada matéria (as matérias de cada turma ficam, sem professor),
// as aulas fixas e os horários reservados. Professores: mantém (a disponibilidade fica, mas volta a "conferir") ou apaga.
// Mantém horários das aulas, turmas, matriz e usuários. Depois acerta as matérias das turmas pela matriz.
function comecarAno_(d, s) {
  const ano = String(d.ano || '').trim();
  if (!/^20\d\d$/.test(ano)) throw new Error('Informe o ano (ex.: 2027).');
  if (d.professores !== 'manter' && d.professores !== 'apagar') throw new Error('Escolha o que fazer com os professores.');
  if (valores_(ABA.grade).length) guardarVersao_(s, `Grade do fim do ano (antes de começar ${ano})`, '');
  gravar_(ABA.grade, []); gravar_(ABA.fixas, []); gravar_(ABA.blocos, []);
  const carga = valores_(ABA.carga).map(r => { r[2] = ''; return r; });
  const r = calcMatriz_(lerTurmas_(), carga, lerMatriz_(), lerComponentes_(), [].concat(...Object.values(SERIES)), false);
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
  const profs = nomesProfessores_();
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
  const todas = [].concat(...Object.values(SERIES)), vistas = {};
  const matriz = (d.matriz || []).map(m => {
    const comp = renomeia[m.componente] || String(m.componente || '').trim(), n = Math.round(+m.aulas), pos = Math.round(+m.posicao || 0);
    if (todas.indexOf(m.serie) < 0) throw new Error(`Série inválida: ${m.serie}.`);
    if (!nomes[comp.toLowerCase()]) throw new Error(`${comp}: cadastre a matéria (Matriz curricular → Matérias e siglas).`);
    if (!(n >= 1 && n <= 40)) throw new Error(`${comp} (${m.serie}): aulas por semana inválidas.`);
    if (vistas[m.serie + '|' + comp]) throw new Error(`${comp} aparece duas vezes no ${m.serie}.`);
    if (pos < 0 || pos > 12) throw new Error(`${comp} (${m.serie}): “sempre na aula” inválido.`);
    if (pos && n > DIAS.length) throw new Error(`${comp} (${m.serie}): ${n} aulas não cabem sempre na ${pos}ª aula (uma por dia).`);
    vistas[m.serie + '|' + comp] = 1;
    return [m.serie, comp, n, pos || ''];
  });
  Object.keys(renomeia).forEach(de => renomearMateria_(de, renomeia[de]));
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

// Preenche a carga das turmas das séries escolhidas pela matriz (o Extra também: a "série" é o tipo do Extra).
// Mantém professor, duplas e turmas juntas. Linhas novas ficam com professor "a definir". remover = tira da turma o que não está na matriz.
// Leva também o "sempre na Xª aula do dia" da matriz.
function calcMatriz_(turmas, cargaLinhas, matriz, componentes, series, remover) {
  const alvo = {}, posAlvo = {}; matriz.forEach(m => { (alvo[m.serie] = alvo[m.serie] || {})[m.componente] = m.aulas; (posAlvo[m.serie] = posAlvo[m.serie] || {})[m.componente] = m.posicao || 0; });
  const rows = cargaLinhas.map(r => r.slice()), mudancas = [];
  const canon = nome => acharComponente_(nome, componentes) || txt_(nome);
  turmas.filter(t => series.indexOf(t.serie) >= 0 && alvo[t.serie]).forEach(t => {
    const mapa = alvo[t.serie], m = { turma: t.nome, novas: [], mudam: [], saem: [] };
    const minhas = rows.filter(r => listaTurmas_(r[0]).indexOf(t.nome) >= 0);
    Object.keys(mapa).forEach(comp => {
      const n = mapa[comp], pos = posAlvo[t.serie][comp], r = minhas.find(x => canon(x[1]) === comp);
      if (!r) { rows.push([t.nome, comp, '', n, 0, maxDiaPadrao_(n), pos || '']); m.novas.push(`${comp} (${n})`); return; }
      if (num_(r[6]) !== pos) { m.mudam.push(pos ? `${comp}: sempre na ${pos}ª aula` : `${comp}: sem aula fixa do dia`); r[6] = pos || ''; if (pos) r[4] = 0; }
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
// Troca o nome da matéria em tudo: atribuições, aulas fixas, grade oficial, matriz e matérias dos professores
function renomearMateria_(de, para) {
  trocarValor_(ABA.carga, 1, de, para); trocarValor_(ABA.fixas, 3, de, para); trocarValor_(ABA.grade, 4, de, para); trocarValor_(ABA.matriz, 1, de, para);
  gravar_(ABA.prof, valores_(ABA.prof).map(r => { r[2] = lista_(r[2]).map(m => m === de ? para : m).join(', '); return r; }));
}

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

function nomesProfessores_() { return lerProfessores_().map(p => p.nome); }

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
    indisp: lerIndisp_(r[5]), conferida: txt_(r[6]), obs: txt_(r[7]), materias: lista_(r[2]), segmentos: lista_(r[8]).filter(x => SERIES[x]) }));
}
// Turma: no Extra, "extraDe" = turma(s) da manhã a que ele pertence; nas regulares, "semExtra" = marcada "não tem Extra"
function lerTurmas_() {
  return valores_(ABA.turmas).map(r => ({ nome: txt_(r[0]), segmento: txt_(r[1]), serie: txt_(r[2]), grade: txt_(r[3]), extraDe: listaTurmas_(r[4]), semExtra: sim_(r[5]) }));
}
function lerCarga_() {
  return valores_(ABA.carga).map(r => ({ turmas: listaTurmas_(r[0]), disciplina: txt_(r[1]), professor: txt_(r[2]), aulas: num_(r[3]), duplas: num_(r[4]), maxDia: num_(r[5]), posicao: num_(r[6]) }));
}
function lerMatriz_() { return valores_(ABA.matriz).map(r => ({ serie: txt_(r[0]), componente: txt_(r[1]), aulas: num_(r[2]), posicao: num_(r[3]) })).filter(m => m.componente && m.aulas > 0); }
function lerComponentes_() { return valores_(ABA.comp).map(r => ({ nome: txt_(r[0]), sigla: txt_(r[1]), apelidos: txt_(r[2]).split(';').map(a => a.trim()).filter(String) })); }
function lerBlocos_() {
  return valores_(ABA.blocos).map(r => ({ professor: txt_(r[0]), tipo: txt_(r[1]), disciplina: txt_(r[2]), dia: txt_(r[3]), ini: hora_(r[4]), fim: hora_(r[5]) }));
}
function lista_(v) { return String(v || '').split(/[,;]/).map(x => x.trim()).filter(String); }
function listaTurmas_(v) { return (Array.isArray(v) ? v : String(v || '').split('+')).map(t => String(t).trim()).filter(String); }

// Disponibilidade: intervalos em que o professor NÃO pode, por dia, em minutos (de 10 em 10).
// Planilha: "Seg 07:00-08:20; Ter 13:00-19:00"  <->  [{ dia: 'Seg', ini: 420, fim: 500 }, { dia: 'Ter', ini: 780, fim: 1140 }]
// Aula bloqueada = sobreposição estrita (aula que só encosta na ponta do intervalo não é bloqueada).
// Lê também o formato antigo, de faixas de 1h ("Seg 7h" = 7:00–8:00).
function lerIndisp_(v) {
  const l = [];
  String(v || '').split(';').map(x => x.trim()).forEach(x => {
    let m = /^(\S+)\s+(\d{1,2})h$/.exec(x);
    if (m) return l.push({ dia: m[1], ini: +m[2] * 60, fim: +m[2] * 60 + 60 });
    m = /^(\S+)\s+(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/.exec(x);
    if (m) l.push({ dia: m[1], ini: minutos_(m[2]), fim: minutos_(m[3]) });
  });
  return filtrarIndisp_(l);
}
function filtrarIndisp_(lista) {   // só dias e horários válidos, juntando o que se sobrepõe ou encosta; em ordem
  const por = {}, out = [];
  (lista || []).forEach(x => {
    const dia = txt_(x && x.dia), ini = Math.round(+(x && x.ini)), fim = Math.round(+(x && x.fim));
    if (DIAS.indexOf(dia) < 0 || !(ini >= 0 && fim <= 24 * 60 && fim > ini) || ini % 10 || fim % 10) return;
    (por[dia] = por[dia] || []).push([ini, fim]);
  });
  DIAS.forEach(dia => (por[dia] || []).sort((a, b) => a[0] - b[0]).forEach(([ini, fim]) => {
    const u = out[out.length - 1];
    if (u && u.dia === dia && ini <= u.fim) u.fim = Math.max(u.fim, fim); else out.push({ dia, ini, fim });
  }));
  return out;
}
function gravarIndisp_(lista) { return lista.map(x => x.dia + ' ' + hhmm_(x.ini) + '-' + hhmm_(x.fim)).join('; '); }

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

// v3 -> v4: turnos viram grades de horário; turmas ganham segmento/série; professores ganham "Nome completo"; abas Matriz, Componentes e Blocos.
// v9: sem formulário dos professores (sai código, situação e "respondeu"); disponibilidade em intervalos de 10 min;
// "Sempre na aula nº" na Carga e na Matriz; Extra da proposta 2027 (um para cada turma da manhã).
function migrar_() {
  const ss = planilha_();
  const cab = nome => { const sh = ss.getSheetByName(nome); return sh && sh.getLastRow() >= 1 ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(txt_) : null; };
  const brutas = nome => {
    const sh = ss.getSheetByName(nome), n = sh.getLastRow(), nc = sh.getLastColumn();
    return n < 2 ? [] : sh.getRange(2, 1, n - 1, nc).getValues().filter(r => txt_(r[0]));
  };
  const regravar = (nome, linhas) => { const sh = ss.getSheetByName(nome); sh.clearContents(); cabecalho_(sh, nome); gravar_(nome, linhas); };
  backupAntesV9_(ss);   // antes de qualquer mudança

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
  const pr = PropertiesService.getScriptProperties(), jaV9 = pr.getProperty('SEM_FORMULARIO') === '1';   // a versão antiga do site pode ter refeito o cabeçalho velho depois da v9
  if (hp && hp[1] === 'Disciplinas') {   // v3
    regravar(ABA.prof, brutas(ABA.prof).map(r => [r[0], '', r[1], r[2], r[3], converterIndisp_(txt_(r[4]), turnos), '', r[6]]));
  } else if (hp && hp[5] === 'Indisponível (dia faixa)') {   // v4–v8: faixas de 1h viram intervalos; saem código, situação e "respondeu"
    regravar(ABA.prof, brutas(ABA.prof).map(r => [r[0], r[1], r[2], r[3], r[4], gravarIndisp_(lerIndisp_(r[5])), jaV9 ? r[6] : '', r[7], r[8]]));   // depois da v9, a coluna já é "conferida em"
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
  migrarExtra_();
  apagarProfessoresTeste_();   // depois do Extra: as atribuições dos grupos antigos já saíram
  ['PROFS_TESTE', 'SAL_CODIGO'].forEach(k => pr.deleteProperty(k));   // eram do formulário dos professores
  pr.setProperty('SEM_FORMULARIO', '1');
}

// v9: antes de qualquer mudança, uma vez só, copia Professores, Carga e Turmas para abas ocultas na mesma planilha
// (copyTo + hideSheet: não pede novas permissões do Google).
const BACKUP_V9 = 'Backup antes da v8 · ';
function backupAntesV9_(ss) {
  const pr = PropertiesService.getScriptProperties();
  if (pr.getProperty('BACKUP_V9') === '1') return;
  const feitas = [];
  [ABA.prof, ABA.carga, ABA.turmas].forEach(nome => {
    const sh = ss.getSheetByName(nome), alvo = BACKUP_V9 + nome;
    if (!sh || sh.getLastRow() < 2 || ss.getSheetByName(alvo)) return;
    const c = sh.copyTo(ss); c.setName(alvo); c.hideSheet(); feitas.push(alvo);
  });
  pr.setProperty('BACKUP_V9', '1');
  if (feitas.length) registrar_('planilha', 'Cópia de segurança (abas ocultas): ' + feitas.join(', '));
}

// v9: os professores de teste do antigo formulário ("(teste)" no nome) saem, com os horários reservados deles.
// Quem ainda tem alguma atribuição fica (a migração não mexe em atribuições); fica anotado no Registro.
function apagarProfessoresTeste_() {
  const v = valores_(ABA.prof), teste = r => /\(teste\)/i.test(txt_(r[0]) + ' ' + txt_(r[1])), usados = new Set(valores_(ABA.carga).map(r => txt_(r[2])));
  const nomes = v.filter(r => teste(r) && !usados.has(txt_(r[0]))).map(r => txt_(r[0])), ficam = v.filter(r => teste(r) && usados.has(txt_(r[0]))).map(r => txt_(r[0]));
  if (nomes.length) {
    gravar_(ABA.prof, v.filter(r => nomes.indexOf(txt_(r[0])) < 0));
    gravar_(ABA.blocos, valores_(ABA.blocos).filter(r => nomes.indexOf(txt_(r[0])) < 0));
    registrar_('planilha', 'Apagou os professores de teste (' + nomes.join(', ') + ')');
  }
  if (ficam.length) registrar_('planilha', 'Não apagou professores de teste com atribuições (' + ficam.join(', ') + '): tire as turmas e apague pela tela');
}

// v9: Extra da proposta 2027, uma vez só (propriedade EXTRA_2027). Não mexe em nada que já existe de professores,
// turmas regulares, atribuições das turmas regulares, matriz, aulas fixas, grade oficial, usuários nem histórico:
// - apaga as turmas do segmento Extra que já existiam (grupos antigos, vindos do exemplo/aSc) e as linhas de atribuição só delas
//   (linha que mistura grupo antigo com outra turma fica como está e vai para o Registro);
// - apaga os horários "Contraturno…" que nenhuma turma usa mais (se alguma usar, fica);
// - na lista de matérias, Voleibol passa a se chamar Vôlei (o nome antigo fica como apelido; nada mais é renomeado) e entram as que faltam;
// - acrescenta os horários e a matriz do Extra e um Extra para cada turma da manhã (linhas novas, "a definir").
// Tudo o que fez fica no Registro.
function migrarExtra_() {
  const pr = PropertiesService.getScriptProperties();
  if (pr.getProperty('EXTRA_2027') === '1') return;
  const reg = [];
  if (!valores_(ABA.config).length) gravar_(ABA.config, gradesPadrao_());
  const tv = valores_(ABA.turmas), antigos = tv.filter(r => txt_(r[1]) === 'Extra' && !txt_(r[4])).map(r => txt_(r[0]));
  if (antigos.length) {
    const ant = t => antigos.indexOf(t) >= 0, carga = valores_(ABA.carga);
    const so = r => listaTurmas_(r[0]).length && listaTurmas_(r[0]).every(ant), mistas = carga.filter(r => !so(r) && listaTurmas_(r[0]).some(ant));
    gravar_(ABA.carga, carga.filter(r => !so(r)));
    gravar_(ABA.turmas, tv.filter(r => !ant(txt_(r[0]))));
    reg.push(`apagou ${antigos.length} grupo(s) do Extra antigo (${antigos.join(', ')}) e ${carga.length - carga.filter(r => !so(r)).length} atribuição(ões) deles`);
    if (mistas.length) reg.push(`não mexeu em ${mistas.length} atribuição(ões) que juntam grupo antigo com outra turma (${mistas.map(r => txt_(r[0]) + ' · ' + txt_(r[1])).join('; ')})`);
  }
  let cfg = valores_(ABA.config);
  const usadas = new Set(lerTurmas_().map(t => t.grade));
  [...new Set(cfg.map(r => txt_(r[0])).filter(n => /contraturno/i.test(n)))].forEach(n => {
    if (usadas.has(n)) return reg.push(`manteve o horário “${n}” (ainda usado por turmas)`);
    cfg = cfg.filter(r => txt_(r[0]) !== n); reg.push(`apagou o horário “${n}”`);
  });
  GRADES_PADRAO.filter(g => SERIES.Extra.indexOf(g[0]) >= 0 && !cfg.some(r => txt_(r[0]) === g[0])).forEach(g => {
    gradesPadrao_([g]).forEach(l => cfg.push(l)); reg.push(`criou o horário “${g[0]}”`);
  });
  gravar_(ABA.config, cfg);
  const comps = valores_(ABA.comp), vol = comps.find(r => txt_(r[0]) === 'Voleibol');
  if (vol && !comps.some(r => txt_(r[0]) === 'Vôlei')) {   // só na lista de matérias: professores, atribuições e matriz não mudam
    vol[0] = 'Vôlei'; vol[2] = txt_(vol[2]).split(';').map(x => x.trim()).filter(String).concat(['Voleibol']).join('; ');
    reg.push('na lista de matérias, Voleibol passou a se chamar Vôlei (Voleibol fica como outro nome)');
  }
  const faltam = COMPONENTES_EXTRA.filter(n => !comps.some(r => normalizar_(r[0]) === normalizar_(n)));
  gravar_(ABA.comp, comps.concat(COMPONENTES_PADRAO.filter(c => faltam.indexOf(c[0]) >= 0).map(c => c.slice())));
  if (faltam.length) reg.push('criou as matérias ' + faltam.join(', '));
  const mz = valores_(ABA.matriz);
  if (!mz.some(r => SERIES.Extra.indexOf(txt_(r[0])) >= 0)) { gravar_(ABA.matriz, mz.concat(matrizExtra_())); reg.push('acrescentou a matriz do Extra (a das séries não mudou)'); }
  const x = sincronizarExtras_();
  if (x && x.novas.length) reg.push(`criou ${x.novas.length} Extra(s), um para cada turma da manhã: ${x.novas.join(', ')}`);
  if (reg.length) registrar_('planilha', 'Novo Extra (proposta 2027): ' + reg.join('; '));
  pr.setProperty('EXTRA_2027', '1');
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

// v3: "Seg Manhã 1" (aula do turno antigo) -> o horário real daquela aula ("Seg 07:00-07:50")
function converterIndisp_(v, turnos) {
  const novas = [];
  String(v || '').split(';').map(x => x.trim()).filter(String).forEach(x => {
    if (/^\S+\s+\d{1,2}h$/.test(x)) return novas.push(...lerIndisp_(x));
    const p = x.split(/\s+/), t = turnos[p.slice(1, -1).join(' ')], a = +p[p.length - 1] - 1;
    if (t && t.horarios[a]) novas.push({ dia: p[0], ini: t.horarios[a][0], fim: t.horarios[a][1] });
  });
  return gravarIndisp_(filtrarIndisp_(novas));
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
  ['Extra 1º ao 5º', '13:00-14:00 14:00-15:00 15:00-16:00 16:00-17:00'],   // Extra (proposta 2027); horários editáveis na tela
  ['Extra 6º ao EM', '14:00-15:00 15:00-16:00 16:00-17:00'],
];
function gradesPadrao_(lista) {
  const linhas = [];
  (lista || GRADES_PADRAO).forEach(([nome, s]) => s.split(' ').forEach(x => { const iv = x[0] === 'i', p = x.replace('i', '').split('-'); linhas.push([nome, iv ? 'Intervalo' : 'Aula', p[0], p[1]]); }));
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
  // Extra
  ['Lição de Casa', 'Lição', 'Licao de Casa'], ['Recreação', 'Recreação', 'Recreacao'], ['Reforço', 'Reforço', ''], ['Teatro', 'Teatro', ''],
  ['Defesa Pessoal', 'Defesa', 'Def. Pessoal'], ['Vôlei', 'Vôlei', 'Voleibol'], ['Futebol', 'Futebol', ''],
  ['Atividades Lúdicas', 'Ativ. Lúd.', ''], ['Arte e Natureza', 'Arte Nat.', ''], ['Futsal', 'Futsal', ''], ['Jogos', 'Jogos', ''],
  ['Iniciação às Lutas', 'Lutas', 'Inic. às Lutas'], ['Laboratório de Redação', 'Lab Red', 'Lab de Red'], ['Maker', 'Maker', ''],
  ['Olimpíada de Matemática', 'Olimp. Mat', ''], ['Olimpíada de Física', 'Olimp. Fís', ''],
];
const COMPONENTES_EXTRA = ['Lição de Casa', 'Recreação', 'Reforço', 'Teatro', 'Língua Inglesa', 'Língua Espanhola', 'Defesa Pessoal', 'Futebol', 'Vôlei'];
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
const MATRIZ_EXTRA = {   // proposta 2027: [matéria, aulas por semana, sempre na Xª aula do dia (opcional)]
  'Extra 1º ao 5º': [['Lição de Casa', 5, 1], ['Recreação', 5, 3], ['Reforço', 2], ['Língua Inglesa', 2], ['Língua Espanhola', 2], ['Teatro', 2], ['Defesa Pessoal', 2]],
  'Extra 6º ao EM': [['Defesa Pessoal', 5], ['Vôlei', 5], ['Futebol', 5]],
};
function matrizExtra_() {
  const linhas = [];
  Object.keys(MATRIZ_EXTRA).forEach(serie => MATRIZ_EXTRA[serie].forEach(c => linhas.push([serie, c[0], c[1], c[2] || ''])));
  return linhas;
}
function matrizPadrao_() {
  const linhas = [];
  Object.keys(MATRIZ_PADRAO).forEach(seg => SERIES[seg].forEach((serie, i) => MATRIZ_PADRAO[seg].forEach(c => { if (c[i + 1] > 0) linhas.push([serie, c[0], c[i + 1], '']); })));
  return linhas.concat(matrizExtra_());
}

// ---------------- Menu da planilha (só para você) ----------------
function onOpen() {
  SpreadsheetApp.getUi().createMenu('⚙️ Grade Horária')
    .addItem('1. Preparar planilha', 'prepararPlanilha')
    .addItem('Criar dados de exemplo (NÃO usar na planilha real)', 'criarExemplo')
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

// Chamadas pelo menu da planilha. Começam pelo getUi(), que não funciona pelo site: ninguém consegue usá-las de fora.
function criarExemplo() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Dados de exemplo — NÃO use na planilha real', '⚠ ATENÇÃO: só para testes. Se esta for a planilha real da escola, responda NÃO.\n\nApaga horários, professores, turmas, matriz, atribuições, aulas fixas, horários reservados, grade e histórico, e coloca uma escola fictícia. Usuários são mantidos.\n\nContinuar?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
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

// Escola fictícia com a estrutura real: 7 horários de aula, 31 turmas regulares e um Extra para cada uma das 21 turmas da manhã
// (proposta 2027), matriz 2025 e do Extra, turmas juntas, complementação e plantões. Todos os nomes de pessoas são inventados.
function dadosExemplo_() {
  const turmas = [];
  const T = (grade, seg, lista) => lista.forEach(([nome, serie]) => turmas.push([nome, seg, serie || '', grade, '', '']));
  T('EFAI Manhã', 'EFAI', [['1A', '1º ano'], ['2A', '2º ano'], ['3A', '3º ano'], ['4A', '4º ano'], ['5A', '5º ano'], ['5B', '5º ano']]);
  T('EFAI Tarde', 'EFAI', [['1B', '1º ano'], ['2B', '2º ano'], ['3B', '3º ano'], ['4B', '4º ano'], ['5C', '5º ano']]);
  T('EFAF Manhã', 'EFAF', [['6A', '6º ano'], ['6B', '6º ano'], ['7A', '7º ano'], ['7B', '7º ano'], ['8A', '8º ano'], ['8B', '8º ano'], ['9A', '9º ano'], ['9B', '9º ano']]);
  T('EFAF/EM Tarde', 'EFAF', [['6C', '6º ano'], ['7C', '7º ano'], ['8C', '8º ano'], ['9C', '9º ano']]);
  T('EFAF/EM Tarde', 'EM', [['1 EM C', '1ª série']]);
  T('EM Manhã', 'EM', [['1 EM A', '1ª série'], ['1 EM B', '1ª série'], ['2 EM A', '2ª série'], ['2 EM B', '2ª série'], ['2 EM C', '2ª série'], ['3 EM A', '3ª série'], ['3 EM B', '3ª série']]);
  turmas.filter(t => /Manhã/.test(t[3])).forEach(t => turmas.push(['Extra ' + t[0], 'Extra', TIPO_EXTRA[t[1]], TIPO_EXTRA[t[1]], t[0], '']));   // um Extra por turma da manhã

  const professores = [   // [nome curto, nome completo, não pode]
    ['Bianca', 'Bianca Moreira Lins'], ['Cecília', 'Cecília Prado Gomes'], ['Débora', 'Débora Campos Reis'], ['Elaine', 'Elaine Furtado Sá'],
    ['Fernanda', 'Fernanda Rocha Vidal'], ['Gabriela', 'Gabriela Teles Amaral'], ['Carla', 'Carla Nogueira Pires'], ['Denise', 'Denise Lacerda Brito'],
    ['Eduardo', 'Eduardo Siqueira Melo'], ['Fabiano', 'Fabiano Coutinho Dias'], ['Gustavo', 'Gustavo Barreto Leal'], ['Helena', 'Helena Quintana Cruz'],
    ['Igor', 'Igor Valadares Paiva'], ['Joana', 'Joana Ventura Maia', 'Seg 07:00-13:00'], ['Kátia', 'Kátia Aragão Neves'],
    ['Lúcia', 'Lúcia Fontes Rangel'], ['Marcos', 'Marcos Tavares Bento'], ['Nádia', 'Nádia Correia Leme'], ['Otávio', 'Otávio Peixoto Sales'],
    ['Paula', 'Paula Godinho Viana'], ['Rafael', 'Rafael Ximenes Couto'], ['Sandra', 'Sandra Moura Falcão'], ['Tânia', 'Tânia Bastos Queiroz'],
    ['Ulisses', 'Ulisses Ferraz Lobo'], ['Vera', 'Vera Antunes Rios', 'Sex 07:00-09:00'], ['Wagner', 'Wagner Pacheco Dutra'], ['Yara', 'Yara Mendonça Sodré'],
    ['Roberto', 'Roberto Cardoso Viegas', 'Ter 13:00-19:00'], ['Sílvia', 'Sílvia Brandão Lima'],
    ['Alice', 'Alice Monteiro Saraiva'], ['Breno', 'Breno Albuquerque Rosa'], ['Caio', 'Caio Machado Torres'],
    ['Diana', 'Diana Figueira Lopes', 'Qua 07:00-13:00; Qui 07:00-13:00'],
    ['Elias', 'Elias Bittencourt Faria'], ['Flávia', 'Flávia Rezende Prates'], ['Gilberto', 'Gilberto Sampaio Matos', 'Sex 13:00-19:00'],
    ['Heitor', 'Heitor Damasceno Luz'], ['Isabela', 'Isabela Guimarães Cunha'],
    // Extra: monitores do 1º ao 5º (um por turma), professores de idiomas e teatro, e a equipe do 6º ao EM
    ['Jussara', 'Jussara Medeiros Rolim'], ['Natália', 'Natália Esteves Pinho'], ['Mônica', 'Mônica Arruda Vilela'],
    ['Adriana', 'Adriana Couto Ramalho'], ['Beatriz', 'Beatriz Lemos Furtado'], ['Cláudia', 'Cláudia Pires Sobral'],
    ['Giovana', 'Giovana Matos Leite'], ['Hugo', 'Hugo Ventura Cabral'], ['Irene', 'Irene Salgado Prado'], ['Júlio', 'Júlio Andrade Neri'],
    ['Laura', 'Laura Bezerra Campos'], ['Mauro', 'Mauro Teixeira Lago'],
    ['Nelson', 'Nelson Vieira Dantas'], ['Olga', 'Olga Ribeiro Mesquita'], ['Priscila', 'Priscila Nunes Barros', 'Qua 13:00-14:00'],
    ['Quitéria', 'Quitéria Lopes Farias'], ['Renan', 'Renan Moreira Assis'], ['Simone', 'Simone Castro Leal'],
    ['Tiago', 'Tiago Fonseca Brito'], ['Úrsula', 'Úrsula Pacheco Reis'], ['Valter', 'Valter Gomes Aguiar'],
  ].map((p, i) => [p[0], p[1], '', '', '', p[2] || '', i % 4 === 3 ? '' : '03/02/2026 ' + (8 + i % 9) + ':' + String(10 + i % 50).slice(-2), '', '']);   // 3 em cada 4 com a disponibilidade conferida

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
  const linha = (ts, comp, prof, n, duplas, pos) => carga.push([ts, comp, prof, n, duplas || 0, maxDiaPadrao_(n), pos || '']);
  turmas.filter(t => t[1] !== 'Extra').forEach(([t, seg, serie]) => matriz.filter(m => m[0] === serie).forEach(([, comp, n]) => {
    if (comp === 'Educação Física' && (t === '5A' || t === '5B')) return;   // turma junta (abaixo)
    linha(t, comp, quem(t, seg, serie, comp), n, (seg === 'EFAI' && comp === 'Arte') || (serie === '2ª série' && comp === 'Redação') ? 1 : 0);
  }));
  linha('5A + 5B', 'Educação Física', 'Fabiano', 2);
  // Extra 1º ao 5º: o monitor da turma dá Lição de Casa (sempre na 1ª aula), Recreação (sempre na 3ª), Reforço e Defesa Pessoal
  ['1A', '2A', '3A', '4A', '5A', '5B'].forEach((t, i) => {
    const x = 'Extra ' + t, mon = ['Jussara', 'Natália', 'Mônica', 'Adriana', 'Beatriz', 'Cláudia'][i], g = i < 3 ? 0 : 1;
    linha(x, 'Lição de Casa', mon, 5, 0, 1); linha(x, 'Recreação', mon, 5, 0, 3); linha(x, 'Reforço', mon, 2); linha(x, 'Defesa Pessoal', mon, 2);
    linha(x, 'Língua Inglesa', ['Giovana', 'Hugo'][g], 2); linha(x, 'Língua Espanhola', ['Irene', 'Júlio'][g], 2); linha(x, 'Teatro', ['Laura', 'Mauro'][g], 2);
  });
  // Extra 6º ao EM: turmas juntas em grupos (mesmo horário), três pessoas para cada matéria
  [['6A', '6B'], ['7A', '7B'], ['8A', '8B'], ['9A', '9B'], ['1 EM A', '1 EM B'], ['2 EM A', '2 EM B', '2 EM C'], ['3 EM A', '3 EM B']].forEach((ts, i) => {
    const x = ts.map(t => 'Extra ' + t).join(' + '), k = i < 3 ? 0 : i < 5 ? 1 : 2;
    linha(x, 'Defesa Pessoal', ['Nelson', 'Olga', 'Priscila'][k], 5); linha(x, 'Vôlei', ['Quitéria', 'Renan', 'Simone'][k], 5); linha(x, 'Futebol', ['Tiago', 'Úrsula', 'Valter'][k], 5);
  });

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
