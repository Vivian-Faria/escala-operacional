# Escala de turnos

Sistema simples de lançamento de escala, com duas páginas:

- **`cadastros.html`** (protegida por senha): hubs, turnos com vagas por dia da semana, supervisores, colaboradores e feriados/datas especiais.
- **`index.html`** (link dos supervisores): o supervisor escolhe o nome e o hub, vê o calendário com as vagas e lança quem está em cada turno, se é fixo ou freelancer, e as folgas.

Os dados ficam no Firebase (Firestore). O site é 100% estático e roda no Netlify sem build.

---

## 1. Criar o projeto no Firebase

> Recomendo um **projeto novo**, separado do controle de freezers, para que as regras de segurança de um não interfiram no outro.

1. Acesse https://console.firebase.google.com e clique em **Adicionar projeto** (pode desativar o Google Analytics).
2. No menu, abra **Firestore Database → Criar banco de dados**. Escolha o **modo de produção** e a região `southamerica-east1 (São Paulo)`.
3. Vá em **Configurações do projeto (engrenagem) → Seus apps → ícone `</>`** para registrar um app da Web. Copie os valores do `firebaseConfig`.
4. Cole esses valores no arquivo **`firebase-config.js`**.

## 2. Criar o login de administrador

1. No menu, abra **Authentication → Começar → E-mail/senha** e ative.
2. Na aba **Users**, clique em **Adicionar usuário**. Use um e-mail seu e a senha que você vai digitar na página de Cadastros.
3. Coloque esse mesmo e-mail em `ADMIN_EMAIL` dentro de **`firebase-config.js`**.
4. (Recomendado) Em **Authentication → Configurações → Ações do usuário**, desative a criação de contas, para ninguém criar outro usuário.

## 3. Publicar as regras de segurança

1. Abra o arquivo **`firestore.rules`** e troque `admin@suaempresa.com.br` pelo seu e-mail de admin.
2. No Firebase, vá em **Firestore Database → Regras**, apague o conteúdo, cole o arquivo inteiro e clique em **Publicar**.

Com isso: qualquer pessoa com o link consegue ver e preencher a escala, mas só o administrador altera os cadastros.

## 4. Subir no GitHub e no Netlify

1. No repositório do GitHub, clique em **Add file → Upload files**, selecione todos os arquivos de uma vez e confirme.
2. No Netlify: **Add new site → Import an existing project → GitHub** e escolha o repositório.
3. Deixe **Build command** vazio e **Publish directory** como `.` (o `netlify.toml` já faz isso).
4. Após o deploy, se o login mostrar erro de domínio, adicione o endereço `seusite.netlify.app` em **Authentication → Configurações → Domínios autorizados**.

## 5. Usar

1. Abra `seusite.netlify.app/cadastros.html`, entre com a senha e cadastre, nesta ordem: hubs, turnos e vagas, supervisores, colaboradores e datas da cidade. Clique em **Salvar alterações**.
2. Envie `seusite.netlify.app` aos supervisores. Depois que ele escolhe nome e hub, o endereço na barra do navegador já guarda a escolha — dá para salvar nos favoritos ou na tela inicial do celular.

---

## Como funciona

| O quê | Onde |
|---|---|
| Vaga descoberta | Destacada em vermelho, com contagem no dia, no mês e no resumo do período |
| Visão do mês | Cada turno tem cor própria (manhã, tarde, noite). No computador, cada dia mostra os nomes escalados por turno, a fração coberta e o selo Completo ou quantas vagas seguem descobertas; no celular, um quadradinho por vaga |
| Fixo ou freelancer | Perguntado para cada nome lançado; muda para "não confirmado" se o nome for trocado |
| Folgas e faltas | Campo em cada turno de cada dia; o botão "Faltou" no nome escalado lança a falta e a vaga volta a contar como descoberta |
| Celular | Faixa com os 7 dias no topo e um dia aberto por vez |
| Conflitos | Aviso em vermelho se a mesma pessoa estiver em dois turnos que se sobrepõem (inclusive em hubs diferentes) ou escalada num turno em que está de folga |
| Feriados | Nacionais e datas comemorativas calculados automaticamente (Carnaval, Páscoa, Dia das Mães, Black Friday etc.); feriados da cidade são cadastrados na página 1 |
| Tempo real | Se dois supervisores estiverem com a escala aberta, um vê o que o outro lança sem recarregar |

### Estrutura dos dados

- `config/principal`: todos os cadastros (um documento só).
- `escalas/{hubId}_{AAAA-MM-DD}`: as vagas preenchidas, as folgas e as faltas de um hub em um dia.

### Arquivos

Todos ficam soltos na raiz do repositório (sem pastas):

```
index.html          página 2 — escala dos supervisores
cadastros.html      página 1 — cadastros (com senha)
style.css
firebase-config.js  ← único arquivo que você precisa editar
db.js               leitura e gravação no Firestore
auth.js             login do administrador
feriados.js         feriados nacionais e datas comemorativas
escala.js           lógica da página 2
cadastros.js        lógica da página 1
utils.js
firestore.rules     regras de segurança (colar no Firebase)
netlify.toml
```
