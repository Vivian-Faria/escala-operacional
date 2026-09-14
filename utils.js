// Funções auxiliares usadas pelas duas páginas.

export const DIAS_CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const DIAS_LONGO = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
export const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function uid(prefixo = 'id') {
  return `${prefixo}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

// ---------- datas (sempre no fuso local, formato AAAA-MM-DD) ----------
export function isoDate(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dia}`;
}
export function parseIso(s) {
  const [a, m, d] = s.split('-').map(Number);
  return new Date(a, m - 1, d);
}
export function addDays(d, n) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() + n);
  return r;
}
// Semana começa no domingo
export function startOfWeek(d) {
  return addDays(d, -d.getDay());
}
export function capitalizar(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- horários ----------
export function toMin(hhmm) {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
// Turnos que passam da meia-noite (ex: 18:00–01:20) terminam "no dia seguinte"
export function intervalo(turno) {
  const ini = toMin(turno.inicio);
  let fim = toMin(turno.fim);
  if (fim <= ini) fim += 1440;
  return [ini, fim];
}
export function sobrepoe(a, b) {
  const [a1, a2] = intervalo(a);
  const [b1, b2] = intervalo(b);
  return a1 < b2 && b1 < a2;
}
export function faixaDoDia(inicio) {
  const h = Math.floor(toMin(inicio) / 60);
  if (h >= 5 && h < 12) return 'manha';
  if (h >= 12 && h < 18) return 'tarde';
  return 'noite';
}
export function ordenaTurnos(turnos) {
  return [...turnos].sort((a, b) => toMin(a.inicio) - toMin(b.inicio) || (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
}
export function vagasSemana(turno) {
  return (turno.vagas || []).reduce((s, v) => s + (Number(v) || 0), 0);
}

// ---------- textos ----------
export function limparNome(s) {
  return String(s || '').trim().replace(/\s+/g, ' ');
}
export function normalizaNome(s) {
  return limparNome(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
export function porNome(a, b) {
  return (a.nome || '').localeCompare(b.nome || '', 'pt-BR', { sensitivity: 'base' });
}
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const TIPOS = {
  fixo: { botao: 'Fixo', curto: 'fixo', plural: ['fixo', 'fixos'] },
  freelancer: { botao: 'Freela', curto: 'freela', plural: ['freelancer', 'freelancers'] },
  intermitente: { botao: 'Interm.', curto: 'interm.', plural: ['intermitente', 'intermitentes'] }
};

// Uma vaga é salva como {partes: [{nome, tipo, inicio, fim}]}.
// Sem inicio/fim, a pessoa cobre o turno inteiro. Formato antigo ({nome, tipo}
// ou texto puro) continua sendo lido normalmente.
function limparParte(p) {
  if (!p) return null;
  if (typeof p === 'string') return p.trim() ? { nome: limparNome(p), tipo: '', inicio: '', fim: '' } : null;
  const nome = limparNome(p.nome);
  if (!nome && !p.inicio && !p.fim) return null;
  return { nome, tipo: p.tipo || '', inicio: p.inicio || '', fim: p.fim || '' };
}

export function partesDe(valor) {
  if (!valor) return [];
  if (typeof valor === 'string') return [limparParte(valor)].filter(Boolean);
  if (Array.isArray(valor.partes)) return valor.partes.map(limparParte).filter(Boolean);
  return [limparParte({ nome: valor.nome, tipo: valor.tipo })].filter(Boolean);
}

// Vaga dividida: mais de uma pessoa, ou alguém com horário próprio
export function ehDividida(partes) {
  return partes.length > 1 || partes.some((p) => p.inicio || p.fim);
}

export function vagasDe(valor) {
  if (!valor) return [];
  const bruto = [];
  if (Array.isArray(valor)) valor.forEach((v, i) => { bruto[i] = v; });
  else {
    for (const [k, v] of Object.entries(valor)) {
      const i = Number(k);
      if (Number.isInteger(i) && i >= 0) bruto[i] = v;
    }
  }
  return Array.from(bruto, (v) => partesDe(v));
}

export function hhmm(min) {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// Minutos que uma parte cobre, sempre dentro da janela do turno.
// Trata turno que vira a noite: 18:00–01:20 vale 1080 a 1520.
function trechoDaParte(parte, tIni, tFim) {
  if (!parte.inicio && !parte.fim) return [tIni, tFim];
  let a = parte.inicio ? toMin(parte.inicio) : tIni;
  let b = parte.fim ? toMin(parte.fim) : tFim;
  while (a < tIni) a += 1440;
  while (b <= a) b += 1440;
  return [Math.max(a, tIni), Math.min(b, tFim)];
}

// O que está coberto e o que ficou em aberto dentro do turno.
// `faltou` diz se a pessoa daquela parte faltou (aí o trecho volta a ficar aberto).
export function cobertura(turno, partes, faltou = () => false) {
  const [tIni, tFim] = intervalo(turno);
  const trechos = partes
    .filter((p) => p.nome && !faltou(p.nome))
    .map((p) => trechoDaParte(p, tIni, tFim))
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);

  const buracos = [];
  let cursor = tIni;
  for (const [a, b] of trechos) {
    if (a > cursor) buracos.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < tFim) buracos.push([cursor, tFim]);
  return {
    buracos,
    coberta: trechos.length > 0 && buracos.length === 0,
    minutosAbertos: buracos.reduce((soma, [a, b]) => soma + (b - a), 0)
  };
}

export function textoBuraco([a, b]) {
  return `${hhmm(a)}–${hhmm(b)}`;
}

// Forma curta para caber nas células do mês: 12:00 vira 12h, 09:30 fica 09:30
export function horaCurta(h) {
  return h.endsWith(':00') ? `${h.slice(0, 2)}h` : h;
}
export function faixaCurta(ini, fim) {
  return `${horaCurta(ini)}–${horaCurta(fim)}`;
}

// Divide a janela do turno em N pedaços iguais, arredondados em 30 minutos
export function pedacos(turno, n = 2) {
  const [ini, fim] = intervalo(turno);
  const passo = Math.max(30, Math.round((fim - ini) / n / 30) * 30);
  const cortes = [ini];
  for (let i = 1; i < n; i++) cortes.push(Math.min(ini + passo * i, fim));
  cortes.push(fim);
  return Array.from({ length: n }, (_, i) => [hhmm(cortes[i]), hhmm(cortes[i + 1])]);
}

export function plural(n, um, varios) {
  return `${n} ${n === 1 ? um : varios}`;
}

// ---------- aviso flutuante ----------
export function criarStatus(elemento) {
  let timer;
  return function mostrar(texto, tipo = 'ok', fixo = false) {
    clearTimeout(timer);
    elemento.textContent = texto;
    elemento.className = `status visivel ${tipo}`;
    if (!fixo) timer = setTimeout(() => elemento.classList.remove('visivel'), 2600);
  };
}
