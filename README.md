# Escala de turnos

Sistema simples de lançamento de escala, com três páginas:

- **`cadastros.html`** (protegida por senha): hubs, turnos com vagas por dia da semana, supervisores, colaboradores, feriados/datas especiais e a conciliação do ponto.
- **`index.html`** (link dos supervisores): o supervisor escolhe o nome e o hub, vê o calendário com as vagas e lança quem está em cada turno, se é fixo, freelancer ou intermitente, e as folgas e faltas.
- **`ponto.html`** (link dos colaboradores, sem senha): cada um registra a própria chegada, saída para o almoço, volta do almoço e saída, com uma selfie a cada batida.

Os dados de texto ficam no Firebase (Firestore). As selfies do ponto ficam no **Cloudinary**, num plano gratuito que não pede cartão de crédito. O site é 100% estático e roda no Netlify sem build.

> **Aviso importante:** o Ponto desta ferramenta é um controle interno, para comparar o previsto com o realizado e ter uma base de horas trabalhadas. Ele **não substitui** um sistema de ponto eletrônico oficial, caso a empresa já tenha um homologado conforme a legislação trabalhista (Portaria 671/2021).

---

## 1. Criar o projeto no Firebase

> Recomendo um **projeto novo**, separado de outros sistemas, para que as regras de segurança de um não interfiram no outro.

1. Acesse https://console.firebase.google.com e clique em **Adicionar projeto** (pode desativar o Google Analytics).
2. No menu, abra **Firestore Database → Criar banco de dados**. Escolha o **modo de produção** e a região `southamerica-east1 (São Paulo)`.
3. Vá em **Configurações do projeto (engrenagem) → Seus apps → ícone `</>`** para registrar um app da Web. Copie os valores do `firebaseConfig`.
4. Cole esses valores no arquivo **`firebase-config.js`**.

## 2. Criar o login de administrador

1. No menu, abra **Authentication → Começar → E-mail/senha** e ative.
2. Na aba **Users**, clique em **Adicionar usuário**. Use um e-mail seu e a senha que você vai digitar na página de Cadastros.
3. Coloque esse mesmo e-mail em `ADMIN_EMAIL` dentro de **`firebase-config.js`**.
4. (Recomendado) Em **Authentication → Configurações → Ações do usuário**, desative a criação de contas, para ninguém criar outro usuário.

## 3. Publicar as regras de segurança do Firestore

1. Abra o arquivo **`firestore.rules`** e troque o e-mail de exemplo pelo seu e-mail de admin.
2. No Firebase, vá em **Firestore Database → Regras**, apague o conteúdo, cole o arquivo inteiro e clique em **Publicar**.

Com isso: qualquer pessoa com o link vê e preenche a escala e bate o próprio ponto, mas só o administrador altera os cadastros.

## 4. Criar a conta do Cloudinary (guarda as selfies do ponto, de graça)

O Firebase Storage passou a exigir cartão de crédito para ser ativado, então as fotos do ponto usam o **Cloudinary**, que tem um plano gratuito sem cartão (25 GB por mês entre armazenamento e visualização — muito acima do que um ponto de equipe gera).

1. Crie uma conta gratuita em https://cloudinary.com/users/register/free (dá para entrar com o Google, não pede cartão).
2. No painel, clique na engrenagem **Settings → Upload**. Em "Upload presets", clique em **Add upload preset**.
3. Configure: **Signing Mode: Unsigned**, e em **Folder** coloque `pontos`. Salve.
4. Copie o **nome do preset** que você acabou de criar.
5. No topo do painel (Dashboard), copie o **Cloud name**.
6. Abra o arquivo **`cloudinary-config.js`** e cole os dois valores.

## 5. Subir no GitHub e no Netlify

1. No repositório do GitHub, clique em **Add file → Upload files**, selecione todos os arquivos de uma vez e confirme.
2. No Netlify: **Add new site → Import an existing project → GitHub** e escolha o repositório.
3. Deixe **Build command** vazio e **Publish directory** como `.` (o `netlify.toml` já faz isso).
4. Após o deploy, se o login mostrar erro de domínio, adicione o endereço `seusite.netlify.app` em **Authentication → Configurações → Domínios autorizados** (no Firebase).

## 6. Usar

1. Abra `seusite.netlify.app/cadastros.html`, entre com a senha e cadastre, nesta ordem: hubs, turnos e vagas, supervisores, colaboradores e datas da cidade. Clique em **Salvar alterações**.
2. Envie `seusite.netlify.app` aos supervisores, para a escala. Depois que ele escolhe nome e hub, o endereço na barra do navegador já guarda a escolha — dá para salvar nos favoritos ou na tela inicial do celular.
3. Envie `seusite.netlify.app/ponto.html` aos colaboradores, para o ponto. Mesma lógica: depois de digitar o nome uma vez, o celular lembra.
4. A conciliação fica em **Cadastros → aba Ponto**.

---

## Como funciona

| O quê | Onde |
|---|---|
| Progresso | O resumo do período mostra a porcentagem já preenchida (ex: "54% da escala do mês preenchida"), com barra ao lado |
| Vaga descoberta | Destacada em vermelho, com contagem no dia, no mês e no resumo do período |
| Visão do mês | Cada turno tem cor própria (manhã, tarde, noite). No computador, cada dia mostra os nomes escalados por turno, a fração coberta e o selo Completo ou quantas vagas seguem descobertas; no celular, um quadradinho por vaga |
| Tipo de contrato | Fixo, freelancer ou intermitente, perguntado para cada nome lançado; volta a "não confirmado" se o nome for trocado |
| Supervisor sobressalente | Na aba Colaboradores, marque quem fica na operação como reforço (não ocupa vaga fixa). Quando a folga dele é lançada num turno e a vaga correspondente fica vazia, ela some da contagem de furos ("Dispensado" em vez de "0/1"); ainda dá para lançar um reforço ali se quiser |
| Vaga dividida | O botão "Dividir horário" permite cobrir uma vaga com duas ou mais pessoas em horários quebrados (ex: freela das 12:00 às 17:00 e intermitente das 17:00 às 00:00). A vaga só fica completa quando não sobra buraco; enquanto sobrar, aparece "Falta cobrir HH:MM–HH:MM" |
| Folgas e faltas | Campo em cada turno de cada dia; o botão "Faltou" no nome escalado lança a falta e a vaga volta a contar como descoberta |
| Celular | Faixa com os 7 dias no topo e um dia aberto por vez |
| Conflitos | Aviso em vermelho se a mesma pessoa estiver em dois turnos que se sobrepõem (inclusive em hubs diferentes) ou escalada num turno em que está de folga |
| Feriados | Nacionais e datas comemorativas calculados automaticamente (Carnaval, Páscoa, Dia das Mães, Black Friday etc.); feriados da cidade são cadastrados na página 1 |
| Tempo real | Se duas pessoas estiverem com a mesma página aberta, uma vê o que a outra lança sem recarregar |
| Ponto por selfie | Na página `ponto.html`, sempre o dia de hoje: 4 passos em ordem (chegada, saída para o almoço, volta do almoço, saída). Cada um abre a câmera do celular, tira a foto e grava o horário do toque. Dá para corrigir uma batida errada a qualquer momento |
| Conciliação do ponto | Em Cadastros → aba Ponto: por hub e por período (semana ou mês), mostra cada colaborador com o total previsto na escala e o total batido, e por dia as 4 horas batidas, o total do dia e a diferença. Toque num horário para abrir a selfie daquela batida |

### Sobre a privacidade das fotos

As fotos ficam no Cloudinary. Diferente de um cofre com senha, o link de cada foto funciona para quem o tiver — mas esse link só aparece dentro da aba Ponto de Cadastros, que exige a senha de administrador para ser aberta. Ele não fica visível em nenhuma tela pública, nem para quem bateu o ponto. Vale avisar os colaboradores que a selfie é usada só para esse controle interno.

Se um dia quiser um controle mais rígido (o link não funcionar para ninguém fora do admin), a alternativa é voltar ao Firebase Storage — que exige o plano pago (Blaze) do Firebase, mas com custo próximo de zero para esse volume de fotos.

### Estrutura dos dados

- `config/principal`: todos os cadastros (um documento só).
- `escalas/{hubId}_{AAAA-MM-DD}`: as vagas preenchidas, as folgas e as faltas de um hub em um dia.
  Cada vaga guarda uma lista de pessoas: `{partes: [{nome, tipo, inicio, fim}]}`. Sem `inicio`/`fim`, a pessoa cobre o turno inteiro.
- `pontos/{hubId}_{AAAA-MM-DD}`: as batidas do dia de cada colaborador naquele hub — `{registros: {nomeNormalizado: {nome, chegada: {hora, fotoUrl}, saidaAlmoco: {...}, voltaAlmoco: {...}, saida: {...}}}}`.
- Cloudinary, pasta `pontos/{hubId}/{AAAA-MM-DD}/{nomeNormalizado}/`: as selfies de cada batida.

### Arquivos

Todos ficam soltos na raiz do repositório (sem pastas):

```
index.html            página 2 — escala dos supervisores
cadastros.html        página 1 — cadastros (com senha) e conciliação do ponto
ponto.html            página 3 — registro de ponto por selfie
style.css
firebase-config.js    ← edite com os dados do seu projeto Firebase
cloudinary-config.js  ← edite com os dados da sua conta Cloudinary
db.js                 leitura e gravação no Firestore, e envio das fotos ao Cloudinary
auth.js               login do administrador
feriados.js           feriados nacionais e datas comemorativas
escala.js             lógica da página 2
cadastros.js          lógica da página 1 (cadastros + conciliação do ponto)
ponto.js              lógica da página 3
utils.js
firestore.rules       regras de segurança do Firestore (colar no Firebase)
netlify.toml
```
