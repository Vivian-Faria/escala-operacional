// Página 1 — Cadastros: hubs, turnos com vagas por dia, supervisores, colaboradores, datas especiais e ponto.
import { configuracaoPronta, lerConfig, salvarConfig, ouvirEscalas, ouvirPontos } from './db.js';
import { entrar, sair, aoMudarLogin } from './auth.js';
import { datasDoAno, ROTULO_TIPO } from './feriados.js';
import {
  DIAS_CURTO, DIAS_LONGO, MESES, uid, escapeHtml, porNome, limparNome, normalizaNome,
  ordenaTurnos, faixaDoDia, vagasSemana, plural, parseIso, isoDate, addDays, startOfWeek,
  capitalizar, toMin, vagasDe, minutosDaParte, horas, criarStatus
} from './utils.js';

const $ = (s) => document.querySelector(s);
const el = {
  aviso: $('#avisoConfig'), login: $('#telaLogin'), app: $('#telaApp'), form: $('#formLogin'),
  senha: $('#senha'), erroLogin: $('#erroLogin'), sair: $('#btnSair'), conteudo: $('#conteudo'),
  barra: $('#barraSalvar'), salvar: $('#btnSalvar'), descartar: $('#btnDescartar')
};
const mostrarStatus = criarStatus($('#status'));

let cfg = null;        // cópia de trabalho
let original = '';     // último estado salvo (para saber se há alterações)
let aba = 'hubs';
let hubTurnos = '';
let filtroColab = '';

// ---------- estado da conciliação de ponto ----------
const ponto = {
  hubId: '', modo: 'semana', ref: new Date(),
  escalas: {}, pontos: {}, chaveFaixa: '',
  escalasProntas: false, pontosProntas: false,
  cancelarEscalas: null, cancelarPontos: null,
  expandido: new Set()
};

// ================= início e login =================
if (!configuracaoPronta()) {
  el.aviso.hidden = false;
} else {
  aoMudarLogin(async (usuario) => {
    if (!usuario) {
      cfg = null;
      el.app.hidden = true;
      el.sair.hidden = true;
      el.barra.hidden = true;
      el.login.hidden = false;
      el.senha.focus();
      return;
    }
    el.login.hidden = true;
    el.sair.hidden = false;
    el.app.hidden = false;
    el.conteudo.innerHTML = '<p class="carregando">Carregando cadastros…</p>';
    try {
      cfg = await lerConfig();
      original = JSON.stringify(cfg);
      renderAba();
    } catch (err) {
      console.error(err);
      el.conteudo.innerHTML = `<div class="aviso"><h2>Não foi possível carregar</h2><p>${err?.code === 'permission-denied'
        ? 'O Firestore recusou a leitura. Confira se as regras do <code>firestore.rules</code> foram publicadas.'
        : 'Verifique a conexão e recarregue a página.'}</p></div>`;
    }
  });
}

function mensagemLogin(codigo) {
  switch (codigo) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/invalid-login-credentials': return 'Senha incorreta.';
    case 'auth/user-not-found': return 'O usuário administrador não existe. Crie-o no Firebase Authentication (veja o README).';
    case 'auth/too-many-requests': return 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.';
    case 'auth/network-request-failed': return 'Sem conexão com a internet.';
    case 'auth/operation-not-allowed': return 'Ative o login por e-mail e senha no Firebase Authentication.';
    case 'auth/invalid-email': return 'O ADMIN_EMAIL em firebase-config.js não é um e-mail válido.';
    default: return `Não foi possível entrar (${codigo || 'erro desconhecido'}).`;
  }
}

el.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  el.erroLogin.textContent = '';
  const btn = el.form.querySelector('button');
  btn.disabled = true;
  try {
    await entrar(el.senha.value);
    el.senha.value = '';
  } catch (err) {
    el.erroLogin.textContent = mensagemLogin(err?.code);
  } finally {
    btn.disabled = false;
  }
});

el.sair.addEventListener('click', () => {
  if (temAlteracoes() && !confirm('Sair sem salvar as alterações?')) return;
  original = '';
  sair();
});

// ================= alterações pendentes =================
const temAlteracoes = () => cfg && JSON.stringify(cfg) !== original;
function marcar() { el.barra.hidden = !temAlteracoes(); }

window.addEventListener('beforeunload', (e) => {
  if (temAlteracoes()) { e.preventDefault(); e.returnValue = ''; }
});

el.descartar.addEventListener('click', () => {
  cfg = JSON.parse(original);
  renderAba();
  marcar();
  mostrarStatus('Alterações descartadas', 'neutro');
});

el.salvar.addEventListener('click', async () => {
  limparCadastros();
  const erro = validar();
  if (erro) {
    aba = erro.aba;
    if (erro.hub) hubTurnos = erro.hub;
    renderAba();
    mostrarStatus(erro.msg, 'erro', true);
    return;
  }
  el.salvar.disabled = true;
  mostrarStatus('Salvando…', 'neutro', true);
  try {
    await salvarConfig(cfg);
    original = JSON.stringify(cfg);
    marcar();
    renderAba();
    mostrarStatus('Alterações salvas');
  } catch (err) {
    console.error(err);
    mostrarStatus(err?.code === 'permission-denied'
      ? 'O Firestore recusou a gravação. Confira o e-mail de admin no firestore.rules.'
      : 'Não foi possível salvar. Verifique a conexão e tente de novo.', 'erro', true);
  } finally {
    el.salvar.disabled = false;
  }
});

function limparCadastros() {
  cfg.hubs.forEach((h) => { h.nome = limparNome(h.nome); });
  cfg.turnos.forEach((t) => { t.nome = limparNome(t.nome); });
  cfg.supervisores.forEach((s) => { s.nome = limparNome(s.nome); });
  cfg.colaboradores = cfg.colaboradores.filter((c) => limparNome(c.nome));
  cfg.colaboradores.forEach((c) => { c.nome = limparNome(c.nome); });
  cfg.datasEspeciais.forEach((d) => { d.nome = limparNome(d.nome); });
}

function validar() {
  const hora = /^\d{2}:\d{2}$/;
  for (const h of cfg.hubs) if (!h.nome) return { aba: 'hubs', msg: 'Há um hub sem nome.' };
  for (const t of cfg.turnos) {
    const hub = hubNome(t.hubId);
    if (!t.nome) return { aba: 'turnos', hub: t.hubId, msg: `Há um turno sem nome no hub ${hub}.` };
    if (!hora.test(t.inicio) || !hora.test(t.fim)) {
      return { aba: 'turnos', hub: t.hubId, msg: `Preencha início e fim do turno ${t.nome} (${hub}).` };
    }
    if (t.inicio === t.fim) {
      return { aba: 'turnos', hub: t.hubId, msg: `O turno ${t.nome} (${hub}) começa e termina no mesmo horário.` };
    }
  }
  for (const s of cfg.supervisores) if (!s.nome) return { aba: 'supervisores', msg: 'Há um supervisor sem nome.' };
  for (const d of cfg.datasEspeciais) {
    if (!d.nome) return { aba: 'datas', msg: 'Há uma data especial sem nome.' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.data || '')) return { aba: 'datas', msg: `Preencha a data de ${d.nome}.` };
  }
  return null;
}

// ================= auxiliares =================
const hubNome = (id) => cfg.hubs.find((h) => h.id === id)?.nome || 'sem hub';
const hubsOrdenados = () => [...cfg.hubs].sort(porNome);
const numero = (v) => Math.max(0, Math.min(99, parseInt(v, 10) || 0));

function totalHub(hubId) {
  return cfg.turnos.filter((t) => t.hubId === hubId).reduce((s, t) => s + vagasSemana(t), 0);
}

function formatarData(d) {
  const [a, m, dia] = d.data.split('-');
  return d.anual ? `${dia}/${m}, todo ano` : `${dia}/${m}/${a}`;
}

function opcoesTipo(atual) {
  return Object.entries(ROTULO_TIPO)
    .map(([v, r]) => `<option value="${v}"${v === atual ? ' selected' : ''}>${r}</option>`).join('');
}

function cabecalho(titulo, texto) {
  return `<div class="secao-cab"><h2>${titulo}</h2><p>${texto}</p></div>`;
}

// ================= abas =================
document.querySelector('.abas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-aba]');
  if (!b) return;
  aba = b.dataset.aba;
  renderAba();
});

function renderAba() {
  if (!cfg) return;
  document.querySelectorAll('.abas [data-aba]').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.aba === aba));
  });
  ({ hubs: renderHubs, turnos: renderTurnos, supervisores: renderSupervisores,
    colaboradores: renderColaboradores, datas: renderDatas, ponto: renderPonto })[aba]();
}

// ---------- Hubs ----------
function renderHubs() {
  const itens = hubsOrdenados().map((h) => {
    const n = cfg.turnos.filter((t) => t.hubId === h.id).length;
    return `<li class="item">
      <input type="text" aria-label="Nome do hub" data-tipo="hub" data-id="${h.id}" data-campo="nome" value="${escapeHtml(h.nome)}">
      <span class="item-meta">${plural(n, 'turno', 'turnos')}, ${totalHub(h.id)} vagas por semana</span>
      <button type="button" class="btn-texto perigo" data-acao="remover-hub" data-id="${h.id}">Remover</button>
    </li>`;
  }).join('');
  el.conteudo.innerHTML = `
    ${cabecalho('Hubs', 'As unidades que têm escala. Cada hub tem seus próprios turnos e vagas.')}
    <form class="linha-add" data-form="hub">
      <label class="sr" for="novoHub">Nome do novo hub</label>
      <input type="text" id="novoHub" placeholder="Nome do hub, ex: Sion" required>
      <button class="btn-primario" type="submit">Adicionar hub</button>
    </form>
    ${cfg.hubs.length ? `<ul class="lista">${itens}</ul>` : '<p class="vazio">Nenhum hub cadastrado. Adicione o primeiro acima.</p>'}`;
}

// ---------- Turnos ----------
function linhaTurno(t) {
  const vagas = t.vagas || [0, 0, 0, 0, 0, 0, 0];
  const base = `data-tipo="turno" data-id="${t.id}"`;
  return `<tr class="faixa-${faixaDoDia(t.inicio)}" data-linha="${t.id}">
    <td class="col-nome"><input type="text" class="in-nome" placeholder="Nome, ex: Almoço" aria-label="Nome do turno" ${base} data-campo="nome" value="${escapeHtml(t.nome)}"></td>
    <td><input type="time" aria-label="Início" ${base} data-campo="inicio" value="${t.inicio}"></td>
    <td><input type="time" aria-label="Fim" ${base} data-campo="fim" value="${t.fim}"></td>
    <td class="col-todos"><input type="number" min="0" max="99" inputmode="numeric" placeholder="–" aria-label="Mesmo número de vagas em todos os dias" ${base} data-campo="todos"></td>
    ${vagas.map((v, i) => `<td><input type="number" min="0" max="99" inputmode="numeric" aria-label="Vagas ${DIAS_LONGO[i]}" ${base} data-campo="vaga" data-dia="${i}" value="${v}"></td>`).join('')}
    <td class="col-total" data-total="${t.id}">${vagasSemana(t)}</td>
    <td class="col-acoes">
      <button type="button" class="btn-texto" data-acao="duplicar-turno" data-id="${t.id}">Duplicar</button>
      <button type="button" class="btn-texto perigo" data-acao="remover-turno" data-id="${t.id}">Remover</button>
    </td>
  </tr>`;
}

function renderTurnos() {
  const cab = cabecalho('Turnos e vagas',
    'Para cada hub, defina os turnos e quantas pessoas cada um precisa em cada dia da semana. Use 0 nos dias em que o turno não acontece.');
  if (!cfg.hubs.length) {
    el.conteudo.innerHTML = `${cab}<p class="vazio">Cadastre um hub primeiro, na aba Hubs.</p>`;
    return;
  }
  if (!cfg.hubs.some((h) => h.id === hubTurnos)) hubTurnos = hubsOrdenados()[0].id;
  const turnos = ordenaTurnos(cfg.turnos.filter((t) => t.hubId === hubTurnos));
  el.conteudo.innerHTML = `${cab}
    <div class="chips chips-hub" role="group" aria-label="Hub">
      ${hubsOrdenados().map((h) => `<button type="button" class="chip" data-acao="hub-turnos" data-id="${h.id}" aria-pressed="${h.id === hubTurnos}">${escapeHtml(h.nome)}</button>`).join('')}
    </div>
    ${turnos.length ? `<div class="tabela-rolagem"><table class="tabela-turnos">
      <thead><tr>
        <th>Turno</th><th>Início</th><th>Fim</th><th class="col-todos">Todos</th>
        ${DIAS_CURTO.map((d) => `<th>${d}</th>`).join('')}
        <th>Semana</th><th><span class="sr">Ações</span></th>
      </tr></thead>
      <tbody>${turnos.map(linhaTurno).join('')}</tbody>
    </table></div>` : `<p class="vazio">${escapeHtml(hubNome(hubTurnos))} ainda não tem turnos.</p>`}
    <div class="rodape-turnos">
      <button type="button" class="btn-secundario" data-acao="adicionar-turno">Adicionar turno</button>
      <p class="item-meta" data-total-hub>${turnos.length ? `${totalHub(hubTurnos)} vagas por semana neste hub` : ''}</p>
    </div>
    <p class="dica">Turnos que terminam depois da meia-noite (ex: 18:00 às 01:20) funcionam normalmente. Na coluna Todos, digite um número para repetir nos 7 dias.</p>`;
}

function atualizarTotais(t) {
  const cel = el.conteudo.querySelector(`[data-total="${t.id}"]`);
  if (cel) cel.textContent = vagasSemana(t);
  const hub = el.conteudo.querySelector('[data-total-hub]');
  if (hub) hub.textContent = `${totalHub(t.hubId)} vagas por semana neste hub`;
}

// ---------- Supervisores ----------
function renderSupervisores() {
  const hubs = hubsOrdenados();
  const itens = [...cfg.supervisores].sort(porNome).map((s) => `<li class="item item-empilhado">
    <div class="item-linha">
      <input type="text" aria-label="Nome do supervisor" data-tipo="sup" data-id="${s.id}" data-campo="nome" value="${escapeHtml(s.nome)}">
      <button type="button" class="btn-texto perigo" data-acao="remover-sup" data-id="${s.id}">Remover</button>
    </div>
    ${hubs.length ? `<div class="chips" role="group" aria-label="Hubs de ${escapeHtml(s.nome)}">
      ${hubs.map((h) => `<button type="button" class="chip" data-acao="hub-sup" data-id="${s.id}" data-hub="${h.id}" aria-pressed="${(s.hubIds || []).includes(h.id)}">${escapeHtml(h.nome)}</button>`).join('')}
    </div>` : '<p class="item-meta">Cadastre hubs para vincular.</p>'}
  </li>`).join('');
  el.conteudo.innerHTML = `
    ${cabecalho('Supervisores', 'Quem lança a escala. Marque os hubs de cada supervisor; se nenhum estiver marcado, ele vê todos.')}
    <form class="linha-add" data-form="sup">
      <label class="sr" for="novoSup">Nome do novo supervisor</label>
      <input type="text" id="novoSup" placeholder="Nome do supervisor" required>
      <button class="btn-primario" type="submit">Adicionar supervisor</button>
    </form>
    ${cfg.supervisores.length ? `<ul class="lista">${itens}</ul>` : '<p class="vazio">Nenhum supervisor cadastrado.</p>'}`;
}

// ---------- Colaboradores ----------
function renderColaboradores() {
  const opcoesHub = hubsOrdenados().map((h) => `<option value="${h.id}">${escapeHtml(h.nome)}</option>`).join('');
  el.conteudo.innerHTML = `
    ${cabecalho('Colaboradores', 'Os nomes aparecem como sugestão quando o supervisor digita na escala. Ele também pode escrever um nome que não está aqui, como um freelancer novo. Marque como supervisor quem fica na operação de forma sobressalente: quando a folga dele for lançada e a vaga ficar vazia, ela não conta como furo na escala.')}
    <form class="add-colabs" data-form="colab">
      <label class="campo campo-largo">
        <span>Nomes, um por linha</span>
        <textarea id="novosColabs" rows="3" placeholder="Caio&#10;Rafael&#10;Lucas Luan" required></textarea>
      </label>
      <label class="campo">
        <span>Hub</span>
        <select id="hubNovosColabs"><option value="">Qualquer hub</option>${opcoesHub}</select>
      </label>
      <button class="btn-primario" type="submit">Adicionar</button>
    </form>
    <div class="lista-cab">
      <h3>${plural(cfg.colaboradores.length, 'colaborador', 'colaboradores')}</h3>
      <label class="sr" for="buscaColab">Buscar colaborador</label>
      <input type="search" id="buscaColab" placeholder="Buscar" value="${escapeHtml(filtroColab)}">
    </div>
    <ul class="lista" id="listaColabs"></ul>`;
  renderListaColabs();
}

function renderListaColabs() {
  const alvo = $('#listaColabs');
  if (!alvo) return;
  const busca = normalizaNome(filtroColab);
  const lista = [...cfg.colaboradores].sort(porNome).filter((c) => !busca || normalizaNome(c.nome).includes(busca));
  if (!cfg.colaboradores.length) { alvo.outerHTML = '<p class="vazio" id="listaColabs">Nenhum colaborador cadastrado.</p>'; return; }
  alvo.innerHTML = lista.length ? lista.map((c) => `<li class="item">
    <input type="text" aria-label="Nome do colaborador" data-tipo="colab" data-id="${c.id}" data-campo="nome" value="${escapeHtml(c.nome)}">
    <select aria-label="Hub de ${escapeHtml(c.nome)}" data-tipo="colab" data-id="${c.id}" data-campo="hub">
      <option value="">Qualquer hub</option>
      ${hubsOrdenados().map((h) => `<option value="${h.id}"${h.id === c.hubId ? ' selected' : ''}>${escapeHtml(h.nome)}</option>`).join('')}
    </select>
    <button type="button" class="chip chip-supervisor" data-acao="supervisor-colab" data-id="${c.id}"
      aria-pressed="${c.papel === 'supervisor'}" title="Supervisor sobressalente: folga não conta como furo">Supervisor</button>
    <button type="button" class="btn-texto perigo" data-acao="remover-colab" data-id="${c.id}">Remover</button>
  </li>`).join('') : '<li class="item-meta">Ninguém encontrado com esse nome.</li>';
}

// ---------- Feriados e datas ----------
function renderDatas() {
  const ano = new Date().getFullYear();
  const cadastradas = [...cfg.datasEspeciais].sort((a, b) => a.data.slice(5).localeCompare(b.data.slice(5)));
  const itens = cadastradas.map((d) => `<li class="item">
    <span class="item-data">${formatarData(d)}</span>
    <input type="text" aria-label="Nome da data" data-tipo="data" data-id="${d.id}" data-campo="nome" value="${escapeHtml(d.nome)}">
    <select aria-label="Tipo" data-tipo="data" data-id="${d.id}" data-campo="tipo">${opcoesTipo(d.tipo)}</select>
    <button type="button" class="btn-texto perigo" data-acao="remover-data" data-id="${d.id}">Remover</button>
  </li>`).join('');
  const automaticas = datasDoAno(ano).map((d) => {
    const dt = parseIso(d.data);
    return `<li><span class="item-data">${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}</span> ${escapeHtml(d.nome)} <span class="item-meta">${ROTULO_TIPO[d.tipo]}</span></li>`;
  }).join('');
  el.conteudo.innerHTML = `
    ${cabecalho('Feriados e datas', 'Aparecem marcados no calendário da escala. Os feriados nacionais e as principais datas comemorativas já estão incluídos; cadastre aqui os feriados da cidade e outras datas importantes para a operação.')}
    <form class="add-data" data-form="data">
      <label class="campo"><span>Data</span><input type="date" id="novaDataDia" required></label>
      <label class="campo campo-largo"><span>Nome</span><input type="text" id="novaDataNome" placeholder="Ex: Assunção de Nossa Senhora" required></label>
      <label class="campo"><span>Tipo</span><select id="novaDataTipo">${opcoesTipo('feriado')}</select></label>
      <label class="check"><input type="checkbox" id="novaDataAnual" checked> Repete todo ano</label>
      <button class="btn-primario" type="submit">Adicionar data</button>
    </form>
    ${cadastradas.length ? `<ul class="lista">${itens}</ul>` : '<p class="vazio">Nenhuma data cadastrada por você ainda.</p>'}
    <details class="automaticas">
      <summary>Datas incluídas automaticamente em ${ano}</summary>
      <ul>${automaticas}</ul>
    </details>`;
}

// ---------- Ponto: previsto (escala) vs batido (registro com foto) ----------
function faixaPonto() {
  if (ponto.modo === 'semana') {
    const ini = startOfWeek(ponto.ref);
    return { ini, fim: addDays(ini, 6) };
  }
  const primeiro = new Date(ponto.ref.getFullYear(), ponto.ref.getMonth(), 1);
  const ultimo = new Date(ponto.ref.getFullYear(), ponto.ref.getMonth() + 1, 0);
  return { ini: primeiro, fim: ultimo, primeiro };
}

function assinarPonto() {
  const { ini, fim } = faixaPonto();
  const chave = `${ponto.hubId}|${isoDate(ini)}|${isoDate(fim)}`;
  if (chave === ponto.chaveFaixa) return;
  ponto.chaveFaixa = chave;
  ponto.cancelarEscalas?.();
  ponto.cancelarPontos?.();
  ponto.escalas = {};
  ponto.pontos = {};
  ponto.escalasProntas = false;
  ponto.pontosProntas = false;
  if (!ponto.hubId) return;
  const iniIso = isoDate(ini), fimIso = isoDate(fim);
  ponto.cancelarEscalas = ouvirEscalas(iniIso, fimIso, (m) => { ponto.escalas = m; ponto.escalasProntas = true; renderPonto(); },
    () => mostrarStatus('Não foi possível carregar a escala do período.', 'erro', true));
  ponto.cancelarPontos = ouvirPontos(iniIso, fimIso, (m) => { ponto.pontos = m; ponto.pontosProntas = true; renderPonto(); },
    () => mostrarStatus('Não foi possível carregar os registros de ponto.', 'erro', true));
}

// Minutos batidos num dia, a partir das 4 marcações. Cobre o que existir,
// mesmo com o dia incompleto.
function minutosBatidos(reg) {
  if (!reg) return { minutos: 0, completo: false, algum: false };
  const par = (a, b) => {
    if (!reg[a]?.hora || !reg[b]?.hora) return null;
    let d = toMin(reg[b].hora) - toMin(reg[a].hora);
    if (d < 0) d += 1440;
    return d;
  };
  const manha = par('chegada', 'saidaAlmoco');
  const tarde = par('voltaAlmoco', 'saida');
  const algum = Boolean(reg.chegada?.hora || reg.saidaAlmoco?.hora || reg.voltaAlmoco?.hora || reg.saida?.hora);
  return {
    minutos: (manha || 0) + (tarde || 0),
    completo: Boolean(reg.chegada?.hora && reg.saidaAlmoco?.hora && reg.voltaAlmoco?.hora && reg.saida?.hora),
    algum
  };
}

// Junta, por colaborador, quanto foi previsto na escala e quanto foi batido
// no ponto, dia a dia, no hub e período escolhidos.
function apurarPonto() {
  const { ini, fim } = faixaPonto();
  const turnos = cfg.turnos.filter((t) => t.hubId === ponto.hubId);
  const pessoas = new Map(); // chave normalizada -> { nome, dias: Map(iso -> {previsto, turnos:[], batido, completo, algumBatido, registros}) }

  const linha = (chave, nome) => {
    if (!pessoas.has(chave)) pessoas.set(chave, { nome, dias: new Map() });
    return pessoas.get(chave);
  };
  const diaDe = (p, iso) => {
    if (!p.dias.has(iso)) p.dias.set(iso, { previsto: 0, turnos: [], batido: 0, completo: false, algumBatido: false, registros: null });
    return p.dias.get(iso);
  };

  for (let d = new Date(ini); d <= fim; d = addDays(d, 1)) {
    const iso = isoDate(d);
    const escala = ponto.escalas[`${ponto.hubId}_${iso}`];
    for (const t of turnos) {
      const slot = escala?.slots?.[t.id];
      if (!slot) continue;
      for (const partes of vagasDe(slot)) {
        for (const parte of partes) {
          if (!parte.nome) continue;
          const chave = normalizaNome(parte.nome);
          const dObj = diaDe(linha(chave, parte.nome), iso);
          dObj.previsto += minutosDaParte(t, parte);
          dObj.turnos.push({ nome: t.nome, inicio: parte.inicio || t.inicio, fim: parte.fim || t.fim });
        }
      }
    }
    const registros = ponto.pontos[`${ponto.hubId}_${iso}`]?.registros || {};
    for (const [chave, reg] of Object.entries(registros)) {
      const p = linha(chave, reg.nome || chave);
      const dObj = diaDe(p, iso);
      const { minutos, completo, algum } = minutosBatidos(reg);
      dObj.batido = minutos;
      dObj.completo = completo;
      dObj.algumBatido = algum;
      dObj.registros = reg;
    }
  }
  return [...pessoas.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

function tituloPeriodoPonto() {
  const { ini, fim, primeiro } = faixaPonto();
  if (ponto.modo === 'mes') return `${capitalizar(MESES[primeiro.getMonth()])} de ${primeiro.getFullYear()}`;
  const a = ini.getDate(), b = fim.getDate();
  return ini.getMonth() === fim.getMonth()
    ? `${a} a ${b} de ${MESES[fim.getMonth()]}`
    : `${a} de ${MESES[ini.getMonth()]} a ${b} de ${MESES[fim.getMonth()]}`;
}

function horaOuTraco(reg, campo) {
  if (!reg?.[campo]?.hora) return '<span class="hora-vazia">—</span>';
  return reg[campo].fotoUrl
    ? `<a class="hora-batida" href="${escapeHtml(reg[campo].fotoUrl)}" target="_blank" rel="noopener" title="Ver foto">${reg[campo].hora}</a>`
    : `<span class="hora-batida-sf">${reg[campo].hora}</span>`;
}

function linhaDia(iso, dObj) {
  const dt = parseIso(iso);
  const diff = dObj.batido - dObj.previsto;
  const relevante = dObj.previsto > 0 || dObj.algumBatido;
  if (!relevante) return '';
  const alerta = dObj.previsto > 0 && dObj.algumBatido && !dObj.completo;
  const grande = Math.abs(diff) >= 30 && dObj.previsto > 0 && dObj.completo;
  return `<tr class="${alerta ? 'linha-alerta' : ''} ${grande ? 'linha-diverge' : ''}">
    <td>${DIAS_CURTO[dt.getDay()]} ${dt.getDate()}</td>
    <td>${dObj.previsto ? `${horas(dObj.previsto)}<span class="turnos-dia">${dObj.turnos.map((t) => escapeHtml(t.nome)).join(', ')}</span>` : '<span class="hora-vazia">Sem escala</span>'}</td>
    <td>${horaOuTraco(dObj.registros, 'chegada')}</td>
    <td>${horaOuTraco(dObj.registros, 'saidaAlmoco')}</td>
    <td>${horaOuTraco(dObj.registros, 'voltaAlmoco')}</td>
    <td>${horaOuTraco(dObj.registros, 'saida')}</td>
    <td>${dObj.algumBatido ? (dObj.completo ? horas(dObj.batido) : '<span class="hora-vazia">Incompleto</span>') : '<span class="hora-vazia">—</span>'}</td>
    <td class="col-diff">${dObj.previsto && dObj.completo ? `<span class="${diff < -15 ? 'diff-neg' : diff > 15 ? 'diff-pos' : ''}">${diff > 0 ? '+' : ''}${horas(diff)}</span>` : '—'}</td>
  </tr>`;
}

function renderPonto() {
  const hubs = hubsOrdenados();
  if (!hubs.length) {
    el.conteudo.innerHTML = `${cabecalho('Ponto', 'Compara o horário previsto na escala com o horário batido no ponto.')}<p class="vazio">Cadastre um hub primeiro, na aba Hubs.</p>`;
    return;
  }
  if (!hubs.some((h) => h.id === ponto.hubId)) ponto.hubId = hubs[0].id;
  assinarPonto();

  el.conteudo.innerHTML = `
    ${cabecalho('Ponto', 'Compara o horário que os supervisores lançaram na escala com o horário que cada colaborador bateu no ponto, com foto. Fica só aqui, dentro de Cadastros.')}
    <div class="chips chips-hub" role="group" aria-label="Hub">
      ${hubs.map((h) => `<button type="button" class="chip" data-acao="ponto-hub" data-id="${h.id}" aria-pressed="${h.id === ponto.hubId}">${escapeHtml(h.nome)}</button>`).join('')}
    </div>
    <div class="barra-ponto">
      <div class="nav-periodo">
        <button type="button" class="btn-icone" data-acao="ponto-anterior" aria-label="Período anterior">‹</button>
        <button type="button" class="btn-icone" data-acao="ponto-proximo" aria-label="Próximo período">›</button>
        <h3>${tituloPeriodoPonto()}</h3>
      </div>
      <div class="alternador" role="group" aria-label="Visualização">
        <button type="button" data-acao="ponto-modo" data-valor="semana" aria-pressed="${ponto.modo === 'semana'}">Semana</button>
        <button type="button" data-acao="ponto-modo" data-valor="mes" aria-pressed="${ponto.modo === 'mes'}">Mês</button>
      </div>
    </div>
    <div id="pontoLista">${htmlListaPonto()}</div>
    <p class="dica">Toque num horário batido para ver a selfie. "Incompleto" é dia com alguma batida faltando; a diferença só é calculada quando as 4 batidas existem.</p>`;
}

function htmlListaPonto() {
  if (!ponto.escalasProntas || !ponto.pontosProntas) return '<p class="carregando">Carregando…</p>';
  const pessoas = apurarPonto();
  if (!pessoas.length) return '<p class="vazio">Sem escala ou ponto lançados neste hub e período.</p>';

  return pessoas.map((p) => {
    const chave = normalizaNome(p.nome);
    const dias = [...p.dias.entries()].sort(([a], [b]) => a.localeCompare(b));
    const totalPrevisto = dias.reduce((s, [, d]) => s + d.previsto, 0);
    const totalBatido = dias.reduce((s, [, d]) => s + (d.completo ? d.batido : 0), 0);
    const diasComPrevisto = dias.filter(([, d]) => d.previsto > 0).length;
    const diasIncompletos = dias.filter(([, d]) => d.previsto > 0 && d.algumBatido && !d.completo).length;
    const linhas = dias.map(([iso, d]) => linhaDia(iso, d)).join('');
    if (!linhas.trim()) return '';
    const aberto = ponto.expandido.has(chave);
    return `<details class="pessoa-ponto" data-chave="${chave}" ${aberto ? 'open' : ''}>
      <summary>
        <span class="pessoa-nome">${escapeHtml(p.nome)}</span>
        <span class="pessoa-resumo">
          <span>${plural(diasComPrevisto, 'dia escalado', 'dias escalados')}</span>
          <span>Previsto ${horas(totalPrevisto)}</span>
          <span>Batido ${horas(totalBatido)}</span>
          ${diasIncompletos ? `<span class="pilula pilula-pendente">${plural(diasIncompletos, 'dia incompleto', 'dias incompletos')}</span>` : ''}
        </span>
      </summary>
      <div class="tabela-rolagem"><table class="tabela-ponto">
        <thead><tr><th>Dia</th><th>Previsto</th><th>Chegada</th><th>Saída almoço</th><th>Volta almoço</th><th>Saída</th><th>Batido</th><th>Diferença</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table></div>
    </details>`;
  }).join('') || '<p class="vazio">Sem escala ou ponto lançados neste hub e período.</p>';
}

// ================= eventos do conteúdo =================
el.conteudo.addEventListener('input', (e) => {
  const i = e.target;
  if (i.id === 'buscaColab') { filtroColab = i.value; renderListaColabs(); return; }
  const { tipo, id, campo } = i.dataset;
  if (!tipo) return;

  if (tipo === 'hub') cfg.hubs.find((x) => x.id === id).nome = i.value;
  else if (tipo === 'sup') cfg.supervisores.find((x) => x.id === id).nome = i.value;
  else if (tipo === 'colab') {
    const c = cfg.colaboradores.find((x) => x.id === id);
    if (campo === 'hub') c.hubId = i.value; else c.nome = i.value;
  } else if (tipo === 'data') {
    cfg.datasEspeciais.find((x) => x.id === id)[campo] = i.value;
  } else if (tipo === 'turno') {
    const t = cfg.turnos.find((x) => x.id === id);
    if (campo === 'vaga') {
      t.vagas[Number(i.dataset.dia)] = numero(i.value);
      atualizarTotais(t);
    } else if (campo === 'todos') {
      if (i.value === '') return;
      const n = numero(i.value);
      t.vagas = Array(7).fill(n);
      i.closest('tr').querySelectorAll('[data-campo="vaga"]').forEach((x) => { x.value = n; });
      atualizarTotais(t);
    } else {
      t[campo] = i.value;
      if (campo === 'inicio') i.closest('tr').className = `faixa-${faixaDoDia(i.value)}`;
    }
  }
  marcar();
});

el.conteudo.addEventListener('submit', (e) => {
  e.preventDefault();
  const tipo = e.target.dataset.form;

  if (tipo === 'hub') {
    const nome = limparNome($('#novoHub').value);
    if (!nome) return;
    if (cfg.hubs.some((h) => normalizaNome(h.nome) === normalizaNome(nome))) {
      mostrarStatus('Já existe um hub com esse nome.', 'erro');
      return;
    }
    cfg.hubs.push({ id: uid('hub'), nome });
    renderAba();
    $('#novoHub').focus();
  }

  if (tipo === 'sup') {
    const nome = limparNome($('#novoSup').value);
    if (!nome) return;
    cfg.supervisores.push({ id: uid('sup'), nome, hubIds: [] });
    renderAba();
    $('#novoSup').focus();
  }

  if (tipo === 'colab') {
    const hubId = $('#hubNovosColabs').value;
    const nomes = $('#novosColabs').value.split('\n').map(limparNome).filter(Boolean);
    const existentes = new Set(cfg.colaboradores.map((c) => normalizaNome(c.nome)));
    let novos = 0;
    for (const nome of nomes) {
      if (existentes.has(normalizaNome(nome))) continue;
      existentes.add(normalizaNome(nome));
      cfg.colaboradores.push({ id: uid('col'), nome, hubId });
      novos++;
    }
    const repetidos = nomes.length - novos;
    renderAba();
    $('#hubNovosColabs').value = hubId;
    mostrarStatus(`${plural(novos, 'colaborador adicionado', 'colaboradores adicionados')}${repetidos ? `, ${repetidos} já existia${repetidos > 1 ? 'm' : ''}` : ''}`, novos ? 'ok' : 'neutro');
  }

  if (tipo === 'data') {
    const data = $('#novaDataDia').value;
    const nome = limparNome($('#novaDataNome').value);
    if (!data || !nome) return;
    cfg.datasEspeciais.push({ id: uid('data'), data, nome, tipo: $('#novaDataTipo').value, anual: $('#novaDataAnual').checked });
    renderAba();
  }
  marcar();
});

el.conteudo.addEventListener('click', (e) => {
  const b = e.target.closest('[data-acao]');
  if (!b) return;
  const { acao, id } = b.dataset;
  let focar = '';

  switch (acao) {
    case 'remover-hub': {
      const h = cfg.hubs.find((x) => x.id === id);
      const n = cfg.turnos.filter((t) => t.hubId === id).length;
      if (!confirm(`Remover o hub ${h.nome}?${n ? ` ${plural(n, 'turno', 'turnos')} dele também ${n > 1 ? 'serão removidos' : 'será removido'}.` : ''}`)) return;
      cfg.hubs = cfg.hubs.filter((x) => x.id !== id);
      cfg.turnos = cfg.turnos.filter((t) => t.hubId !== id);
      cfg.supervisores.forEach((s) => { s.hubIds = (s.hubIds || []).filter((x) => x !== id); });
      cfg.colaboradores.forEach((c) => { if (c.hubId === id) c.hubId = ''; });
      break;
    }
    case 'hub-turnos':
      hubTurnos = id;
      break;
    case 'adicionar-turno': {
      const t = { id: uid('turno'), hubId: hubTurnos, nome: '', inicio: '09:00', fim: '15:00', vagas: [1, 1, 1, 1, 1, 1, 1] };
      cfg.turnos.push(t);
      focar = `[data-id="${t.id}"][data-campo="nome"]`;
      break;
    }
    case 'duplicar-turno': {
      const t = cfg.turnos.find((x) => x.id === id);
      const copia = { ...t, id: uid('turno'), nome: `${t.nome} (cópia)`, vagas: [...t.vagas] };
      cfg.turnos.push(copia);
      focar = `[data-id="${copia.id}"][data-campo="nome"]`;
      break;
    }
    case 'remover-turno': {
      const t = cfg.turnos.find((x) => x.id === id);
      if (!confirm(`Remover o turno ${t.nome || 'sem nome'}? Os nomes já lançados nele deixam de aparecer na escala.`)) return;
      cfg.turnos = cfg.turnos.filter((x) => x.id !== id);
      break;
    }
    case 'supervisor-colab': {
      const c = cfg.colaboradores.find((x) => x.id === id);
      c.papel = c.papel === 'supervisor' ? '' : 'supervisor';
      b.setAttribute('aria-pressed', String(c.papel === 'supervisor'));
      marcar();
      return; // sem redesenhar, para manter o foco no botão
    }
    case 'hub-sup': {
      const s = cfg.supervisores.find((x) => x.id === id);
      const hub = b.dataset.hub;
      s.hubIds = s.hubIds || [];
      s.hubIds = s.hubIds.includes(hub) ? s.hubIds.filter((x) => x !== hub) : [...s.hubIds, hub];
      b.setAttribute('aria-pressed', String(s.hubIds.includes(hub)));
      marcar();
      return; // sem redesenhar, para manter o foco no botão
    }
    case 'remover-sup': {
      const s = cfg.supervisores.find((x) => x.id === id);
      if (!confirm(`Remover o supervisor ${s.nome}?`)) return;
      cfg.supervisores = cfg.supervisores.filter((x) => x.id !== id);
      break;
    }
    case 'remover-colab':
      cfg.colaboradores = cfg.colaboradores.filter((x) => x.id !== id);
      break;
    case 'remover-data':
      cfg.datasEspeciais = cfg.datasEspeciais.filter((x) => x.id !== id);
      break;
    case 'ponto-hub':
      ponto.hubId = id;
      ponto.chaveFaixa = '';
      renderPonto();
      return;
    case 'ponto-modo':
      ponto.modo = b.dataset.valor;
      ponto.chaveFaixa = '';
      renderPonto();
      return;
    case 'ponto-anterior':
    case 'ponto-proximo': {
      const passo = acao === 'ponto-proximo' ? 1 : -1;
      ponto.ref = ponto.modo === 'semana' ? addDays(ponto.ref, passo * 7)
        : new Date(ponto.ref.getFullYear(), ponto.ref.getMonth() + passo, 1);
      ponto.chaveFaixa = '';
      renderPonto();
      return;
    }
    default:
      return;
  }
  renderAba();
  marcar();
  if (focar) el.conteudo.querySelector(focar)?.focus();
});

// O evento "toggle" de <details> não borbulha; escutamos na fase de captura
// para lembrar quem está aberto quando a lista de ponto se atualiza sozinha.
el.conteudo.addEventListener('toggle', (e) => {
  const det = e.target.closest?.('.pessoa-ponto');
  if (!det) return;
  if (det.open) ponto.expandido.add(det.dataset.chave);
  else ponto.expandido.delete(det.dataset.chave);
}, true);
