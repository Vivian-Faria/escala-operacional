// Página 2 — Escala: o supervisor escolhe seu nome e o hub e preenche as vagas.
import { configuracaoPronta, ouvirConfig, ouvirEscalas, salvarVaga, lancarAusencia, removerAusencia } from './db.js';
import { marcosDoDia, ROTULO_TIPO } from './feriados.js';
import {
  DIAS_CURTO, DIAS_LONGO, MESES, isoDate, parseIso, addDays, startOfWeek, capitalizar,
  ordenaTurnos, faixaDoDia, normalizaNome, limparNome, sobrepoe, escapeHtml, porNome,
  vagasDe, plural, criarStatus
} from './utils.js';

const $ = (s) => document.querySelector(s);
const el = {
  selSup: $('#selSupervisor'), selHub: $('#selHub'), aviso: $('#aviso'), painel: $('#painel'),
  quadro: $('#quadro'), titulo: $('#tituloPeriodo'), resumo: $('#resumoPeriodo'),
  lista: $('#listaColaboradores'), dlg: $('#dlgDia'), dlgTitulo: $('#dlgTitulo'), dlgCorpo: $('#dlgCorpo')
};
const mostrarStatus = criarStatus($('#status'));

// Abaixo desta largura (celular e tablet) a semana mostra um dia por vez
const TELA_COMPACTA = matchMedia('(max-width: 1099px)');

const params = new URLSearchParams(location.search);
const estado = {
  cfg: null,
  supId: params.get('sup') || '',
  hubId: params.get('hub') || '',
  modo: params.get('modo') === 'mes' ? 'mes' : 'semana',
  ref: new Date(),
  escalas: {},
  escalasProntas: false,
  cancelar: null,
  chaveFaixa: '',
  diaAberto: null,   // dia aberto na janela (visão mensal)
  diaSel: null       // dia mostrado no celular (visão semanal)
};

function mostrarAviso(titulo, texto) {
  el.aviso.innerHTML = `<h2>${titulo}</h2><p>${texto}</p>`;
  el.aviso.hidden = false;
  el.painel.hidden = true;
}

function erroLeitura(err) {
  console.error(err);
  mostrarAviso('Não foi possível carregar a escala', err?.code === 'permission-denied'
    ? 'O Firestore recusou a leitura. Confira se as regras do arquivo <code>firestore.rules</code> foram publicadas.'
    : 'Verifique a conexão com a internet e recarregue a página.');
}

function erroGravacao(err) {
  console.error(err);
  mostrarStatus(err?.code === 'permission-denied'
    ? 'O Firestore recusou a gravação. Confira as regras publicadas.'
    : 'Não foi possível salvar. Verifique a conexão e tente de novo.', 'erro', true);
}

// ================= período e dados =================
function faixaPeriodo() {
  if (estado.modo === 'semana') {
    const ini = startOfWeek(estado.ref);
    return { ini, fim: addDays(ini, 6) };
  }
  const primeiro = new Date(estado.ref.getFullYear(), estado.ref.getMonth(), 1);
  const ultimo = new Date(estado.ref.getFullYear(), estado.ref.getMonth() + 1, 0);
  return { ini: startOfWeek(primeiro), fim: addDays(startOfWeek(ultimo), 6), primeiro };
}

function assinarEscalas() {
  const { ini, fim } = faixaPeriodo();
  const chave = `${isoDate(ini)}|${isoDate(fim)}`;
  if (chave === estado.chaveFaixa) return;
  estado.chaveFaixa = chave;
  estado.cancelar?.();
  estado.escalas = {};
  estado.escalasProntas = false;
  estado.cancelar = ouvirEscalas(isoDate(ini), isoDate(fim), (mapa) => {
    estado.escalas = mapa;
    estado.escalasProntas = true;
    render();
  }, erroLeitura);
}

const hojeIso = () => isoDate(new Date());
const docDia = (iso, hubId = estado.hubId) => estado.escalas[`${hubId}_${iso}`];
const vagasNoDia = (t, dow) => Number(t.vagas?.[dow]) || 0;
const turnoPorId = (id) => estado.cfg.turnos.find((t) => t.id === id);
const vagasSalvas = (iso, turnoId) => vagasDe(docDia(iso)?.slots?.[turnoId]);
const listaDoTurno = (iso, campo, turnoId) => docDia(iso)?.[campo]?.[turnoId] || [];
const nomeSupervisor = () => estado.cfg.supervisores.find((s) => s.id === estado.supId)?.nome || '';
const turnosDoHub = () => estado.cfg.turnos.filter((t) => t.hubId === estado.hubId);

// Situação de cada vaga cadastrada de um turno naquele dia.
// Quem está escalado e faltou deixa a vaga descoberta.
function situacaoVagas(iso, t, dow) {
  const salvas = vagasSalvas(iso, t.id);
  const faltas = new Set(listaDoTurno(iso, 'faltas', t.id).map(normalizaNome));
  return Array.from({ length: vagasNoDia(t, dow) }, (_, i) => {
    const v = salvas[i] || { nome: '', tipo: '' };
    const temNome = Boolean(v.nome.trim());
    const faltou = temNome && faltas.has(normalizaNome(v.nome));
    return { ...v, faltou, coberta: temNome && !faltou };
  });
}

function turnosDoDia(d) {
  const iso = isoDate(d);
  const dow = d.getDay();
  return ordenaTurnos(turnosDoHub().filter((t) => vagasNoDia(t, dow) > 0
    || vagasSalvas(iso, t.id).some((v) => v.nome.trim())
    || listaDoTurno(iso, 'folgas', t.id).length
    || listaDoTurno(iso, 'faltas', t.id).length));
}

function contagemDia(d) {
  const iso = isoDate(d);
  const dow = d.getDay();
  const c = { total: 0, cobertas: 0, descobertas: 0, pendentes: 0, freelas: 0, faltas: 0 };
  for (const t of turnosDoHub()) {
    c.faltas += listaDoTurno(iso, 'faltas', t.id).length;
    for (const v of situacaoVagas(iso, t, dow)) {
      c.total++;
      if (!v.coberta) continue;
      c.cobertas++;
      if (!v.tipo) c.pendentes++;
      if (v.tipo === 'freelancer') c.freelas++;
    }
  }
  c.descobertas = c.total - c.cobertas;
  return c;
}

// Todos os nomes lançados (em qualquer hub) naquele dia, para detectar conflitos
function indiceDoDia(iso) {
  const escalados = [];
  const folgas = [];
  for (const d of Object.values(estado.escalas)) {
    if (d.data !== iso) continue;
    const hubNome = estado.cfg.hubs.find((h) => h.id === d.hubId)?.nome || 'outro hub';
    for (const [turnoId, valor] of Object.entries(d.slots || {})) {
      const turno = turnoPorId(turnoId);
      if (!turno) continue;
      vagasDe(valor).forEach((v, idx) => {
        const norm = normalizaNome(v.nome);
        if (norm) escalados.push({ norm, hubId: d.hubId, hubNome, turno, idx });
      });
    }
    for (const [turnoId, lista] of Object.entries(d.folgas || {})) {
      const turno = turnoPorId(turnoId);
      if (!turno) continue;
      (lista || []).forEach((nome) => {
        const norm = normalizaNome(nome);
        if (norm) folgas.push({ norm, hubId: d.hubId, hubNome, turno });
      });
    }
  }
  return { escalados, folgas };
}

function onde(e) {
  const hub = e.hubId === estado.hubId ? '' : `${e.hubNome}, `;
  return `${hub}${e.turno.nome} (${e.turno.inicio}–${e.turno.fim})`;
}

function alertasVaga(ind, turno, idx, nome) {
  const norm = normalizaNome(nome);
  if (!norm) return [];
  const msgs = [];
  const outros = ind.escalados.filter((e) => e.norm === norm && sobrepoe(e.turno, turno)
    && !(e.hubId === estado.hubId && e.turno.id === turno.id && e.idx === idx));
  if (outros.length) msgs.push(`Também escalado em ${outros.map(onde).join('; ')}`);
  const deFolga = ind.folgas.filter((f) => f.norm === norm && sobrepoe(f.turno, turno));
  if (deFolga.length) msgs.push(`Está de folga em ${deFolga.map(onde).join('; ')}`);
  return msgs;
}

function alertaFolga(ind, turno, nome) {
  const norm = normalizaNome(nome);
  const esc = ind.escalados.filter((e) => e.norm === norm && sobrepoe(e.turno, turno));
  return esc.length ? `${limparNome(nome)} está de folga, mas escalado em ${esc.map(onde).join('; ')}` : '';
}

// ================= seletores =================
function hubsDoSupervisor() {
  const sup = estado.cfg.supervisores.find((s) => s.id === estado.supId);
  if (!sup) return [];
  const ids = sup.hubIds || [];
  const lista = ids.length ? estado.cfg.hubs.filter((h) => ids.includes(h.id)) : estado.cfg.hubs;
  return [...lista].sort(porNome);
}

function renderSeletores() {
  const sups = [...estado.cfg.supervisores].sort(porNome);
  if (!sups.some((s) => s.id === estado.supId)) estado.supId = '';
  el.selSup.innerHTML = '<option value="">Selecione seu nome</option>'
    + sups.map((s) => `<option value="${s.id}">${escapeHtml(s.nome)}</option>`).join('');
  el.selSup.value = estado.supId;

  const hubs = hubsDoSupervisor();
  if (!hubs.some((h) => h.id === estado.hubId)) estado.hubId = hubs.length === 1 ? hubs[0].id : '';
  el.selHub.disabled = !estado.supId;
  el.selHub.innerHTML = `<option value="">${estado.supId ? 'Selecione o hub' : 'Escolha seu nome primeiro'}</option>`
    + hubs.map((h) => `<option value="${h.id}">${escapeHtml(h.nome)}</option>`).join('');
  el.selHub.value = estado.hubId;
  atualizarDatalist();
  atualizarUrl();
}

// Sugestões ao digitar: colaboradores do hub + os sem hub definido
function atualizarDatalist() {
  const todos = estado.cfg.colaboradores;
  let lista = todos.filter((c) => !c.hubId || c.hubId === estado.hubId);
  if (!lista.length) lista = todos;
  el.lista.innerHTML = [...lista].sort(porNome)
    .map((c) => `<option value="${escapeHtml(c.nome)}"></option>`).join('');
}

function atualizarUrl() {
  const p = new URLSearchParams();
  if (estado.supId) p.set('sup', estado.supId);
  if (estado.hubId) p.set('hub', estado.hubId);
  if (estado.modo === 'mes') p.set('modo', 'mes');
  const q = p.toString();
  history.replaceState(null, '', q ? `?${q}` : location.pathname);
}

// ================= render =================
function render() {
  if (!estado.cfg) return;
  const { hubs, supervisores } = estado.cfg;
  if (!hubs.length || !supervisores.length) {
    return mostrarAviso('Nada cadastrado ainda',
      `${hubs.length ? 'Nenhum supervisor' : 'Nenhum hub'} foi cadastrado. Configure em <a href="cadastros.html">Cadastros</a>.`);
  }
  if (!estado.supId || !estado.hubId) {
    return mostrarAviso('Escolha seu nome e o hub',
      'A escala da unidade aparece aqui, com as vagas de cada turno para você preencher.');
  }
  if (!turnosDoHub().length) {
    return mostrarAviso('Este hub ainda não tem turnos',
      'Os turnos e a quantidade de vagas são definidos em <a href="cadastros.html">Cadastros</a>.');
  }
  el.aviso.hidden = true;
  el.painel.hidden = false;

  const foco = capturarFoco();
  if (estado.modo === 'semana') renderSemana(); else renderMes();
  if (estado.diaAberto) renderDialogo();
  restaurarFoco(foco);

  document.querySelectorAll('.alternador button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.modo === estado.modo));
  });
}

function tipoPrincipal(marcos) {
  return marcos[0]?.tipo;
}

function htmlMarcos(marcos) {
  if (!marcos.length) return '';
  return `<ul class="marcos">${marcos.map((m) => `
    <li class="marco marco-${m.tipo}"><span class="marco-tipo">${ROTULO_TIPO[m.tipo]}</span> ${escapeHtml(m.nome)}</li>`).join('')}
  </ul>`;
}

function medidor(c) {
  const pct = c.total ? Math.round((c.cobertas / c.total) * 100) : 0;
  const cls = c.cobertas >= c.total ? 'completo' : '';
  return `<span class="medidor ${cls}" aria-hidden="true"><span style="width:${pct}%"></span></span>`;
}

function htmlContDia(c) {
  const fracao = `<span class="dia-fracao">${c.cobertas}/${c.total}</span>`;
  if (!c.descobertas) return `${fracao}<span class="selo selo-ok">Completo</span>`;
  return `${fracao}<span class="selo selo-furo">${plural(c.descobertas, 'descoberta', 'descobertas')}</span>`;
}

function htmlVaga(iso, t, i, v, alertas, travado, rotDia) {
  const chave = `${iso}|${t.id}|${i}`;
  const temNome = Boolean(v.nome.trim());
  const situacao = v.faltou ? 'faltou' : temNome ? 'ocupada' : 'descoberta';
  const cls = ['vaga', situacao, alertas.length ? 'conflito' : '',
    v.coberta && !v.tipo ? 'pendente' : ''].filter(Boolean).join(' ');
  const dis = travado ? 'disabled' : '';
  const acoes = temNome ? `
    <div class="tipo" role="group" aria-label="${escapeHtml(v.nome)}">
      ${v.coberta && !v.tipo ? '<span class="tipo-pergunta">Fixo ou freelancer?</span>' : ''}
      <button type="button" data-tipo-vaga="${chave}" data-valor="fixo" aria-pressed="${v.tipo === 'fixo'}" ${dis}>Fixo</button>
      <button type="button" data-tipo-vaga="${chave}" data-valor="freelancer" aria-pressed="${v.tipo === 'freelancer'}" aria-label="Freelancer" ${dis}>Freela</button>
      <button type="button" class="btn-faltou" data-faltou="${iso}|${t.id}" data-nome="${escapeHtml(v.nome)}" aria-pressed="${v.faltou}" ${dis}>Faltou</button>
    </div>` : '';
  return `<div class="${cls}">
    <input type="text" list="listaColaboradores" autocomplete="off" spellcheck="false" enterkeyhint="next"
      value="${escapeHtml(v.nome)}" placeholder="Descoberta"
      aria-label="${escapeHtml(t.nome)}, vaga ${i + 1}, ${rotDia}"
      data-chave="${chave}" data-foco="v|${chave}" ${dis}>
    ${v.faltou ? '<p class="vaga-furo">Faltou. A vaga está descoberta.</p>' : ''}
    ${acoes}
    ${alertas.map((a) => `<p class="vaga-alerta">${escapeHtml(a)}</p>`).join('')}
  </div>`;
}

function htmlAusencias(iso, t, ind, travado, rotDia) {
  const folgas = listaDoTurno(iso, 'folgas', t.id);
  const faltas = listaDoTurno(iso, 'faltas', t.id);
  const dis = travado ? 'disabled' : '';
  const alertas = [];
  const chip = (nome, campo) => {
    const a = campo === 'folgas' ? alertaFolga(ind, t, nome) : '';
    if (a) alertas.push(a);
    return `<li class="aus aus-${campo}${a ? ' conflito' : ''}">
      <span class="aus-tipo">${campo === 'folgas' ? 'Folga' : 'Falta'}</span>
      <span class="aus-nome">${escapeHtml(nome)}</span>
      <button type="button" data-remover-aus="${campo}|${iso}|${t.id}" data-nome="${escapeHtml(nome)}"
        aria-label="Retirar ${campo === 'folgas' ? 'folga' : 'falta'} de ${escapeHtml(nome)}" ${dis}>×</button>
    </li>`;
  };
  const total = folgas.length + faltas.length;
  return `<div class="ausencias">
    <p class="aus-rot">Folgas e faltas${total ? ` (${total})` : ''}</p>
    ${total ? `<ul class="aus-lista">${faltas.map((n) => chip(n, 'faltas')).join('')}${folgas.map((n) => chip(n, 'folgas')).join('')}</ul>` : ''}
    ${alertas.map((a) => `<p class="vaga-alerta">${escapeHtml(a)}</p>`).join('')}
    <div class="aus-add">
      <input type="text" list="listaColaboradores" autocomplete="off" spellcheck="false" enterkeyhint="done"
        placeholder="Nome" aria-label="Nome para lançar folga ou falta em ${escapeHtml(t.nome)}, ${rotDia}"
        data-aus="${iso}|${t.id}" data-foco="a|${iso}|${t.id}" ${dis}>
      <button type="button" data-lancar="folgas" ${dis}>Folga</button>
      <button type="button" data-lancar="faltas" ${dis}>Falta</button>
    </div>
  </div>`;
}

function htmlDia(d) {
  const iso = isoDate(d);
  const dow = d.getDay();
  const turnos = turnosDoDia(d);
  if (!turnos.length) return '<p class="dia-vazio">Sem turnos neste dia</p>';
  const ind = indiceDoDia(iso);
  const travado = !estado.escalasProntas;
  const rotDia = `${DIAS_LONGO[dow]} ${d.getDate()}`;

  return turnos.map((t) => {
    const n = vagasNoDia(t, dow);
    const situacao = situacaoVagas(iso, t, dow);
    const cobertas = situacao.filter((v) => v.coberta).length;
    const htmlVagas = situacao
      .map((v, i) => htmlVaga(iso, t, i, v, alertasVaga(ind, t, i, v.nome), travado, rotDia)).join('');
    const extras = vagasSalvas(iso, t.id).map((v, i) => ({ ...v, i })).slice(n).filter((v) => v.nome.trim());
    const htmlExtras = extras.length ? `<div class="extras">
      <p>Acima das vagas cadastradas</p>
      ${extras.map((x) => `<div class="extra"><span>${escapeHtml(x.nome)}</span>
        <button type="button" class="btn-texto" data-liberar="${iso}|${t.id}|${x.i}">Remover</button></div>`).join('')}
    </div>` : '';
    const cont = n ? `<span class="turno-cont ${cobertas >= n ? 'completo' : 'incompleto'}">${cobertas}/${n}</span>` : '';

    return `<section class="turno faixa-${faixaDoDia(t.inicio)}">
      <header class="turno-cab">
        <span class="turno-nome">${escapeHtml(t.nome)}</span>
        <span class="turno-hora">${t.inicio}–${t.fim}</span>
        ${cont}
      </header>
      <div class="vagas">${htmlVagas}</div>
      ${htmlExtras}
      ${htmlAusencias(iso, t, ind, travado, rotDia)}
    </section>`;
  }).join('');
}

function somar(tot, c, futuro) {
  tot.total += c.total;
  tot.cobertas += c.cobertas;
  tot.pendentes += c.pendentes;
  tot.freelas += c.freelas;
  tot.faltas += c.faltas;
  if (futuro) tot.descobertas += c.descobertas;
}
const totalZerado = () => ({ total: 0, cobertas: 0, descobertas: 0, pendentes: 0, freelas: 0, faltas: 0 });

function htmlResumo(tot, incluiHoje) {
  if (!estado.escalasProntas) return 'Carregando escala…';
  if (!tot.total) return 'Nenhuma vaga neste período';
  let html = `<span>${tot.cobertas} de ${tot.total} vagas cobertas</span>`;
  if (tot.descobertas) {
    html += ` <span class="pilula pilula-furo">${plural(tot.descobertas, 'descoberta', 'descobertas')}${incluiHoje ? ' a partir de hoje' : ''}</span>`;
  }
  if (tot.faltas) html += ` <span class="pilula pilula-falta">${plural(tot.faltas, 'falta', 'faltas')}</span>`;
  if (tot.pendentes) html += ` <span class="pilula pilula-pendente">${tot.pendentes} sem confirmar fixo ou freela</span>`;
  if (tot.freelas) html += ` <span class="pilula">${plural(tot.freelas, 'freelancer', 'freelancers')}</span>`;
  return html;
}

function tituloSemana(ini, fim) {
  if (ini.getMonth() === fim.getMonth()) return `${ini.getDate()} a ${fim.getDate()} de ${MESES[fim.getMonth()]}`;
  return `${ini.getDate()} de ${MESES[ini.getMonth()]} a ${fim.getDate()} de ${MESES[fim.getMonth()]}`;
}

function classesDia(base, iso, hoje, marcos, c) {
  return [base, iso === hoje ? 'hoje' : '', iso < hoje ? 'passado' : '',
    c.descobertas ? 'com-furo' : '', marcos.length ? `tem-${tipoPrincipal(marcos)}` : '']
    .filter(Boolean).join(' ');
}

function renderSemana() {
  const { ini, fim } = faixaPeriodo();
  const hoje = hojeIso();
  const tot = totalZerado();
  const dias = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(ini, i);
    const iso = isoDate(d);
    const c = contagemDia(d);
    somar(tot, c, iso >= hoje);
    return { d, iso, c, marcos: marcosDoDia(iso, estado.cfg.datasEspeciais) };
  });

  if (TELA_COMPACTA.matches) {
    // Celular: faixa com os 7 dias e um dia aberto por vez
    if (!dias.some((x) => x.iso === estado.diaSel)) {
      estado.diaSel = dias.some((x) => x.iso === hoje) ? hoje : dias[0].iso;
    }
    const faixa = dias.map(({ d, iso, c, marcos }) => {
      const sel = iso === estado.diaSel;
      const marca = !c.total ? '' : c.descobertas
        ? `<span class="cd-marca furo">${c.descobertas}</span>`
        : '<span class="cd-marca ok" aria-hidden="true">✓</span>';
      const rot = [`${DIAS_LONGO[d.getDay()]} ${d.getDate()}`, marcos[0] ? marcos[0].nome : '',
        c.total ? (c.descobertas ? plural(c.descobertas, 'vaga descoberta', 'vagas descobertas') : 'completo') : 'sem turnos']
        .filter(Boolean).join(', ');
      return `<button type="button" role="tab" class="${classesDia('chip-dia', iso, hoje, marcos, c)}${sel ? ' sel' : ''}"
        data-dia="${iso}" aria-selected="${sel}" aria-label="${escapeHtml(rot)}">
        <span class="cd-sem">${iso === hoje ? 'Hoje' : DIAS_CURTO[d.getDay()]}</span>
        <span class="cd-num">${d.getDate()}</span>
        ${marca}
      </button>`;
    }).join('');
    const x = dias.find((y) => y.iso === estado.diaSel);
    el.quadro.className = 'quadro-dia';
    el.quadro.innerHTML = `<div class="faixa-dias" role="tablist" aria-label="Dias da semana">${faixa}</div>
      <article class="${classesDia('dia dia-unico', x.iso, hoje, x.marcos, x.c)}">
        <header class="dia-cab">
          <h2 class="dia-titulo">${DIAS_LONGO[x.d.getDay()]}, ${x.d.getDate()} de ${MESES[x.d.getMonth()]}</h2>
          ${x.c.total ? `<span class="dia-cont">${htmlContDia(x.c)}</span>` : ''}
        </header>
        ${htmlMarcos(x.marcos)}
        ${x.c.total ? medidor(x.c) : ''}
        <div class="dia-corpo">${htmlDia(x.d)}</div>
      </article>`;
  } else {
    el.quadro.className = 'quadro-semana';
    el.quadro.innerHTML = dias.map(({ d, iso, c, marcos }) => `
      <article class="${classesDia('dia', iso, hoje, marcos, c)}">
        <header class="dia-cab">
          <span class="dia-num">${d.getDate()}</span>
          <span class="dia-info">
            <span class="dia-sem">${DIAS_CURTO[d.getDay()]}${iso === hoje ? ', hoje' : ''}</span>
            ${c.total ? `<span class="dia-cont">${htmlContDia(c)}</span>` : ''}
          </span>
        </header>
        ${htmlMarcos(marcos)}
        ${c.total ? medidor(c) : ''}
        <div class="dia-corpo">${htmlDia(d)}</div>
      </article>`).join('');
  }
  el.titulo.textContent = tituloSemana(ini, fim);
  el.resumo.innerHTML = htmlResumo(tot, hoje >= isoDate(ini) && hoje <= isoDate(fim));
}

// Quem está escalado em cada turno, para a visão mensal.
// Vaga descoberta aparece em vermelho, na posição em que está.
function htmlEscalados(d) {
  const iso = isoDate(d);
  const dow = d.getDay();
  const turnos = ordenaTurnos(turnosDoHub().filter((t) => vagasNoDia(t, dow) > 0));
  if (!turnos.length) return '';
  const soUmTurno = turnos.length === 1;
  return `<span class="nomes">${turnos.map((t) => {
    const vagas = situacaoVagas(iso, t, dow);
    const nomes = vagas.filter((v) => v.coberta)
      .map((v) => `<span class="n-ok${v.tipo === 'freelancer' ? ' freela' : ''}">${escapeHtml(v.nome)}</span>`).join('');
    const furos = vagas.filter((v) => !v.coberta).length;
    const cobertas = vagas.length - furos;
    return `<span class="nomes-turno faixa-${faixaDoDia(t.inicio)}">
      ${soUmTurno ? '' : `<span class="nt-rot"><span class="nt-nome">${escapeHtml(t.nome)}</span>
        <span class="nt-cont ${furos ? 'incompleto' : 'completo'}">${cobertas}/${vagas.length}</span></span>`}
      <span class="nt-lista">${nomes}${furos
        ? `<span class="n-furo">${plural(furos, 'descoberta', 'descobertas')}</span>` : ''}</span>
    </span>`;
  }).join('')}</span>`;
}

// Versão compacta para o celular: um quadradinho por vaga, agrupado por turno
function htmlPontos(d) {
  const iso = isoDate(d);
  const dow = d.getDay();
  const turnos = ordenaTurnos(turnosDoHub().filter((t) => vagasNoDia(t, dow) > 0));
  if (!turnos.length) return '';
  return `<span class="pontos" aria-hidden="true">${turnos.map((t) => `<span class="pontos-turno">${
    situacaoVagas(iso, t, dow).map((v) => `<i class="${v.coberta ? 'p-ok' : 'p-furo'}"></i>`).join('')
  }</span>`).join('')}</span>`;
}

function renderMes() {
  const { ini, fim, primeiro } = faixaPeriodo();
  const hoje = hojeIso();
  const tot = totalZerado();
  let celulas = '';
  for (let d = ini; d <= fim; d = addDays(d, 1)) {
    if (d.getMonth() !== primeiro.getMonth()) { celulas += '<div class="cel fora" aria-hidden="true"></div>'; continue; }
    const iso = isoDate(d);
    const c = contagemDia(d);
    somar(tot, c, iso >= hoje);
    const marcos = marcosDoDia(iso, estado.cfg.datasEspeciais);
    const rotulo = [`${DIAS_LONGO[d.getDay()]}, ${d.getDate()}`,
      ...marcos.map((m) => `${ROTULO_TIPO[m.tipo]}: ${m.nome}`),
      c.total ? `${c.cobertas} de ${c.total} vagas cobertas` : 'sem turnos',
      c.descobertas ? plural(c.descobertas, 'vaga descoberta', 'vagas descobertas') : '',
      c.faltas ? plural(c.faltas, 'falta', 'faltas') : ''].filter(Boolean).join('. ');
    celulas += `<button type="button" class="${classesDia('cel', iso, hoje, marcos, c)}" data-abrir="${iso}" aria-label="${escapeHtml(rotulo)}">
      <span class="cel-topo">
        <span class="cel-num">${d.getDate()}</span>
        ${c.descobertas ? `<span class="cel-furo" aria-hidden="true">${c.descobertas}</span>`
          : c.total ? '<span class="cel-ok" aria-hidden="true">Completo</span>' : ''}
      </span>
      ${marcos.length ? `<span class="cel-marco">${escapeHtml(marcos[0].nome)}</span>` : ''}
      ${htmlEscalados(d)}
      ${htmlPontos(d)}
    </button>`;
  }
  el.quadro.className = 'quadro-mes';
  el.quadro.innerHTML = `<div class="mes-sem" aria-hidden="true">${DIAS_CURTO.map((x) => `<span>${x}</span>`).join('')}</div>
    <div class="mes-grade">${celulas}</div>
    <p class="mes-legenda">
      <span class="leg-nomes">Nomes em cinza são freelancers. Toque num dia para lançar a escala.</span>
      <span class="leg-pontos"><i class="p-ok"></i> Vaga coberta <i class="p-furo"></i> Vaga descoberta</span>
    </p>`;
  el.titulo.textContent = `${capitalizar(MESES[primeiro.getMonth()])} de ${primeiro.getFullYear()}`;
  const mesAtual = hoje.slice(0, 7) === isoDate(primeiro).slice(0, 7);
  el.resumo.innerHTML = htmlResumo(tot, mesAtual);
}

// ================= dia aberto (visão mensal) =================
function abrirDia(iso) {
  estado.diaAberto = iso;
  renderDialogo();
  if (!el.dlg.open) el.dlg.showModal();
}

function renderDialogo() {
  const d = parseIso(estado.diaAberto);
  const c = contagemDia(d);
  const marcos = marcosDoDia(estado.diaAberto, estado.cfg.datasEspeciais);
  el.dlgTitulo.textContent = `${DIAS_LONGO[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]}`;
  el.dlgCorpo.innerHTML = `${htmlMarcos(marcos)}
    ${c.total ? `<p class="dlg-resumo">${htmlContDia(c)}</p>` : ''}
    ${htmlDia(d)}`;
}

// ================= foco (a tela se atualiza sozinha quando alguém salva) =================
function capturarFoco() {
  const a = document.activeElement;
  if (!a?.dataset?.foco) return null;
  return { chave: a.dataset.foco, valor: a.value, ini: a.selectionStart, fim: a.selectionEnd };
}
function restaurarFoco(f) {
  if (!f) return;
  const i = document.querySelector(`[data-foco="${CSS.escape(f.chave)}"]`);
  if (!i) return;
  i.value = f.valor;
  i.focus({ preventScroll: true });
  try { i.setSelectionRange(f.ini, f.fim); } catch { /* campo sem seleção */ }
}

// ================= gravação =================
async function gravar(acao, msgOk) {
  mostrarStatus('Salvando…', 'neutro', true);
  try {
    await acao();
    mostrarStatus(msgOk);
  } catch (err) { erroGravacao(err); }
}

function gravarVaga(iso, turnoId, idx, dados, msgOk) {
  return gravar(() => salvarVaga(estado.hubId, iso, turnoId, idx, dados, nomeSupervisor()), msgOk);
}

function salvarNome(input) {
  const [iso, turnoId, idx] = input.dataset.chave.split('|');
  const nome = limparNome(input.value);
  input.value = nome;
  const atual = vagasSalvas(iso, turnoId)[Number(idx)] || { nome: '', tipo: '' };
  if (nome === atual.nome) return;
  // Pessoa nova na vaga: o tipo precisa ser confirmado de novo
  gravarVaga(iso, turnoId, Number(idx), { nome, tipo: '' },
    nome ? 'Salvo. Confirme se é fixo ou freelancer.' : 'Vaga liberada');
}

// Nome como já está gravado na lista (para retirar exatamente o mesmo texto)
function nomeNaLista(iso, campo, turnoId, nome) {
  return listaDoTurno(iso, campo, turnoId).find((x) => normalizaNome(x) === normalizaNome(nome));
}

function lancar(input, campo) {
  const nome = limparNome(input.value);
  const tipo = campo === 'folgas' ? 'folga' : 'falta';
  if (!nome) {
    mostrarStatus(`Digite o nome antes de lançar a ${tipo}`, 'neutro');
    input.focus();
    return;
  }
  const [iso, turnoId] = input.dataset.aus.split('|');
  input.value = '';
  if (nomeNaLista(iso, campo, turnoId, nome)) {
    mostrarStatus(`${nome} já tem ${tipo} lançada neste turno`, 'neutro');
    return;
  }
  const noOutro = nomeNaLista(iso, campo === 'folgas' ? 'faltas' : 'folgas', turnoId, nome);
  gravar(() => lancarAusencia(estado.hubId, iso, turnoId, noOutro || nome, campo, nomeSupervisor()),
    `${capitalizar(tipo)} lançada para ${nome}`);
}

// ================= eventos =================
el.selSup.addEventListener('change', () => {
  estado.supId = el.selSup.value;
  estado.hubId = '';
  renderSeletores();
  render();
});
el.selHub.addEventListener('change', () => {
  estado.hubId = el.selHub.value;
  atualizarDatalist();
  atualizarUrl();
  render();
});

function mudarPeriodo(passo) {
  if (estado.modo === 'semana') estado.ref = addDays(estado.ref, passo * 7);
  else estado.ref = new Date(estado.ref.getFullYear(), estado.ref.getMonth() + passo, 1);
  estado.diaSel = null;
  assinarEscalas();
  render();
}
$('#btnAnterior').addEventListener('click', () => mudarPeriodo(-1));
$('#btnProximo').addEventListener('click', () => mudarPeriodo(1));
$('#btnHoje').addEventListener('click', () => {
  estado.ref = new Date();
  estado.diaSel = null;
  assinarEscalas();
  render();
});

TELA_COMPACTA.addEventListener('change', () => render());

$('#dlgFechar').addEventListener('click', () => el.dlg.close());
el.dlg.addEventListener('close', () => { estado.diaAberto = null; });
el.dlg.addEventListener('click', (e) => { if (e.target === el.dlg) el.dlg.close(); });

document.addEventListener('input', (e) => {
  const i = e.target;
  if (!i.matches?.('input[data-chave]')) return;
  const vaga = i.closest('.vaga');
  if (!vaga || vaga.classList.contains('faltou')) return;
  const tem = Boolean(i.value.trim());
  vaga.classList.toggle('ocupada', tem);
  vaga.classList.toggle('descoberta', !tem);
});

document.addEventListener('change', (e) => {
  if (e.target.matches?.('input[data-chave]')) salvarNome(e.target);
});

// Enter na vaga pula para a próxima
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const i = e.target;
  if (i.matches?.('input[data-chave]')) {
    e.preventDefault();
    const campos = [...document.querySelectorAll('input[data-chave]:not([disabled])')]
      .filter((x) => x.offsetParent !== null);
    const prox = campos[campos.indexOf(i) + 1];
    if (prox) prox.focus(); else i.blur();
  } else if (i.matches?.('input[data-aus]')) {
    e.preventDefault();
    i.blur();
  }
});

document.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const ds = b.dataset;
  if (ds.tipoVaga) {
    const [iso, turnoId, idx] = ds.tipoVaga.split('|');
    gravarVaga(iso, turnoId, Number(idx), { tipo: ds.valor },
      ds.valor === 'fixo' ? 'Marcado como fixo' : 'Marcado como freelancer');
  } else if (ds.faltou) {
    const [iso, turnoId] = ds.faltou.split('|');
    const registrado = nomeNaLista(iso, 'faltas', turnoId, ds.nome);
    if (registrado) {
      gravar(() => removerAusencia(estado.hubId, iso, turnoId, registrado, 'faltas', nomeSupervisor()), 'Falta retirada');
    } else {
      const deFolga = nomeNaLista(iso, 'folgas', turnoId, ds.nome);
      gravar(() => lancarAusencia(estado.hubId, iso, turnoId, deFolga || ds.nome, 'faltas', nomeSupervisor()),
        `Falta lançada para ${ds.nome}`);
    }
  } else if (ds.lancar) {
    lancar(b.closest('.aus-add').querySelector('input'), ds.lancar);
  } else if (ds.removerAus) {
    const [campo, iso, turnoId] = ds.removerAus.split('|');
    gravar(() => removerAusencia(estado.hubId, iso, turnoId, ds.nome, campo, nomeSupervisor()),
      campo === 'folgas' ? 'Folga retirada' : 'Falta retirada');
  } else if (ds.liberar) {
    const [iso, turnoId, idx] = ds.liberar.split('|');
    gravarVaga(iso, turnoId, Number(idx), { nome: '', tipo: '' }, 'Removido');
  } else if (ds.dia) {
    estado.diaSel = ds.dia;
    render();
    document.querySelector('.dia-unico')?.scrollIntoView({ block: 'nearest' });
  } else if (ds.abrir) {
    abrirDia(ds.abrir);
  } else if (ds.modo && ds.modo !== estado.modo) {
    estado.modo = ds.modo;
    atualizarUrl();
    assinarEscalas();
    render();
  }
});

// ================= início =================
if (!configuracaoPronta()) {
  el.selSup.disabled = true;
  mostrarAviso('Falta conectar o Firebase',
    'Preencha o arquivo <code>firebase-config.js</code> com os dados do seu projeto. O passo a passo está no README.');
} else {
  el.selSup.innerHTML = '<option>Carregando…</option>';
  el.selSup.disabled = true;
  ouvirConfig((cfg) => {
    estado.cfg = cfg;
    el.selSup.disabled = false;
    renderSeletores();
    assinarEscalas();
    render();
  }, erroLeitura);
}
