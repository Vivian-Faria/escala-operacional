// Página 2 — Escala: o supervisor escolhe seu nome e o hub e preenche as vagas.
import { configuracaoPronta, ouvirConfig, ouvirEscalas, salvarVaga, lancarAusencia, removerAusencia } from './db.js';
import { marcosDoDia, ROTULO_TIPO } from './feriados.js';
import {
  DIAS_CURTO, DIAS_LONGO, MESES, isoDate, parseIso, addDays, startOfWeek, capitalizar,
  ordenaTurnos, faixaDoDia, normalizaNome, limparNome, sobrepoe, escapeHtml, porNome,
  vagasDe, plural, criarStatus, TIPOS, cobertura, ehDividida, textoBuraco, pedacos, hhmm, toMin, faixaCurta, horaCurta
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
const supervisoresSobressalentes = () => new Set(
  estado.cfg.colaboradores.filter((c) => c.papel === 'supervisor').map((c) => normalizaNome(c.nome))
);

// Situação de cada vaga cadastrada de um turno naquele dia.
// A vaga pode ter uma pessoa no turno inteiro ou várias em horários quebrados.
// Quem faltou deixa o seu trecho em aberto.
function situacaoVagas(iso, t, dow) {
  const salvas = vagasSalvas(iso, t.id);
  const faltas = new Set(listaDoTurno(iso, 'faltas', t.id).map(normalizaNome));
  const faltou = (nome) => faltas.has(normalizaNome(nome));
  const vagas = Array.from({ length: vagasNoDia(t, dow) }, (_, i) => montarVaga(t, salvas[i] || [], faltou));

  // Vaga vazia + folga de um supervisor sobressalente naquele turno = não é furo.
  // Cada folga de supervisor "perdoa" uma vaga vazia; sobrando vagas vazias
  // além disso, seguem contando como furo normalmente.
  const sobressalentes = supervisoresSobressalentes();
  const creditos = listaDoTurno(iso, 'folgas', t.id).filter((nome) => sobressalentes.has(normalizaNome(nome)));
  let credito = creditos.length;
  for (const v of vagas) {
    if (credito > 0 && v.vazia) { v.dispensada = creditos[creditos.length - credito]; credito--; }
  }
  return vagas;
}

function montarVaga(t, partes, faltou) {
  const cob = cobertura(t, partes, faltou);
  return {
    partes: partes.map((p) => ({ ...p, faltou: Boolean(p.nome && faltou(p.nome)) })),
    dividida: ehDividida(partes),
    coberta: cob.coberta,
    buracos: cob.buracos,
    vazia: partes.length === 0
  };
}

function turnosDoDia(d) {
  const iso = isoDate(d);
  const dow = d.getDay();
  return ordenaTurnos(turnosDoHub().filter((t) => vagasNoDia(t, dow) > 0
    || vagasSalvas(iso, t.id).some((partes) => partes.length)
    || listaDoTurno(iso, 'folgas', t.id).length
    || listaDoTurno(iso, 'faltas', t.id).length));
}

function contagemDia(d) {
  const iso = isoDate(d);
  const dow = d.getDay();
  const c = { total: 0, cobertas: 0, descobertas: 0, pendentes: 0, faltas: 0, freelancer: 0, intermitente: 0 };
  for (const t of turnosDoHub()) {
    c.faltas += listaDoTurno(iso, 'faltas', t.id).length;
    for (const v of situacaoVagas(iso, t, dow)) {
      if (v.dispensada) continue;
      c.total++;
      if (v.coberta) c.cobertas++;
      for (const p of v.partes) {
        if (!p.nome || p.faltou) continue;
        if (!p.tipo) c.pendentes++;
        if (p.tipo === 'freelancer' || p.tipo === 'intermitente') c[p.tipo]++;
      }
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
      vagasDe(valor).forEach((partes, idx) => {
        partes.forEach((p, pi) => {
          const norm = normalizaNome(p.nome);
          // Quem tem horário próprio é comparado pelo trecho que cobre
          const janela = p.inicio || p.fim
            ? { inicio: p.inicio || turno.inicio, fim: p.fim || turno.fim, nome: turno.nome, id: turno.id }
            : turno;
          if (norm) escalados.push({ norm, hubId: d.hubId, hubNome, turno: janela, idx, pi });
        });
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

function alertasVaga(ind, turno, idx, pi, parte) {
  const norm = normalizaNome(parte.nome);
  if (!norm) return [];
  const janela = parte.inicio || parte.fim
    ? { inicio: parte.inicio || turno.inicio, fim: parte.fim || turno.fim }
    : turno;
  const msgs = [];
  const outros = ind.escalados.filter((e) => e.norm === norm && sobrepoe(e.turno, janela)
    && !(e.hubId === estado.hubId && e.turno.id === turno.id && e.idx === idx && e.pi === pi));
  if (outros.length) msgs.push(`Também escalado em ${outros.map(onde).join('; ')}`);
  const deFolga = ind.folgas.filter((f) => f.norm === norm && sobrepoe(f.turno, janela));
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

function htmlParte(iso, t, i, pi, p, alertas, travado, rotDia, mostrarHoras) {
  const chave = `${iso}|${t.id}|${i}|${pi}`;
  const temNome = Boolean(p.nome.trim());
  const dis = travado ? 'disabled' : '';
  const rotulo = mostrarHoras ? `${t.nome}, vaga ${i + 1}, pessoa ${pi + 1}, ${rotDia}` : `${t.nome}, vaga ${i + 1}, ${rotDia}`;
  const quem = escapeHtml(p.nome) || `pessoa ${pi + 1}`;
  const horas = mostrarHoras ? `
    <div class="horas">
      <label class="hora"><span>Entra</span>
        <input type="time" value="${p.inicio || t.inicio}" aria-label="Entrada de ${quem}"
          data-hora="${chave}|inicio" data-foco="hi|${chave}" ${dis}></label>
      <label class="hora"><span>Sai</span>
        <input type="time" value="${p.fim || t.fim}" aria-label="Saída de ${quem}"
          data-hora="${chave}|fim" data-foco="hf|${chave}" ${dis}></label>
    </div>` : '';
  const acoes = temNome ? `
    <div class="tipo" role="group" aria-label="${escapeHtml(p.nome)}">
      ${!p.faltou && !p.tipo ? '<span class="tipo-pergunta">Fixo, freela ou intermitente?</span>' : ''}
      ${Object.entries(TIPOS).map(([valor, tp]) => `<button type="button" data-tipo-vaga="${chave}" data-valor="${valor}"
        aria-pressed="${p.tipo === valor}" aria-label="${valor === 'fixo' ? 'Fixo' : valor === 'freelancer' ? 'Freelancer' : 'Intermitente'}" ${dis}>${tp.botao}</button>`).join('')}
      <button type="button" class="btn-faltou" data-faltou="${iso}|${t.id}" data-nome="${escapeHtml(p.nome)}" aria-pressed="${p.faltou}" ${dis}>Faltou</button>
    </div>` : '';
  return `<div class="parte${p.faltou ? ' faltou' : ''}">
    <div class="parte-nome">
      <input type="text" list="listaColaboradores" autocomplete="off" spellcheck="false" enterkeyhint="next"
        value="${escapeHtml(p.nome)}" placeholder="${mostrarHoras ? 'Quem cobre' : 'Descoberta'}"
        aria-label="${escapeHtml(rotulo)}" data-parte="${chave}" data-foco="v|${chave}" ${dis}>
      ${mostrarHoras ? `<button type="button" class="btn-tirar" data-tirar-parte="${chave}"
        aria-label="Tirar ${escapeHtml(p.nome) || 'esta pessoa'} da vaga" ${dis}>×</button>` : ''}
    </div>
    ${horas}
    ${p.faltou ? '<p class="vaga-furo">Faltou. O horário está descoberto.</p>' : ''}
    ${acoes}
    ${alertas.map((a) => `<p class="vaga-alerta">${escapeHtml(a)}</p>`).join('')}
  </div>`;
}

function htmlVaga(iso, t, i, v, ind, travado, rotDia) {
  const dis = travado ? 'disabled' : '';
  if (v.dispensada) return htmlVagaDispensada(iso, t, i, v, travado, rotDia);
  const cls = ['vaga', v.coberta ? 'ocupada' : 'descoberta', v.dividida ? 'dividida' : ''].filter(Boolean).join(' ');
  const partes = v.partes.length ? v.partes : [{ nome: '', tipo: '', inicio: '', fim: '' }];
  const corpo = partes.map((p, pi) =>
    htmlParte(iso, t, i, pi, p, alertasVaga(ind, t, i, pi, p), travado, rotDia, v.dividida)).join('');
  const buracos = v.dividida && v.buracos.length && v.partes.some((p) => p.nome)
    ? `<p class="vaga-buraco">Falta cobrir ${v.buracos.map(textoBuraco).join(' e ')}</p>` : '';
  const rodape = v.dividida
    ? `<button type="button" class="btn-dividir" data-add-parte="${iso}|${t.id}|${i}" ${dis}>+ pessoa</button>`
    : `<button type="button" class="btn-dividir" data-dividir="${iso}|${t.id}|${i}" ${dis}>Dividir horário</button>`;
  return `<div class="${cls}">${corpo}${buracos}${rodape}</div>`;
}

// Vaga sobressalente vazia por folga de supervisor: sem cobrança de furo,
// mas com um campo opcional para quem quiser lançar um reforço mesmo assim.
function htmlVagaDispensada(iso, t, i, v, travado, rotDia) {
  const dis = travado ? 'disabled' : '';
  const chave = `${iso}|${t.id}|${i}|0`;
  return `<div class="vaga dispensada">
    <p class="vaga-dispensa">Folga de ${escapeHtml(v.dispensada)} — vaga sobressalente, não conta como furo</p>
    <input type="text" list="listaColaboradores" autocomplete="off" spellcheck="false" enterkeyhint="next"
      placeholder="Reforço opcional" aria-label="Reforço opcional para ${escapeHtml(t.nome)}, ${rotDia}"
      data-parte="${chave}" data-foco="v|${chave}" ${dis}>
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
    const aplicaveis = situacao.filter((v) => !v.dispensada);
    const cobertas = aplicaveis.filter((v) => v.coberta).length;
    const htmlVagas = situacao.map((v, i) => htmlVaga(iso, t, i, v, ind, travado, rotDia)).join('');
    const extras = vagasSalvas(iso, t.id).map((partes, i) => ({ partes, i })).slice(n).filter((x) => x.partes.length);
    const htmlExtras = extras.length ? `<div class="extras">
      <p>Acima das vagas cadastradas</p>
      ${extras.map((x) => `<div class="extra"><span>${escapeHtml(x.partes.map((p) => p.nome).join(', '))}</span>
        <button type="button" class="btn-texto" data-liberar="${iso}|${t.id}|${x.i}">Remover</button></div>`).join('')}
    </div>` : '';
    const cont = aplicaveis.length
      ? `<span class="turno-cont ${cobertas >= aplicaveis.length ? 'completo' : 'incompleto'}">${cobertas}/${aplicaveis.length}</span>`
      : n ? '<span class="turno-cont completo">Dispensado</span>' : '';

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
  tot.freelancer += c.freelancer;
  tot.intermitente += c.intermitente;
  tot.faltas += c.faltas;
  if (futuro) tot.descobertas += c.descobertas;
}
const totalZerado = () => ({ total: 0, cobertas: 0, descobertas: 0, pendentes: 0, faltas: 0, freelancer: 0, intermitente: 0 });

function htmlResumo(tot, incluiHoje) {
  if (!estado.escalasProntas) return 'Carregando escala…';
  if (!tot.total) return 'Nenhuma vaga neste período';
  const pct = Math.round((tot.cobertas / tot.total) * 100);
  const periodo = estado.modo === 'mes' ? 'do mês' : 'da semana';
  let html = `<span class="progresso">
      <span class="prog-barra ${pct >= 100 ? 'completo' : ''}" aria-hidden="true"><span style="width:${pct}%"></span></span>
      <span><strong>${pct}%</strong> da escala ${periodo} preenchida</span>
    </span>
    <span class="resumo-vagas">${tot.cobertas} de ${tot.total} vagas cobertas</span>`;
  if (tot.descobertas) {
    html += ` <span class="pilula pilula-furo">${plural(tot.descobertas, 'descoberta', 'descobertas')}${incluiHoje ? ' a partir de hoje' : ''}</span>`;
  }
  if (tot.faltas) html += ` <span class="pilula pilula-falta">${plural(tot.faltas, 'falta', 'faltas')}</span>`;
  if (tot.pendentes) html += ` <span class="pilula pilula-pendente">${tot.pendentes} sem tipo confirmado</span>`;
  for (const chave of ['freelancer', 'intermitente']) {
    if (tot[chave]) html += ` <span class="pilula">${plural(tot[chave], ...TIPOS[chave].plural)}</span>`;
  }
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
    const todas = situacaoVagas(iso, t, dow);
    const vagas = todas.filter((v) => !v.dispensada);
    const nomes = vagas.flatMap((v) => v.partes.filter((p) => p.nome && !p.faltou).map((p) => {
      const tag = p.tipo && p.tipo !== 'fixo' ? `<span class="n-tag">${TIPOS[p.tipo].curto}</span>` : '';
      const hora = v.dividida
        ? `<span class="n-hora">${faixaCurta(p.inicio || t.inicio, p.fim || t.fim)}</span>` : '';
      return `<span class="n-ok${tag ? ' avulso' : ''}">${hora}${escapeHtml(p.nome)}${tag}</span>`;
    })).join('');
    const dispensas = todas.filter((v) => v.dispensada)
      .map((v) => `<span class="n-dispensa">Folga ${escapeHtml(v.dispensada)}</span>`).join('');
    const furos = vagas.filter((v) => !v.coberta).length;
    const buracos = vagas.filter((v) => !v.coberta).flatMap((v) => v.buracos);
    const cobertas = vagas.length - furos;
    const fracao = vagas.length ? `${cobertas}/${vagas.length}` : 'Dispensado';
    return `<span class="nomes-turno faixa-${faixaDoDia(t.inicio)}">
      ${soUmTurno ? '' : `<span class="nt-rot"><span class="nt-nome">${escapeHtml(t.nome)}</span>
        <span class="nt-cont ${furos ? 'incompleto' : 'completo'}">${fracao}</span></span>`}
      <span class="nt-lista">${nomes}${dispensas}${furos ? `<span class="n-furo">${
        buracos.length && buracos.length <= 2 && vagas.some((v) => v.dividida)
          ? `Falta ${buracos.map(([a, b]) => faixaCurta(hhmm(a), hhmm(b))).join(' e ')}`
          : plural(furos, 'descoberta', 'descobertas')}</span>` : ''}</span>
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
    situacaoVagas(iso, t, dow).filter((v) => !v.dispensada).map((v) => `<i class="${v.coberta ? 'p-ok' : 'p-furo'}"></i>`).join('')
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
      <span class="leg-nomes">Freelancers e intermitentes aparecem com etiqueta ao lado do nome. Toque num dia para lançar a escala.</span>
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

function gravarPartes(iso, turnoId, idx, partes, msgOk) {
  const limpas = partes
    .map((p) => ({ nome: limparNome(p.nome), tipo: p.tipo || '', inicio: p.inicio || '', fim: p.fim || '' }))
    .filter((p) => p.nome || p.inicio || p.fim);
  return gravar(() => salvarVaga(estado.hubId, iso, turnoId, idx, { partes: limpas }, nomeSupervisor()), msgOk);
}

// Partes como estão gravadas agora, para alterar só o que mudou
function partesAtuais(iso, turnoId, idx) {
  return (vagasSalvas(iso, turnoId)[idx] || []).map((p) => ({ ...p }));
}

function alterarParte(iso, turnoId, idx, pi, mudanca, msgOk) {
  const partes = partesAtuais(iso, turnoId, idx);
  while (partes.length <= pi) partes.push({ nome: '', tipo: '', inicio: '', fim: '' });
  partes[pi] = { ...partes[pi], ...mudanca };
  return gravarPartes(iso, turnoId, idx, partes, msgOk);
}

function salvarNome(input) {
  const [iso, turnoId, idx, pi] = input.dataset.parte.split('|');
  const nome = limparNome(input.value);
  input.value = nome;
  const partes = partesAtuais(iso, turnoId, Number(idx));
  const atual = partes[Number(pi)] || { nome: '', tipo: '' };
  if (nome === atual.nome) return;
  // Pessoa nova no horário: o tipo precisa ser confirmado de novo
  alterarParte(iso, turnoId, Number(idx), Number(pi), { nome, tipo: '' },
    nome ? 'Salvo. Confirme o tipo de contrato.' : 'Horário liberado');
}

function salvarHora(input) {
  const [iso, turnoId, idx, pi, campo] = input.dataset.hora.split('|');
  const partes = partesAtuais(iso, turnoId, Number(idx));
  const p = partes[Number(pi)];
  if (!p) return;
  const turno = turnoPorId(turnoId);
  const antes = p[campo] || (campo === 'inicio' ? turno.inicio : turno.fim);
  const novo = input.value;
  if (!novo || novo === antes) { input.value = antes; return; }
  p[campo] = novo;
  // Se o próximo trecho começava onde este terminava, acompanha a mudança
  if (campo === 'fim') {
    const prox = partes[Number(pi) + 1];
    if (prox && (prox.inicio || turno.inicio) === antes) prox.inicio = novo;
  }
  if (campo === 'inicio' && Number(pi) > 0) {
    const ant = partes[Number(pi) - 1];
    if (ant && (ant.fim || turno.fim) === antes) ant.fim = novo;
  }
  gravarPartes(iso, turnoId, Number(idx), partes, 'Horário salvo');
}

// Divide a vaga em dois trechos. Quem já estava fica no primeiro.
function dividirVaga(iso, turnoId, idx) {
  const turno = turnoPorId(turnoId);
  const partes = partesAtuais(iso, turnoId, idx);
  const [a, b] = pedacos(turno, 2);
  const novas = [
    { ...(partes[0] || { nome: '', tipo: '' }), inicio: a[0], fim: a[1] },
    { nome: '', tipo: '', inicio: b[0], fim: b[1] }
  ];
  for (const extra of partes.slice(1)) novas.push({ ...extra, inicio: extra.inicio || b[0], fim: extra.fim || b[1] });
  gravarPartes(iso, turnoId, idx, novas, 'Vaga dividida. Ajuste os horários e preencha os nomes.');
}

// Acrescenta uma pessoa começando no primeiro buraco que existir
function adicionarParte(iso, turnoId, idx) {
  const turno = turnoPorId(turnoId);
  const partes = partesAtuais(iso, turnoId, idx);
  const faltas = new Set(listaDoTurno(iso, 'faltas', turnoId).map(normalizaNome));
  const { buracos } = cobertura(turno, partes, (n) => faltas.has(normalizaNome(n)));
  const [ini, fim] = buracos[0] || [toMin(turno.inicio), toMin(turno.fim)];
  partes.push({ nome: '', tipo: '', inicio: hhmm(ini), fim: hhmm(fim) });
  gravarPartes(iso, turnoId, idx, partes, 'Horário adicionado');
}

function tirarParte(iso, turnoId, idx, pi) {
  const partes = partesAtuais(iso, turnoId, idx);
  partes.splice(pi, 1);
  // Sobrando uma pessoa no turno inteiro, a vaga volta ao formato simples
  if (partes.length === 1) {
    const turno = turnoPorId(turnoId);
    const p = partes[0];
    if ((p.inicio || turno.inicio) === turno.inicio && (p.fim || turno.fim) === turno.fim) {
      partes[0] = { nome: p.nome, tipo: p.tipo, inicio: '', fim: '' };
    }
  }
  gravarPartes(iso, turnoId, idx, partes, 'Horário removido');
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

document.addEventListener('change', (e) => {
  const i = e.target;
  if (i.matches?.('input[data-parte]')) salvarNome(i);
  else if (i.matches?.('input[data-hora]')) salvarHora(i);
});

// Enter na vaga pula para a próxima
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const i = e.target;
  if (i.matches?.('input[data-parte]')) {
    e.preventDefault();
    const campos = [...document.querySelectorAll('input[data-parte]:not([disabled])')]
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
    const [iso, turnoId, idx, pi] = ds.tipoVaga.split('|');
    alterarParte(iso, turnoId, Number(idx), Number(pi), { tipo: ds.valor }, `Marcado como ${TIPOS[ds.valor].plural[0]}`);
  } else if (ds.dividir) {
    const [iso, turnoId, idx] = ds.dividir.split('|');
    dividirVaga(iso, turnoId, Number(idx));
  } else if (ds.addParte) {
    const [iso, turnoId, idx] = ds.addParte.split('|');
    adicionarParte(iso, turnoId, Number(idx));
  } else if (ds.tirarParte) {
    const [iso, turnoId, idx, pi] = ds.tirarParte.split('|');
    tirarParte(iso, turnoId, Number(idx), Number(pi));
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
    gravarPartes(iso, turnoId, Number(idx), [], 'Removido');
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
