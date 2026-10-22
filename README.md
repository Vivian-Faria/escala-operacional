# Escala de turnos

Sistema simples de lançamento de escala, com duas páginas:

- **`cadastros.html`** (protegida por senha): hubs, turnos com vagas por dia da semana, supervisores, colaboradores, feriados/datas especiais e os buracos abertos na escala.
- **`index.html`** (link dos supervisores): o supervisor escolhe o nome e o hub, vê o calendário com as vagas e lança quem está em cada turno, se é fixo, freelancer ou intermitente, e as folgas e faltas.

Os dados ficam no Firebase (Firestore). O site é 100% estático e roda no Netlify sem build.

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

> Sempre que o arquivo `firestore.rules` for atualizado (como agora, com os campos de confirmação e comparecimento), repita o passo 2 — sem isso, o Firestore recusa as gravações novas.

Com isso: qualquer pessoa com o link vê e preenche a escala, mas só o administrador altera os cadastros.

## 4. Subir no GitHub e no Netlify

1. No repositório do GitHub, clique em **Add file → Upload files**, selecione todos os arquivos de uma vez e confirme.
2. No Netlify: **Add new site → Import an existing project → GitHub** e escolha o repositório.
3. Deixe **Build command** vazio e **Publish directory** como `.` (o `netlify.toml` já faz isso).
4. Após o deploy, se o login mostrar erro de domínio, adicione o endereço `seusite.netlify.app` em **Authentication → Configurações → Domínios autorizados** (no Firebase).

## 5. Usar

1. Abra `seusite.netlify.app/cadastros.html`, entre com a senha e cadastre, nesta ordem: hubs, turnos e vagas, supervisores, colaboradores e datas da cidade. Clique em **Salvar alterações**.
2. Envie `seusite.netlify.app` aos supervisores, para a escala. Depois que ele escolhe nome e hub, o endereço na barra do navegador já guarda a escolha — dá para salvar nos favoritos ou na tela inicial do celular.

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
| Folgas e faltas | Campo em cada turno de cada dia, para quem não está numa vaga específica; lançar como falta tira da folga e vice-versa |
| Nome só por cadastro | Nas vagas, reforços e folgas/faltas, o supervisor escolhe o nome numa lista (só quem já está cadastrado em Colaboradores) em vez de digitar; evita nomes repetidos com grafia diferente. Para escalar alguém novo, cadastre a pessoa primeiro em Cadastros → Colaboradores |
| Confirmou horário / Compareceu | Em cada pessoa escalada, direto na grade: um botão "Confirmou horário" (alternador) e dois botões "Compareceu" / "Não compareceu" (um exclui o outro; tocar de novo no mesmo desmarca, voltando a pendente). "Não compareceu" volta a contar como vaga descoberta, igual ao antigo "Faltou" |
| Celular | Faixa com os 7 dias no topo e um dia aberto por vez |
| Conflitos | Aviso em vermelho se a mesma pessoa estiver em dois turnos que se sobrepõem (inclusive em hubs diferentes) ou escalada num turno em que está de folga |
| Feriados | Nacionais e datas comemorativas calculados automaticamente (Carnaval, Páscoa, Dia das Mães, Black Friday etc.); feriados da cidade são cadastrados na página 1 |
| Tempo real | Se duas pessoas estiverem com a mesma página aberta, uma vê o que a outra lança sem recarregar |
| Buracos na escala | Em Cadastros → aba "Buracos na escala": por hub (ou todos juntos) e por período (semana ou mês), lista os trechos de horário que ainda não têm gente suficiente, turno por turno, somando vagas vazias e vagas parcialmente cobertas. O botão "Copiar lista" copia tudo em texto simples, pronto para colar num grupo |
| Lembrete de prazo | Na página da escala, toda segunda e sexta das 14h às 16h aparece uma faixa com a contagem regressiva para lançar a escala (segunda = semana atual, sexta = semana seguinte) e se já está lançada/completa; depois das 16h, mostra "Prazo encerrado" por 24h com a mesma informação; fora dessas janelas, some. Vale para todos os hubs juntos e usa a hora real do aparelho, então funciona igual em qualquer dispositivo ou depois de recarregar |
| Colaborador fixo e escala-base | Em Cadastros → aba Colaboradores, marque "Fixo" em quem tem um padrão único (dias da semana + 1 turno) e escolha o turno e os dias. Depois, em "Gerar escala-base", escolha hub e período e clique em Gerar: preenche automaticamente as vagas ainda vazias desses colaboradores, sem mexer no que já foi preenchido à mão nem duplicar quem já está escalado |
| Indicadores de confiabilidade | Em Cadastros → aba "Indicadores de confiabilidade": por colaborador, calcula % de confirmação de horário e % de comparecimento (excluindo quem ainda está pendente de marcação) no período escolhido, e classifica como Confiável, Em observação, Não confiável ou Sem dados suficientes. Os limites (padrão: confiável a partir de 90%, não confiável abaixo de 70%) são configuráveis no topo da aba. Nomes com grafias bem parecidas (ex.: "Lucas Luan" e "Lucas Luann") já são reconhecidos automaticamente como a mesma pessoa |
| Outras grafias (apelidos) | Em Cadastros → aba Colaboradores, cada pessoa tem um campo "Outras grafias já usadas" (opcional, separadas por vírgula). Use para grafias bem diferentes que o reconhecimento automático não pega sozinho (ex.: cadastre "Julie" e em "Outras grafias" coloque "Jiule, Julie Helena") — assim os Indicadores somam tudo numa linha só, mesmo com lançamentos antigos escritos diferente |

### Estrutura dos dados

- `config/principal`: todos os cadastros (um documento só), incluindo `limitesConfiabilidade` (os limites da classificação).
- `escalas/{hubId}_{AAAA-MM-DD}`: as vagas preenchidas, as folgas, as faltas, as confirmações de horário e os comparecimentos de um hub em um dia.
  Cada vaga guarda uma lista de pessoas: `{partes: [{nome, tipo, inicio, fim}]}`. Sem `inicio`/`fim`, a pessoa cobre o turno inteiro.
  `confirmacoes` e `compareceram` guardam, por turno, os nomes marcados — mesmo formato de `folgas`/`faltas`.

### Arquivos

Todos ficam soltos na raiz do repositório (sem pastas):

```
index.html            página 2 — escala dos supervisores
cadastros.html        página 1 — cadastros e buracos na escala
style.css
firebase-config.js    ← edite com os dados do seu projeto Firebase
db.js                 leitura e gravação no Firestore
auth.js               login do administrador
feriados.js           feriados nacionais e datas comemorativas
escala.js             lógica da página 2
cadastros.js          lógica da página 1 (cadastros + buracos na escala)
utils.js
firestore.rules       regras de segurança do Firestore (colar no Firebase)
netlify.toml
```
