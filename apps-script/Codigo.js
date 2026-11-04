// ================= GRADE HORÁRIA · OBJETIVO CSA — servidor (Apps Script) =================
const CONFIG = {
  ESCOLA: 'Objetivo CSA',
  LOGO_URL: '',      // ex.: 'https://SEU-USUARIO.github.io/objetivo-csa/logo.png'
  URL_PUBLICA: '',   // ex.: 'https://SEU-USUARIO.github.io/objetivo-csa/' (link do sistema e do formulário)
  CREDITO: 'ALBIX',
  SESSAO_HORAS: 6,
};
const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'];
const ABA = { config: 'Config', prof: 'Professores', turmas: 'Turmas', carga: 'Carga', fixas: 'Fixas', grade: 'Grade', usuarios: 'Usuários', registro: 'Registro' };
const CAB = {
  'Config': ['Turno', 'Aulas por dia', 'Início (hh:mm)', 'Duração da aula (min)', 'Intervalo após a aula nº', 'Duração do intervalo (min)'],
  'Professores': ['Professor', 'Disciplinas', 'WhatsApp', 'Máx. aulas por dia', 'Indisponível (dia turno aula)', 'Respondeu em', 'Observação'],
  'Turmas': ['Turma', 'Turno'],
  'Carga': ['Turma', 'Disciplina', 'Professor', 'Aulas/semana', 'Aulas duplas', 'Máx. por dia'],
  'Fixas': ['Turma', 'Dia', 'Aula nº', 'Disciplina'],
  'Grade': ['Turma', 'Dia', 'Aula nº', 'Horário', 'Disciplina', 'Professor'],
  'Usuários': ['Usuário', 'Senha', 'Nome', 'Perfil (admin / coordenacao / consulta)', 'Ativo (Sim/Não)', 'Último acesso'],
  'Registro': ['Data', 'Usuário', 'Ação'],
};
const PERFIS = ['admin', 'coordenacao', 'consulta'];

// ---------------- Páginas ----------------
function doGet(e) {
  const form = !!(e && e.parameter && 'form' in e.parameter);
  const t = HtmlService.createTemplateFromFile(form ? 'Formulario' : 'App');
  t.cfg = { escola: CONFIG.ESCOLA, logo: CONFIG.LOGO_URL, credito: CONFIG.CREDITO };
  return t.evaluate()
    .setTitle((form ? 'Disponibilidade · ' : 'Grade Horária · ') + CONFIG.ESCOLA)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function incluir_(arquivo) { return HtmlService.createHtmlOutputFromFile(arquivo).getContent(); }

// ---------------- Login e sessão ----------------
function login(usuario, senha) {
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
const ACOES = {
  carregar:         { p: ['admin', 'coordenacao', 'consulta'], f: (d, s) => dados_(s) },
  salvarConfig:     { p: ['admin', 'coordenacao'], f: salvarConfig_ },
  salvarProfessor:  { p: ['admin', 'coordenacao'], f: salvarProfessor_ },
  excluirProfessor: { p: ['admin', 'coordenacao'], f: excluirProfessor_ },
  salvarTurma:      { p: ['admin', 'coordenacao'], f: salvarTurma_ },
  excluirTurma:     { p: ['admin', 'coordenacao'], f: excluirTurma_ },
  salvarCarga:      { p: ['admin', 'coordenacao'], f: salvarCarga_ },
  salvarFixas:      { p: ['admin', 'coordenacao'], f: salvarFixas_ },
  salvarGrade:      { p: ['admin', 'coordenacao'], f: salvarGrade_ },
  substituir:       { p: ['admin', 'coordenacao'], f: substituir_ },
  salvarUsuario:    { p: ['admin'], f: salvarUsuario_ },
  excluirUsuario:   { p: ['admin'], f: excluirUsuario_ },
};

function api(token, acao, dados) {
  const s = sessao_(token), a = ACOES[acao];
  if (!a) throw new Error('Ação desconhecida.');
  if (a.p.indexOf(s.perfil) < 0) throw new Error('Seu perfil não tem permissão para isso.');
  if (acao === 'carregar') return dados_(s);
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
    turnos: lerTurnos_(),
    professores: valores_(ABA.prof).map(r => ({ nome: txt_(r[0]), disciplinas: txt_(r[1]), tel: txt_(r[2]), maxDia: num_(r[3]),
      indisp: lerIndisp_(r[4]), respondeuEm: txt_(r[5]), obs: txt_(r[6]) })),
    turmas: valores_(ABA.turmas).map(r => ({ nome: txt_(r[0]), turno: txt_(r[1]) })),
    carga: valores_(ABA.carga).map(r => ({ turma: txt_(r[0]), disciplina: txt_(r[1]), professor: txt_(r[2]), aulas: num_(r[3]), duplas: num_(r[4]), maxDia: num_(r[5]) })),
    fixas: valores_(ABA.fixas).map(r => ({ turma: txt_(r[0]), dia: txt_(r[1]), aula: num_(r[2]), disciplina: txt_(r[3]) })),
    grade: {},
  };
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

// ---------------- Cadastros ----------------
function salvarConfig_(d) {
  const turnos = (d.turnos || []).map(t => ({ ...t, nome: String(t.nome || '').trim() }));
  if (!turnos.length) throw new Error('Cadastre pelo menos um turno.');
  const nomes = turnos.map(t => t.nome);
  if (nomes.some(n => !n) || new Set(nomes).size !== nomes.length) throw new Error('Cada turno precisa de um nome diferente.');
  turnos.forEach(t => {
    if (!(t.aulas >= 1 && t.aulas <= 12)) throw new Error(`${t.nome}: aulas por dia deve ser entre 1 e 12.`);
    if (!/^\d{1,2}:\d{2}$/.test(String(t.inicio || ''))) throw new Error(`${t.nome}: início no formato hh:mm.`);
  });
  turnos.forEach(t => { // renomeou turno: atualiza turmas e disponibilidades
    if (t.nomeAntigo && t.nomeAntigo !== t.nome) {
      trocarValor_(ABA.turmas, 1, t.nomeAntigo, t.nome);
      const v = valores_(ABA.prof).map(r => { r[4] = gravarIndisp_(lerIndisp_(r[4]).map(k => { const p = k.split('|'); return p[1] === t.nomeAntigo ? [p[0], t.nome, p[2]].join('|') : k; })); return r; });
      gravar_(ABA.prof, v);
    }
  });
  const turmasSemTurno = valores_(ABA.turmas).filter(r => nomes.indexOf(txt_(r[1])) < 0).map(r => txt_(r[0]));
  if (turmasSemTurno.length) throw new Error('Estas turmas usam um turno que seria removido: ' + turmasSemTurno.join(', '));
  gravar_(ABA.config, turnos.map(t => [t.nome, +t.aulas, String(t.inicio), +t.duracao || 50, +t.intervaloApos || 0, +t.intervaloMin || 0]));
  return 'Alterou os horários dos turnos';
}

function salvarProfessor_(d) {
  const nome = String(d.nome || '').trim(), antigo = String(d.nomeAntigo || '').trim();
  if (!nome) throw new Error('Informe o nome do professor.');
  const v = valores_(ABA.prof);
  const i = antigo ? v.findIndex(r => txt_(r[0]) === antigo) : -1;
  if (v.some((r, j) => j !== i && txt_(r[0]).toLowerCase() === nome.toLowerCase())) throw new Error('Já existe um professor com esse nome.');
  const linha = [nome, String(d.disciplinas || '').trim(), String(d.tel || '').trim(), +d.maxDia || '', gravarIndisp_(d.indisp || []),
    i >= 0 ? txt_(v[i][5]) : '', i >= 0 ? txt_(v[i][6]) : ''];
  if (i >= 0) v[i] = linha; else v.push(linha);
  gravar_(ABA.prof, v);
  if (i >= 0 && antigo !== nome) { trocarValor_(ABA.carga, 2, antigo, nome); trocarValor_(ABA.grade, 5, antigo, nome); }
  return (i >= 0 ? 'Editou professor ' : 'Cadastrou professor ') + nome;
}

function excluirProfessor_(d) {
  const usos = valores_(ABA.carga).filter(r => txt_(r[2]) === d.nome).map(r => txt_(r[0]) + ' (' + txt_(r[1]) + ')');
  if (usos.length) throw new Error('Este professor ainda está na carga de: ' + usos.join(', ') + '. Use "Trocar professor" na grade antes.');
  gravar_(ABA.prof, valores_(ABA.prof).filter(r => txt_(r[0]) !== d.nome));
  return 'Excluiu professor ' + d.nome;
}

function salvarTurma_(d) {
  const nome = String(d.nome || '').trim(), antigo = String(d.nomeAntigo || '').trim();
  if (!nome) throw new Error('Informe o nome da turma.');
  if (!lerTurnos_().some(t => t.nome === d.turno)) throw new Error('Escolha um turno válido.');
  const v = valores_(ABA.turmas), i = antigo ? v.findIndex(r => txt_(r[0]) === antigo) : -1;
  if (v.some((r, j) => j !== i && txt_(r[0]).toLowerCase() === nome.toLowerCase())) throw new Error('Já existe uma turma com esse nome.');
  if (i >= 0) v[i] = [nome, d.turno]; else v.push([nome, d.turno]);
  gravar_(ABA.turmas, v);
  if (i >= 0 && antigo !== nome) [ABA.carga, ABA.fixas, ABA.grade].forEach(a => trocarValor_(a, 0, antigo, nome));
  return (i >= 0 ? 'Editou turma ' : 'Criou turma ') + nome;
}

function excluirTurma_(d) {
  [ABA.turmas, ABA.carga, ABA.fixas, ABA.grade].forEach(a => gravar_(a, valores_(a).filter(r => txt_(r[0]) !== d.nome)));
  return 'Excluiu turma ' + d.nome;
}

function salvarCarga_(d) {
  const turma = d.turma, profs = valores_(ABA.prof).map(r => txt_(r[0]));
  if (!valores_(ABA.turmas).some(r => txt_(r[0]) === turma)) throw new Error('Turma não encontrada.');
  const vistas = {};
  const novas = (d.linhas || []).filter(l => String(l.disciplina || '').trim()).map(l => {
    const disc = String(l.disciplina).trim();
    if (vistas[disc.toLowerCase()]) throw new Error(`${disc} aparece duas vezes nesta turma.`);
    vistas[disc.toLowerCase()] = 1;
    if (profs.indexOf(l.professor) < 0) throw new Error(`Escolha o professor de ${disc}.`);
    if (!(+l.aulas > 0)) throw new Error(`${disc}: informe as aulas por semana.`);
    return [turma, disc, l.professor, +l.aulas, +l.duplas || 0, +l.maxDia || 2];
  });
  gravar_(ABA.carga, valores_(ABA.carga).filter(r => txt_(r[0]) !== turma).concat(novas));
  const discs = novas.map(r => r[1]);   // fixas de disciplinas removidas saem junto
  gravar_(ABA.fixas, valores_(ABA.fixas).filter(r => txt_(r[0]) !== turma || discs.indexOf(txt_(r[3])) >= 0));
  return 'Alterou disciplinas da turma ' + turma;
}

function salvarFixas_(d) {
  const linhas = (d.fixas || []).filter(f => f.turma && f.disciplina).map(f => [f.turma, f.dia, +f.aula, f.disciplina]);
  gravar_(ABA.fixas, linhas);
  return 'Alterou aulas fixas (' + linhas.length + ')';
}

function salvarGrade_(d) {
  const grade = d.grade || {}, turmas = valores_(ABA.turmas), turnos = lerTurnos_();
  const ordem = {}, turnoDe = {};
  turmas.forEach((r, i) => { ordem[txt_(r[0])] = i; turnoDe[txt_(r[0])] = turnos.find(t => t.nome === txt_(r[1])); });
  const linhas = Object.keys(grade).map(k => {
    const p = k.split('|'), c = grade[k];
    return [p[0], DIAS[+p[1]], +p[2] + 1, horario_(turnoDe[p[0]], +p[2]), c.disciplina, c.professor, p[0] in ordem ? ordem[p[0]] : 999, +p[1]];
  }).sort((x, y) => x[6] - y[6] || x[7] - y[7] || x[2] - y[2]).map(r => r.slice(0, 6));
  gravar_(ABA.grade, linhas);
  return 'Salvou a grade (' + linhas.length + ' aulas)';
}

function substituir_(d) {
  const profs = valores_(ABA.prof).map(r => txt_(r[0]));
  if (profs.indexOf(d.entra) < 0) throw new Error('Professor que entra não encontrado.');
  const linhas = {}; (d.linhas || []).forEach(l => linhas[l.turma + '|' + l.disciplina] = 1);
  let n = 0;
  gravar_(ABA.carga, valores_(ABA.carga).map(r => {
    if (txt_(r[2]) === d.sai && linhas[txt_(r[0]) + '|' + txt_(r[1])]) { r[2] = d.entra; n++; }
    return r;
  }));
  salvarGrade_({ grade: d.grade });
  return d.sai === d.entra ? 'Reencaixou as aulas de ' + d.entra : `Trocou ${d.sai} por ${d.entra} (${n} disciplina/turma)`;
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

// ---------------- Formulário dos professores (link único, sem login) ----------------
function formLista() {
  const disc = discPorProf_();
  return { escola: CONFIG.ESCOLA, dias: DIAS, turnos: lerTurnos_(),
    profs: valores_(ABA.prof).map(r => ({ nome: txt_(r[0]), disciplinas: txt_(r[1]) || disc[txt_(r[0])] || '' }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt')) };
}

function formDados(nome) {
  const r = valores_(ABA.prof).find(x => txt_(x[0]) === nome);
  if (!r) throw new Error('Professor não encontrado.');
  return { indisp: lerIndisp_(r[4]), obs: txt_(r[6]), respondeuEm: txt_(r[5]) };
}

function formEnviar(d) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const v = valores_(ABA.prof), nome = String(d.nome || '').trim().replace(/\s+/g, ' '), quando = agora_();
    if (nome.length < 3) throw new Error('Informe seu nome completo.');
    const validos = {};
    lerTurnos_().forEach(t => DIAS.forEach(dia => { for (let a = 1; a <= t.aulas; a++) validos[dia + '|' + t.nome + '|' + a] = 1; }));
    const indisp = gravarIndisp_((d.indisp || []).filter(k => validos[k]));
    const obs = String(d.obs || '').slice(0, 500), disc = String(d.disciplinas || '').trim().slice(0, 120), tel = String(d.tel || '').trim().slice(0, 30);
    let i = v.findIndex(r => txt_(r[0]).toLowerCase() === nome.toLowerCase());
    if (d.novo && i >= 0) throw new Error('Esse nome já está na lista. Volte e selecione-o.');
    if (!d.novo && i < 0) throw new Error('Professor não encontrado.');
    if (i < 0) { v.push([nome, disc, tel, '', indisp, quando, obs]); i = v.length - 1; }
    else { v[i][4] = indisp; v[i][5] = quando; v[i][6] = obs; if (disc) v[i][1] = disc; if (tel) v[i][2] = tel; }
    gravar_(ABA.prof, v);
    registrar_('formulário', (d.novo ? 'Novo professor: ' : 'Disponibilidade: ') + nome);
    return { quando: quando };
  } finally { lock.releaseLock(); }
}

function discPorProf_() {
  const m = {};
  valores_(ABA.carga).forEach(r => { const p = txt_(r[2]), dsc = txt_(r[1]); m[p] = m[p] || []; if (m[p].indexOf(dsc) < 0) m[p].push(dsc); });
  Object.keys(m).forEach(p => m[p] = m[p].join(', '));
  return m;
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
  if (linhas.length) sh.getRange(2, 1, linhas.length, nc).setValues(linhas.map(r => r.slice(0, nc).map(x => x === undefined || x === null ? '' : x)));
}
function trocarValor_(nome, col, de, para) {
  gravar_(nome, valores_(nome).map(r => { if (txt_(r[col]) === de) r[col] = para; return r; }));
}
function registrar_(usuario, acao) { aba_(ABA.registro).appendRow([new Date(), usuario, acao]); }

function lerTurnos_() {
  return valores_(ABA.config).map(r => ({ nome: txt_(r[0]), aulas: num_(r[1]), inicio: hora_(r[2]), duracao: num_(r[3]) || 50, intervaloApos: num_(r[4]), intervaloMin: num_(r[5]) }));
}
function lerIndisp_(v) { // "Seg Manhã 1; Seg Manhã 2" -> ["Seg|Manhã|1", ...]
  return String(v || '').split(';').map(x => x.trim()).filter(String).map(x => {
    const p = x.split(/\s+/); return [p[0], p.slice(1, -1).join(' '), p[p.length - 1]].join('|');
  });
}
function gravarIndisp_(lista) { return lista.map(k => k.split('|').join(' ')).join('; '); }

function txt_(v) { return String(v === null || v === undefined ? '' : v).trim(); }
function num_(v) { return v === '' || v === null ? 0 : Number(v) || 0; }
function sim_(v) { return v === true || /^(sim|s|true|1|x)$/i.test(txt_(v)); }
function hora_(v) { return v instanceof Date ? Utilities.formatDate(v, tz_(), 'HH:mm') : txt_(v); }
function linkBase_() { return CONFIG.URL_PUBLICA || ScriptApp.getService().getUrl(); }
function horario_(t, a) {
  if (!t || !t.inicio) return '';
  const hm = t.inicio.split(':').map(Number);
  const ini = hm[0] * 60 + hm[1] + a * t.duracao + (t.intervaloApos && a >= t.intervaloApos ? t.intervaloMin : 0);
  const f = x => ('0' + Math.floor(x / 60)).slice(-2) + ':' + ('0' + x % 60).slice(-2);
  return f(ini) + '–' + f(ini + t.duracao);
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
  Object.keys(CAB).forEach(nome => cabecalho_(aba_(nome), nome));
  if (!valores_(ABA.config).length) gravar_(ABA.config, [['Manhã', 6, '07:00', 50, 3, 20]]);
  let msg = 'Planilha pronta.';
  if (!valores_(ABA.usuarios).length) {
    const senha = Utilities.getUuid().slice(0, 8);
    gravar_(ABA.usuarios, [['admin', senha, 'Administrador', 'admin', 'Sim', '']]);
    msg += '\n\nUsuário: admin\nSenha: ' + senha + '\n\n(fica na aba Usuários)';
  }
  const pad = ss.getSheetByName('Página1') || ss.getSheetByName('Sheet1');
  if (pad && ss.getSheets().length > 1 && pad.getLastRow() === 0) ss.deleteSheet(pad);
  SpreadsheetApp.getUi().alert(msg);
}

function criarExemplo() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Dados de exemplo', 'Apaga turnos, professores, turmas, carga, fixas e grade e coloca uma escola fictícia. Usuários são mantidos. Continuar?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  PropertiesService.getScriptProperties().setProperty('PLANILHA_ID', SpreadsheetApp.getActive().getId());
  const turnos = [['Manhã', 6, '07:00', 50, 3, 20], ['Tarde', 5, '13:00', 50, 3, 20]];
  gravar_(ABA.config, turnos);
  const turmas = [['6º A', 'Manhã'], ['6º B', 'Manhã'], ['7º A', 'Manhã'], ['8º A', 'Manhã'], ['9º A', 'Manhã'],
    ['1ª EM', 'Manhã'], ['2ª EM', 'Manhã'], ['3ª EM', 'Manhã'], ['1º ano', 'Tarde'], ['2º ano', 'Tarde'], ['3º ano', 'Tarde'], ['4º ano', 'Tarde'], ['5º ano', 'Tarde']];
  gravar_(ABA.turmas, turmas);
  const tudo = (d, t) => { const n = turnos.find(x => x[0] === t)[1], r = []; for (let a = 1; a <= n; a++) r.push(d + '|' + t + '|' + a); return r; };
  const segTer = [].concat(tudo('Seg', 'Manhã'), tudo('Seg', 'Tarde'), tudo('Ter', 'Manhã'), tudo('Ter', 'Tarde'));
  const profs = [ // [nome, disciplinas, máx/dia, indisponível]
    ['Ana Ribeiro', 'Português', 6, []], ['Carlos Mendes', 'Português', 6, tudo('Sex', 'Manhã').concat(['Qua|Manhã|1', 'Qua|Manhã|2'])],
    ['Juliana Prado', 'Matemática', 6, []], ['Rafael Torres', 'Matemática', 6, tudo('Seg', 'Manhã')],
    ['Beatriz Lima', 'Ciências', 6, []], ['Marcos Vieira', 'História', 6, []], ['Fernanda Costa', 'Geografia', 6, tudo('Qua', 'Manhã')],
    ['Lucas Almeida', 'Inglês', 7, []], ['Patrícia Nunes', 'Arte', 6, []], ['Diego Santos', 'Ed. Física', 7, []], ['Camila Rocha', 'Redação', 6, []],
    ['Renata Gomes', 'Espanhol', 6, segTer], ['Eduardo Martins', 'Física', 6, segTer],
    ['Larissa Freitas', 'Química', 6, [].concat(tudo('Qui', 'Manhã'), tudo('Qui', 'Tarde'))], ['Gustavo Moreira', 'Biologia', 6, [].concat(tudo('Sex', 'Manhã'), tudo('Sex', 'Tarde'))],
    ['Helena Barros', 'Filosofia, Sociologia', 6, [].concat(tudo('Seg', 'Manhã'), tudo('Seg', 'Tarde'), tudo('Qua', 'Manhã'), tudo('Qua', 'Tarde'))],
    ['Aline Souza', 'Polivalente', 6, []], ['Bruna Castro', 'Polivalente', 6, []], ['Cláudia Pires', 'Polivalente', 6, []], ['Daniela Lopes', 'Polivalente', 6, []], ['Elaine Teixeira', 'Polivalente', 6, []],
    ['Thiago Ramos', 'Física', 6, [].concat(tudo('Qua', 'Manhã'), tudo('Sex', 'Manhã'))]];
  gravar_(ABA.prof, profs.map(([n, dsc, m, ind]) => [n, dsc, '', m, gravarIndisp_(ind), n === 'Thiago Ramos' ? agora_() : '', n === 'Thiago Ramos' ? 'Substituto de Física' : '']));
  const fii = [['Português', 5, 0, 2, 'Ana Ribeiro'], ['Matemática', 5, 0, 2, 'Juliana Prado'], ['Ciências', 4, 0, 2, 'Beatriz Lima'],
    ['História', 3, 0, 1, 'Marcos Vieira'], ['Geografia', 3, 0, 1, 'Fernanda Costa'], ['Inglês', 2, 0, 1, 'Lucas Almeida'], ['Arte', 2, 1, 2, 'Patrícia Nunes'],
    ['Ed. Física', 2, 1, 2, 'Diego Santos'], ['Redação', 2, 1, 2, 'Camila Rocha'], ['Espanhol', 2, 0, 1, 'Renata Gomes']];
  const em = [['Português', 4, 0, 2, 'Carlos Mendes'], ['Matemática', 5, 1, 2, 'Rafael Torres'], ['Física', 3, 0, 2, 'Eduardo Martins'],
    ['Química', 3, 0, 2, 'Larissa Freitas'], ['Biologia', 3, 0, 2, 'Gustavo Moreira'], ['História', 2, 0, 1, 'Marcos Vieira'], ['Geografia', 2, 0, 1, 'Fernanda Costa'],
    ['Inglês', 2, 0, 1, 'Lucas Almeida'], ['Filosofia', 1, 0, 1, 'Helena Barros'], ['Sociologia', 1, 0, 1, 'Helena Barros'],
    ['Ed. Física', 2, 1, 2, 'Diego Santos'], ['Redação', 2, 1, 2, 'Camila Rocha']];
  const poli = ['Aline Souza', 'Bruna Castro', 'Cláudia Pires', 'Daniela Lopes', 'Elaine Teixeira'];
  const fi = n => [['Polivalente', 19, 0, 4, poli[n - 1]], ['Ed. Física', 2, 1, 2, 'Diego Santos'], ['Inglês', 2, 0, 1, 'Lucas Almeida'], ['Arte', 2, 0, 1, 'Patrícia Nunes']];
  const carga = [];
  turmas.forEach(([t]) => (t.indexOf('EM') >= 0 ? em : t.indexOf('ano') >= 0 ? fi(+t[0]) : fii).forEach(([disc, au, du, mx, p]) => carga.push([t, disc, p, au, du, mx])));
  gravar_(ABA.carga, carga);
  gravar_(ABA.fixas, [['3ª EM', 'Sex', 1, 'Matemática']]);
  gravar_(ABA.grade, []);
  registrar_('planilha', 'Criou dados de exemplo');
  SpreadsheetApp.getActive().toast('Exemplo criado.');
}

function limparDados() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Limpar dados', 'Apaga professores, turmas, carga, fixas e grade (mantém turnos e usuários). Continuar?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  [ABA.prof, ABA.turmas, ABA.carga, ABA.fixas, ABA.grade].forEach(a => gravar_(a, []));
  registrar_('planilha', 'Limpou os dados da escola');
}
