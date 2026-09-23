// Acesso ao Firestore e ao Storage. Lugares que guardam tudo:
//   config/principal             → hubs, turnos (com vagas), supervisores, colaboradores, datas especiais
//   escalas/{hubId}_{AAAA-MM-DD} → quem está em cada vaga (fixo ou freelancer), folgas e faltas do dia
//   pontos/{hubId}_{AAAA-MM-DD}  → horário batido por cada colaborador naquele hub e dia
//   Storage: pontos/{hubId}/{AAAA-MM-DD}/{nome}/{batida}.jpg → selfies do ponto
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore, doc, getDoc, setDoc, onSnapshot, collection, query, where, serverTimestamp,
  arrayUnion, arrayRemove
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';
import { firebaseConfig } from './firebase-config.js';

let app;
let db;
let storage;

export function configuracaoPronta() {
  return Boolean(firebaseConfig.apiKey) && !firebaseConfig.apiKey.startsWith('COLE');
}
export function obterApp() {
  if (!app) app = initializeApp(firebaseConfig);
  return app;
}
function obterDb() {
  if (!db) db = getFirestore(obterApp());
  return db;
}
function obterStorage() {
  if (!storage) storage = getStorage(obterApp());
  return storage;
}

const refConfig = () => doc(obterDb(), 'config', 'principal');

function montarConfig(snap) {
  const d = snap.exists() ? snap.data() : {};
  return {
    hubs: d.hubs || [],
    turnos: d.turnos || [],
    supervisores: d.supervisores || [],
    colaboradores: d.colaboradores || [],
    datasEspeciais: d.datasEspeciais || []
  };
}

export async function lerConfig() {
  return montarConfig(await getDoc(refConfig()));
}

export function ouvirConfig(aoReceber, aoErrar) {
  return onSnapshot(refConfig(), (snap) => aoReceber(montarConfig(snap)), aoErrar);
}

export async function salvarConfig(cfg) {
  await setDoc(refConfig(), {
    hubs: cfg.hubs,
    turnos: cfg.turnos,
    supervisores: cfg.supervisores,
    colaboradores: cfg.colaboradores,
    datasEspeciais: cfg.datasEspeciais,
    atualizadoEm: serverTimestamp()
  });
}

// Escuta os lançamentos de todos os hubs no período (usado também para
// avisar quando alguém foi escalado em dois lugares ao mesmo tempo).
export function ouvirEscalas(inicioIso, fimIso, aoReceber, aoErrar) {
  const q = query(
    collection(obterDb(), 'escalas'),
    where('data', '>=', inicioIso),
    where('data', '<=', fimIso)
  );
  return onSnapshot(q, (snap) => {
    const mapa = {};
    snap.forEach((d) => { mapa[d.id] = d.data(); });
    aoReceber(mapa);
  }, aoErrar);
}

// Grava uma única vaga. `dados` pode ter {nome, tipo} ou só {tipo}.
// Com merge, só aquela vaga muda — dois supervisores preenchendo vagas
// diferentes ao mesmo tempo não apagam o trabalho um do outro.
export async function salvarVaga(hubId, dataIso, turnoId, indice, dados, supervisor) {
  await setDoc(doc(obterDb(), 'escalas', `${hubId}_${dataIso}`), {
    hubId,
    data: dataIso,
    slots: { [turnoId]: { [String(indice)]: dados } },
    atualizadoPor: supervisor,
    atualizadoEm: serverTimestamp()
  }, { merge: true });
}

// Lança uma folga ou falta num turno. Um nome não fica nas duas listas ao
// mesmo tempo: lançar como falta tira da folga, e vice-versa.
export async function lancarAusencia(hubId, dataIso, turnoId, nome, campo, supervisor) {
  const outro = campo === 'faltas' ? 'folgas' : 'faltas';
  await setDoc(doc(obterDb(), 'escalas', `${hubId}_${dataIso}`), {
    hubId,
    data: dataIso,
    [campo]: { [turnoId]: arrayUnion(nome) },
    [outro]: { [turnoId]: arrayRemove(nome) },
    atualizadoPor: supervisor,
    atualizadoEm: serverTimestamp()
  }, { merge: true });
}

export async function removerAusencia(hubId, dataIso, turnoId, nome, campo, supervisor) {
  await setDoc(doc(obterDb(), 'escalas', `${hubId}_${dataIso}`), {
    hubId,
    data: dataIso,
    [campo]: { [turnoId]: arrayRemove(nome) },
    atualizadoPor: supervisor,
    atualizadoEm: serverTimestamp()
  }, { merge: true });
}

// ================= Ponto (registro de horário com foto) =================
const refPonto = (hubId, dataIso) => doc(obterDb(), 'pontos', `${hubId}_${dataIso}`);

// Envia a selfie ao Storage. Só devolve o caminho: quem bate o ponto não tem
// login, então não consegue (nem precisa) ler o link da foto de volta — só o
// administrador, na conciliação, consegue abrir (ver storage.rules).
export async function enviarFotoPonto(hubId, dataIso, nomeChave, campo, blob) {
  const caminho = `pontos/${hubId}/${dataIso}/${nomeChave}/${campo}-${Date.now()}.jpg`;
  await uploadBytes(ref(obterStorage(), caminho), blob, { contentType: blob.type || 'image/jpeg' });
  return { path: caminho };
}

// Gera o link de uma foto já enviada. Só funciona para quem está logado como
// administrador (as regras do Storage recusam para qualquer outra pessoa).
export async function obterUrlFoto(caminho) {
  return getDownloadURL(ref(obterStorage(), caminho));
}

// Acompanha o registro de UM colaborador num dia (usado na página de Ponto,
// para saber o que já foi batido e não deixar bater de novo sem querer).
export function ouvirPontoDoDia(hubId, dataIso, nomeChave, aoReceber, aoErrar) {
  return onSnapshot(refPonto(hubId, dataIso), (snap) => {
    const registros = snap.exists() ? (snap.data().registros || {}) : {};
    aoReceber(registros[nomeChave] || null);
  }, aoErrar);
}

// Grava uma batida (chegada, saídaAlmoço, voltaAlmoço ou saída).
export async function salvarBatida(hubId, dataIso, nomeChave, nome, campo, hora, foto) {
  await setDoc(refPonto(hubId, dataIso), {
    hubId,
    data: dataIso,
    registros: { [nomeChave]: { nome, [campo]: { hora, fotoPath: foto.path } } },
    atualizadoEm: serverTimestamp()
  }, { merge: true });
}

// Todos os registros de ponto do período (usado na conciliação em Cadastros).
export function ouvirPontos(inicioIso, fimIso, aoReceber, aoErrar) {
  const q = query(
    collection(obterDb(), 'pontos'),
    where('data', '>=', inicioIso),
    where('data', '<=', fimIso)
  );
  return onSnapshot(q, (snap) => {
    const mapa = {};
    snap.forEach((d) => { mapa[d.id] = d.data(); });
    aoReceber(mapa);
  }, aoErrar);
}
