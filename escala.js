// Página 2 — Escala: o supervisor escolhe seu nome e o hub e preenche as vagas.
import { configuracaoPronta, ouvirConfig, ouvirEscalas, salvarVaga, alterarFolga } from './db.js';
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
  diaAberto: null,
  rolouHoje: false,
  expandidos: new Set() // dias passados abertos no celular
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
const vagasDoTurno = (iso, turnoId) => vagasDe(docDia(iso)?.slots?.[turnoId]);
const folgasDoTurno = (iso, turnoId) => docDia(iso)?.folgas?.[turnoId] || [];
const nomeSupervisor = () => estado.cfg.supervisores.find((s) => s.id === estado.supId)?.nome || '';

function turnosDoDia(d) {
  const iso = isoDate(d);
  const dow = d.getDay();
  return ordenaTurnos(estado.cfg.turnos.filter((t) => t.hubId === estado.hubId && (
    vagasNoDia(t, dow) > 0
    || vagasDoTurno(iso, t.id).some((v) => v.nome.trim())
    || folgasDoTurno(iso, t.id).length > 0
  )));
}

function contagemDia(d) {
  const iso = isoDate(d);
  const dow = d.getDay();
  const c = { total: 0, preench: 0, descobertas: 0, pendentes: 0, freelas: 0 };
  for (const t of estado.cfg.turnos) {
    if (t.hubId !== estado.hubId) continue;
    const n = vagasNoDia(t, dow);
    if (!n) continue;
    c.total += n;
    for (const v of vagasDoTurno(iso, t.id).slice(0, n)) {
      if (!v.nome.trim()) continue;
      c.preench++;
      if (!v.tipo) c.pendentes++;
      if (v.tipo === 'freelancer') c.freelas++;
    }
  }
  c.descobertas = c.total - c.preench;
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
  return esc.length ? `${limparNome(nome)} está escalado em ${esc.map(onde).join('; ')}` : '';
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
  if (!estado.cfg.turnos.some((t) => t.hubId === estado.hubId)) {
    return mostrarAviso('Este hub ainda não tem turnos',
      'Os turnos e a quantidade de vagas são definidos em <a href="cadastros.html">Cadastros</a>.');
  }
  el.aviso.hidden = true;
  el.painel.hidden = false;

  const foco = capturarFoco();
  const rolagem = el.quadro.scrollLeft;
  if (estado.modo === 'semana') renderSemana(); else renderMes();
  el.quadro.scrollLeft = rolagem;
  if (estado.diaAberto) renderDialogo();
  restaurarFoco(foco);

  document.querySelectorAll('.alternador button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.modo === estado.modo));
  });

  // Na primeira vez, rola o quadro da semana até o dia de hoje (telas largas)
  if (estado.modo === 'semana' && !estado.rolouHoje) {
    const hoje = el.quadro.querySelector('.dia.hoje');
    if (hoje) { el.quadro.scrollLeft = hoje.offsetLeft - 1; estado.rolouHoje = true; }
  }
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
  const pct = c.total ? Math.round((Math.min(c.preench, c.total) / c.total) * 100) : 0;
  const cls = c.preench >= c.total ? 'completo' : '';
  return `<span class="medidor ${cls}" aria-hidden="true"><span style="width:${pct}%"></span></span>`;
}

function htmlContDia(c, passado) {
  const fracao = `<span class="dia-fracao">${c.preench}/${c.total}</span>`;
  if (!c.descobertas) return `${fracao}<span class="selo selo-ok">Completo</span>`;
  return `${fracao}<span class="selo ${passado ? 'selo-passado' : 'selo-falta'}">${plural(c.descobertas, 'descoberta', 'descobertas')}</span>`;
}

function htmlVaga(iso, t, i, v, alertas, travado, rotDia) {
  const chave = `${iso}|${t.id}|${i}`;
  const ocupada = Boolean(v.nome.trim());
  const cls = ['vaga', ocupada ? 'ocupada' : 'descoberta', alertas.length ? 'conflito' : '',
    ocupada && !v.tipo ? 'pendente' : ''].filter(Boolean).join(' ');
  const dis = travado ? 'disabled' : '';
  const tipo = ocupada ? `
    <div class="tipo" role="group" aria-label="${escapeHtml(v.nome)} é fixo ou freelancer?">
      ${v.tipo ? '' : '<span class="tipo-pergunta">Fixo ou freelancer?</span>'}
      <button type="button" data-tipo-vaga="${chave}" data-valor="fixo" aria-pressed="${v.tipo === 'fixo'}" ${dis}>Fixo</button>
      <button type="button" data-tipo-vaga="${chave}" data-valor="freelancer" aria-pressed="${v.tipo === 'freelancer'}" ${dis}>Freelancer</button>
    </div>` : '';
  return `<div class="${cls}">
    <input type="text" list="listaColaboradores" autocomplete="off" spellcheck="false"
      value="${escapeHtml(v.nome)}" placeholder="Descoberta"
      aria-label="${escapeHtml(t.nome)}, vaga ${i + 1}, ${rotDia}"
      data-chave="${chave}" data-foco="v|${chave}" ${dis}>
    ${tipo}
    ${alertas.map((a) => `<p class="vaga-alerta">${escapeHtml(a)}</p>`).join('')}
  </div>`;
}

function htmlFolgas(iso, t, ind, travado, rotDia) {
  const folgas = folgasDoTurno(iso, t.id);
  const dis = travado ? 'disabled' : '';
  const alertas = [];
  const chips = folgas.map((nome) => {
    const a = alertaFolga(ind, t, nome);
    if (a) alertas.push(a);
    return `<li class="folga${a ? ' conflito' : ''}">
      <span>${escapeHtml(nome)}</span>
      <button type="button" data-tirar-folga="${iso}|${t.id}" data-nome="${escapeHtml(nome)}"
        aria-label="Tirar ${escapeHtml(nome)} das folgas" ${dis}>×</button>
    </li>`;
  }).join('');
  return `<div class="folgas">
    <p class="folgas-rot">Folgas${folgas.length ? ` (${folgas.length})` : ''}</p>
    ${folgas.length ? `<ul class="folgas-lista">${chips}</ul>` : ''}
    ${alertas.map((a) => `<p class="vaga-alerta">${escapeHtml(a)}</p>`).join('')}
    <input type="text" class="folga-input" list="listaColaboradores" autocomplete="off" spellcheck="false"
      placeholder="Adicionar folga" aria-label="Adicionar folga em ${escapeHtml(t.nome)}, ${rotDia}"
      data-folga="${iso}|${t.id}" data-foco="f|${iso}|${t.id}" ${dis}>
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
    const vagas = vagasDoTurno(iso, t.id);
    const ocupadas = vagas.slice(0, n).filter((v) => v.nome.trim()).length;
    let htmlVagas = '';
    for (let i = 0; i < n; i++) {
      const v = vagas[i] || { nome: '', tipo: '' };
      htmlVagas += htmlVaga(iso, t, i, v, alertasVaga(ind, t, i, v.nome), travado, rotDia);
    }
    const extras = vagas.map((v, i) => ({ ...v, i })).slice(n).filter((v) => v.nome.trim());
    const htmlExtras = extras.length ? `<div class="extras">
      <p>Acima das vagas cadastradas</p>
      ${extras.map((x) => `<div class="extra"><span>${escapeHtml(x.nome)}</span>
        <button type="button" class="btn-texto" data-liberar="${iso}|${t.id}|${x.i}">Remover</button></div>`).join('')}
    </div>` : '';
    const cont = n ? `<span class="turno-cont ${ocupadas >= n ? 'completo' : 'incompleto'}">${ocupadas}/${n}</span>` : '';

    return `<section class="turno faixa-${faixaDoDia(t.inicio)}">
      <header class="turno-cab">
        <span class="turno-nome">${escapeHtml(t.nome)}</span>
        <span class="turno-hora">${t.inicio}–${t.fim}</span>
        ${cont}
      </header>
      <div class="vagas">${htmlVagas}</div>
      ${htmlExtras}
      ${htmlFolgas(iso, t, ind, travado, rotDia)}
    </section>`;
  }).join('');
}

function somar(tot, c, futuro) {
  tot.total += c.total;
  tot.preench += c.preench;
  tot.pendentes += c.pendentes;
  tot.freelas += c.freelas;
  if (futuro) tot.descobertas += c.descobertas;
}

function htmlResumo(tot, incluiHoje) {
  if (!estado.escalasProntas) return 'Carregando escala…';
  if (!tot.total) return 'Nenhuma vaga neste período';
  let html = `${tot.preench} de ${tot.total} vagas preenchidas`;
  if (tot.descobertas) {
    html += ` <span class="pilula pilula-falta">${plural(tot.descobertas, 'descoberta', 'descobertas')}${incluiHoje ? ' a partir de hoje' : ''}</span>`;
  }
  if (tot.pendentes) html += ` <span class="pilula pilula-pendente">${tot.pendentes} sem confirmar fixo ou freelancer</span>`;
  if (tot.freelas) html += ` <span class="pilula">${plural(tot.freelas, 'freelancer', 'freelancers')}</span>`;
  return html;
}

function tituloSemana(ini, fim) {
  if (ini.getMonth() === fim.getMonth()) return `${ini.getDate()} a ${fim.getDate()} de ${MESES[fim.getMonth()]}`;
  return `${ini.getDate()} de ${MESES[ini.getMonth()]} a ${fim.getDate()} de ${MESES[fim.getMonth()]}`;
}

function renderSemana() {
  const { ini, fim } = faixaPeriodo();
  const hoje = hojeIso();
  const tot = { total: 0, preench: 0, descobertas: 0, pendentes: 0, freelas: 0 };
  const estreito = matchMedia('(max-width: 760px)').matches;
  let colunas = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(ini, i);
    const iso = isoDate(d);
    const c = contagemDia(d);
    const passado = iso < hoje;
    somar(tot, c, !passado);
    const marcos = marcosDoDia(iso, estado.cfg.datasEspeciais);
    // No celular, dias que já passaram ficam recolhidos para o de hoje aparecer logo
    const recolhivel = estreito && passado;
    const recolhido = recolhivel && !estado.expandidos.has(iso);
    const classes = ['dia', iso === hoje ? 'hoje' : '', passado ? 'passado' : '', recolhido ? 'recolhido' : '',
      marcos.length ? `tem-${tipoPrincipal(marcos)}` : ''].filter(Boolean).join(' ');
    colunas += `<article class="${classes}">
      <header class="dia-cab">
        <span class="dia-num">${d.getDate()}</span>
        <span class="dia-info">
          <span class="dia-sem">${DIAS_CURTO[d.getDay()]}${iso === hoje ? ', hoje' : ''}</span>
          ${c.total ? `<span class="dia-cont">${htmlContDia(c, passado)}</span>` : ''}
        </span>
        ${recolhivel ? `<button type="button" class="btn-texto dia-expandir" data-expandir="${iso}" aria-expanded="${!recolhido}">${recolhido ? 'Ver turnos' : 'Ocultar'}</button>` : ''}
      </header>
      ${htmlMarcos(marcos)}
      ${c.total ? medidor(c) : ''}
      <div class="dia-corpo">${htmlDia(d)}</div>
    </article>`;
  }
  el.quadro.className = 'quadro-semana';
  el.quadro.innerHTML = colunas;
  el.titulo.textContent = tituloSemana(ini, fim);
  el.resumo.innerHTML = htmlResumo(tot, hoje >= isoDate(ini) && hoje <= isoDate(fim));
}

function renderMes() {
  const { ini, fim, primeiro } = faixaPeriodo();
  const hoje = hojeIso();
  const tot = { total: 0, preench: 0, descobertas: 0, pendentes: 0, freelas: 0 };
  let celulas = '';
  for (let d = ini; d <= fim; d = addDays(d, 1)) {
    if (d.getMonth() !== primeiro.getMonth()) { celulas += '<div class="cel fora" aria-hidden="true"></div>'; continue; }
    const iso = isoDate(d);
    const c = contagemDia(d);
    const passado = iso < hoje;
    somar(tot, c, !passado);
    const marcos = marcosDoDia(iso, estado.cfg.datasEspeciais);
    const falta = c.descobertas && !passado;
    const classes = ['cel', iso === hoje ? 'hoje' : '', passado ? 'passado' : '', falta ? 'com-falta' : '',
      marcos.length ? `tem-${tipoPrincipal(marcos)}` : ''].filter(Boolean).join(' ');
    const rotulo = [`${DIAS_LONGO[d.getDay()]}, ${d.getDate()}`,
      ...marcos.map((m) => `${ROTULO_TIPO[m.tipo]}: ${m.nome}`),
      c.total ? `${c.preench} de ${c.total} vagas preenchidas` : 'sem turnos',
      falta ? plural(c.descobertas, 'vaga descoberta', 'vagas descobertas') : ''].filter(Boolean).join('. ');
    celulas += `<button type="button" class="${classes}" data-abrir="${iso}" aria-label="${escapeHtml(rotulo)}">
      <span class="cel-topo">
        <span class="cel-num">${d.getDate()}</span>
        ${falta ? `<span class="cel-falta" aria-hidden="true">${c.descobertas}</span>` : ''}
      </span>
      ${marcos.length ? `<span class="cel-marco">${escapeHtml(marcos[0].nome)}</span>` : ''}
      ${c.total ? `${medidor(c)}<span class="cel-cont">${c.preench}/${c.total}</span>` : ''}
    </button>`;
  }
  el.quadro.className = 'quadro-mes';
  el.quadro.innerHTML = `<div class="mes-sem" aria-hidden="true">${DIAS_CURTO.map((x) => `<span>${x}</span>`).join('')}</div>
    <div class="mes-grade">${celulas}</div>`;
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
    ${c.total ? `<p class="dlg-resumo">${htmlContDia(c, estado.diaAberto < hojeIso())}</p>` : ''}
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
async function gravarVaga(iso, turnoId, idx, dados, msgOk) {
  mostrarStatus('Salvando…', 'neutro', true);
  try {
    await salvarVaga(estado.hubId, iso, turnoId, idx, dados, nomeSupervisor());
    mostrarStatus(msgOk);
  } catch (err) { erroGravacao(err); }
}

function salvarNome(input) {
  const [iso, turnoId, idx] = input.dataset.chave.split('|');
  const nome = limparNome(input.value);
  input.value = nome;
  const atual = vagasDoTurno(iso, turnoId)[Number(idx)] || { nome: '', tipo: '' };
  if (nome === atual.nome) return;
  // Pessoa nova na vaga: o tipo precisa ser confirmado de novo
  gravarVaga(iso, turnoId, Number(idx), { nome, tipo: '' },
    nome ? 'Salvo. Confirme se é fixo ou freelancer.' : 'Vaga liberada');
}

async function gravarFolga(iso, turnoId, nome, adicionar) {
  mostrarStatus('Salvando…', 'neutro', true);
  try {
    await alterarFolga(estado.hubId, iso, turnoId, nome, adicionar, nomeSupervisor());
    mostrarStatus(adicionar ? 'Folga lançada' : 'Folga retirada');
  } catch (err) { erroGravacao(err); }
}

function adicionarFolga(input) {
  const nome = limparNome(input.value);
  if (!nome) return;
  const [iso, turnoId] = input.dataset.folga.split('|');
  input.value = '';
  if (folgasDoTurno(iso, turnoId).some((f) => normalizaNome(f) === normalizaNome(nome))) {
    mostrarStatus(`${nome} já está nas folgas deste turno`, 'neutro');
    return;
  }
  gravarFolga(iso, turnoId, nome, true);
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
  estado.rolouHoje = false;
  atualizarDatalist();
  atualizarUrl();
  render();
});

function mudarPeriodo(passo) {
  if (estado.modo === 'semana') estado.ref = addDays(estado.ref, passo * 7);
  else estado.ref = new Date(estado.ref.getFullYear(), estado.ref.getMonth() + passo, 1);
  assinarEscalas();
  render();
}
$('#btnAnterior').addEventListener('click', () => mudarPeriodo(-1));
$('#btnProximo').addEventListener('click', () => mudarPeriodo(1));
$('#btnHoje').addEventListener('click', () => {
  estado.ref = new Date();
  estado.rolouHoje = false;
  assinarEscalas();
  render();
});

$('#dlgFechar').addEventListener('click', () => el.dlg.close());
el.dlg.addEventListener('close', () => { estado.diaAberto = null; });
el.dlg.addEventListener('click', (e) => { if (e.target === el.dlg) el.dlg.close(); });

document.addEventListener('input', (e) => {
  const i = e.target;
  if (!i.matches?.('input[data-chave]')) return;
  const tem = Boolean(i.value.trim());
  i.closest('.vaga')?.classList.toggle('ocupada', tem);
  i.closest('.vaga')?.classList.toggle('descoberta', !tem);
});

document.addEventListener('change', (e) => {
  const i = e.target;
  if (i.matches?.('input[data-chave]')) salvarNome(i);
  else if (i.matches?.('input[data-folga]')) adicionarFolga(i);
});

// Enter: na vaga, pula para a próxima; na folga, adiciona
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const i = e.target;
  if (i.matches?.('input[data-chave]')) {
    e.preventDefault();
    const campos = [...document.querySelectorAll('input[data-chave]:not([disabled])')]
      .filter((x) => x.offsetParent !== null);
    const prox = campos[campos.indexOf(i) + 1];
    if (prox) prox.focus(); else i.blur();
  } else if (i.matches?.('input[data-folga]')) {
    e.preventDefault();
    adicionarFolga(i);
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
  } else if (ds.tirarFolga) {
    const [iso, turnoId] = ds.tirarFolga.split('|');
    gravarFolga(iso, turnoId, ds.nome, false);
  } else if (ds.liberar) {
    const [iso, turnoId, idx] = ds.liberar.split('|');
    gravarVaga(iso, turnoId, Number(idx), { nome: '', tipo: '' }, 'Removido');
  } else if (ds.expandir) {
    if (estado.expandidos.has(ds.expandir)) estado.expandidos.delete(ds.expandir);
    else estado.expandidos.add(ds.expandir);
    render();
  } else if (ds.abrir) {
    abrirDia(ds.abrir);
  } else if (ds.modo && ds.modo !== estado.modo) {
    estado.modo = ds.modo;
    estado.rolouHoje = false;
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
