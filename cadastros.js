// Página 1 — Cadastros: hubs, turnos com vagas por dia, supervisores, colaboradores e datas especiais.
import { configuracaoPronta, lerConfig, salvarConfig } from './db.js';
import { entrar, sair, aoMudarLogin } from './auth.js';
import { datasDoAno, ROTULO_TIPO } from './feriados.js';
import {
  DIAS_CURTO, DIAS_LONGO, uid, escapeHtml, porNome, limparNome, normalizaNome,
  ordenaTurnos, faixaDoDia, vagasSemana, plural, parseIso, criarStatus
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
    colaboradores: renderColaboradores, datas: renderDatas })[aba]();
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
    ${cabecalho('Colaboradores', 'Os nomes aparecem como sugestão quando o supervisor digita na escala. Ele também pode escrever um nome que não está aqui, como um freelancer novo.')}
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
    default:
      return;
  }
  renderAba();
  marcar();
  if (focar) el.conteudo.querySelector(focar)?.focus();
});
