// Acesso ao Firestore. Dois lugares guardam tudo:
//   config/principal             → hubs, turnos (com vagas), supervisores, colaboradores, datas especiais
//   escalas/{hubId}_{AAAA-MM-DD} → quem está em cada vaga (fixo ou freelancer), folgas e faltas do dia
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore, doc, getDoc, setDoc, onSnapshot, collection, query, where, serverTimestamp,
  arrayUnion, arrayRemove
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

let app;
let db;

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
