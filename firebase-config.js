// ============================================================
//  CONFIGURAÇÃO DO FIREBASE
//  1) Console do Firebase → Configurações do projeto → Seus apps → App da Web
//     Copie os valores do objeto firebaseConfig e cole abaixo.
//  2) Troque ADMIN_EMAIL pelo e-mail do usuário administrador que você
//     criar em Authentication → Users. Use o mesmo e-mail no firestore.rules.
// ============================================================

export const firebaseConfig = {
  apiKey: "AIzaSyCJ2FIH8OHrc6TOAUYIZ03JffGwRM7AV2w",
  authDomain: "escalas-operacional-orion.firebaseapp.com",
  projectId: "escalas-operacional-orion",
  storageBucket: "escalas-operacional-orion.firebasestorage.app",
  messagingSenderId: "177727321086",
  appId: "1:177727321086:web:c000db0f411ce0eb6e06af"
};

export const ADMIN_EMAIL = "admin@suaempresa.com.br";
