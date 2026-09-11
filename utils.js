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

// Cada vaga é salva como {nome, tipo} ('fixo' | 'freelancer' | '' = não confirmado).
// Aceita mapa {"0": {...}, "1": {...}} ou lista; também aceita nomes em texto puro.
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
  return Array.from(bruto, (v) => {
    if (!v) return { nome: '', tipo: '' };
    if (typeof v === 'string') return { nome: v, tipo: '' };
    return { nome: v.nome || '', tipo: v.tipo || '' };
  });
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
