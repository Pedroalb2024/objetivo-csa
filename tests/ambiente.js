// Simula o Apps Script (planilha em memória, cache, propriedades, lock) para testar o Codigo.js e o Gerador.html no Node.
// Uso: const amb = criarAmbiente(); amb.ctx.gravarExemplo_(); const D = amb.dados(); const G = amb.gerador();
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const DIR = path.join(__dirname, '..', 'apps-script');

class Faixa {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) { const lin = this.sh.d[this.r - 1 + i] || []; const x = []; for (let j = 0; j < this.nc; j++) { const v = lin[this.c - 1 + j]; x.push(v === undefined ? '' : v); } out.push(x); }
    return out;
  }
  setValues(v) {
    v.forEach((lin, i) => { const L = this.sh.d[this.r - 1 + i] = this.sh.d[this.r - 1 + i] || []; lin.forEach((x, j) => { L[this.c - 1 + j] = x; }); });
    return this;
  }
  setValue(x) { return this.setValues([[x]]); }
  clearContent() { for (let i = 0; i < this.nr; i++) { const L = this.sh.d[this.r - 1 + i]; if (L) for (let j = 0; j < this.nc; j++) L[this.c - 1 + j] = ''; } return this; }
  setFontWeight() { return this; } setBackground() { return this; } setFontColor() { return this; } setNumberFormat() { return this; }
}
class Aba {
  constructor(nome) { this.nome = nome; this.d = []; }
  getName() { return this.nome; }
  getLastRow() { for (let i = this.d.length - 1; i >= 0; i--) if ((this.d[i] || []).some(v => v !== '' && v !== undefined && v !== null)) return i + 1; return 0; }
  getLastColumn() { return Math.max(0, ...this.d.map(l => { let n = 0; (l || []).forEach((v, j) => { if (v !== '' && v !== undefined) n = j + 1; }); return n; })); }
  getMaxRows() { return this.max || 1000; }   // como no Sheets: aba nova tem 1000 linhas; passar disso dá erro
  insertRowsAfter(r, n) { this.max = this.getMaxRows() + n; }
  getRange(r, c, nr, nc) {
    if (r + (nr || 1) - 1 > this.getMaxRows()) throw new Error(`Intervalo fora da aba ${this.nome} (linha ${r + (nr || 1) - 1} > ${this.getMaxRows()})`);
    return new Faixa(this, r, c, nr || 1, nc || 1);
  }
  setFrozenRows() { }
  clearContents() { this.d = []; }
  appendRow(v) { const n = this.getLastRow(); if (n + 1 > this.getMaxRows()) this.max = n + 1; this.d[n] = v.slice(); }
}
class Planilha {
  constructor() { this.abas = {}; }
  getSheetByName(n) { return this.abas[n] || null; }
  insertSheet(n) { return this.abas[n] = new Aba(n); }
  getSheets() { return Object.values(this.abas); }
  deleteSheet(s) { delete this.abas[s.nome]; }
  getId() { return 'planilha-teste'; }
  getSpreadsheetTimeZone() { return 'America/Sao_Paulo'; }
}

function criarAmbiente() {
  const ss = new Planilha(), props = {}, cache = new Map();
  const ctx = {
    console, setTimeout, Date, Math, JSON,
    SpreadsheetApp: { getActive: () => ss, openById: () => ss, getUi: () => ({ alert: () => 'YES', ButtonSet: {}, Button: { YES: 'YES' } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] === undefined ? null : props[k], setProperty: (k, v) => { props[k] = String(v); } }) },
    LockService: { getScriptLock: () => ({ waitLock() { }, releaseLock() { } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache.has(k) ? cache.get(k) : null, put: (k, v) => cache.set(k, v), remove: k => cache.delete(k) }) },
    Utilities: { getUuid: () => crypto.randomUUID(), formatDate: (d, tz, f) => { const p = n => String(n).padStart(2, '0'); return f === 'HH:mm' ? p(d.getHours()) + ':' + p(d.getMinutes()) : `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; } },
    ScriptApp: { getService: () => ({ getUrl: () => 'http:\/\/local' }) },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(DIR, 'Codigo.js'), 'utf8'), ctx, { filename: 'Codigo.js' });
  props.PLANILHA_ID = ss.getId();
  return {
    ss, ctx, props, cache,
    dados: (perfil) => JSON.parse(JSON.stringify(ctx.dados_({ u: 'teste', nome: 'Teste', perfil: perfil || 'admin' }))),
    gerador: () => carregarScript('Gerador.html', 'Gerador'),
  };
}

// Executa o <script> de um .html do Apps Script e devolve o objeto global pedido
function carregarScript(arquivo, nome) {
  const html = fs.readFileSync(path.join(DIR, arquivo), 'utf8'), js = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
  const c = { console, setTimeout, Math, JSON, Date };
  vm.createContext(c);
  vm.runInContext(js + `\n;this.${nome} = ${nome};`, c, { filename: arquivo });
  return c[nome];
}

module.exports = { criarAmbiente, carregarScript };
