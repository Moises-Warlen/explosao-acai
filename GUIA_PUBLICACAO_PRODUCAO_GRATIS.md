# 🚀 GUIA DEFINITIVO DE IMPLANTAÇÃO EM PRODUÇÃO (100% GRATUITO)
## Sistema de Delivery Próprio & Gestão de Food Service — Explosão Açaí

Este manual foi elaborado **passo a passo para leigos**, explicando detalhadamente cada clique e comando necessário para colocar o seu delivery no ar na internet com **banco de dados real PostgreSQL** e **hospedagem gratuita com cadeado verde (HTTPS)**.

---

## 📌 Sumário
1. [Visão Geral da Arquitetura (Por que nada é mocado?)](#1-visão-geral-da-arquitetura)
2. [Serviços Gratuitos Utilizados](#2-serviços-gratuitos-utilizados)
3. [Passo 1: Criando o Banco de Dados PostgreSQL no Neon.tech](#passo-1-criando-o-banco-de-dados-postgresql-no-neontech)
4. [Passo 2: Subindo seu Código para o GitHub](#passo-2-subindo-seu-código-para-o-github)
5. [Passo 3: Criando o Servidor no Render.com](#passo-3-criando-o-servidor-no-rendercom)
6. [Passo 4: Configurando as Variáveis de Ambiente no Render](#passo-4-configurando-as-variáveis-de-ambiente-no-render)
7. [Passo 5: Ativação do Gateway de Pagamento Real (Mercado Pago Pix)](#passo-5-ativação-do-gateway-de-pagamento-real-mercado-pago-pix)
8. [Passo 6: Configuração de Impressora Térmica Física](#passo-6-configuração-de-impressora-térmica-física)
9. [Dica de Ouro: Mantendo o Servidor Acordado 24/7 de Graça (UptimeRobot)](#dica-de-ouro-mantendo-o-servidor-acordado-247-de-graça)
10. [Perguntas Frequentes & Solução de Problemas](#perguntas-frequentes--solução-de-problemas)

---

## 1. Visão Geral da Arquitetura
O sistema **Explosão Açaí** foi desenvolvido com **Clean Architecture (Arquitetura em Camadas)**. 
- **Sem dados falsos (Mocks):** Todos os pedidos realizados no cardápio, produtos criados, categorias, acompanhamentos, fotos, cupons de desconto, mensagens do chat ao vivo e configurações da loja são gravados diretamente no banco de dados.
- **Persistência Híbrida Inteligente:** 
  - Quando você roda localmente no seu computador sem internet, o sistema salva em `data/database.json`.
  - Quando você conecta uma URL de banco de dados (`DATABASE_URL`), ele se conecta automaticamente ao **PostgreSQL em nuvem**, criando as tabelas e mantendo tudo seguro, permanente e imune a reinicializações.

---

## 2. Serviços Gratuitos Utilizados

| Serviço | Função | Link de Acesso | Custo |
| :--- | :--- | :--- | :--- |
| **Neon.tech** | Banco de dados **PostgreSQL** profissional em nuvem | [https://neon.tech](https://neon.tech) | **R$ 0,00 (Grátis para sempre)** |
| **GitHub** | Repositório seguro para guardar o código-fonte | [https://github.com](https://github.com) | **R$ 0,00 (Grátis)** |
| **Render.com** | Servidor Node.js em nuvem com SSL (`https://`) e WebSockets | [https://render.com](https://render.com) | **R$ 0,00 (Grátis)** |
| **Mercado Pago** | Gateway para processar pagamentos Pix na sua conta | [https://www.mercadopago.com.br](https://www.mercadopago.com.br) | **Sem mensalidade** (taxa padrão de ~0.99% por Pix recebido) |

---

## Passo 1: Criando o Banco de Dados PostgreSQL no Neon.tech

O **Neon** fornece uma instância do PostgreSQL hospedada na AWS com altíssima velocidade, backup automático e plano gratuito permanente.

1. Acesse o site oficial: **[https://neon.tech](https://neon.tech)**
2. No canto superior direito, clique em **"Sign Up"** (Cadastrar-se).
3. Escolha **"Continue with Google"** (ou crie com seu e-mail).
4. Assim que entrar, clique no botão **"Create Project"** (Criar Projeto).
5. Preencha o formulário:
   - **Project Name**: digite `explosao-acai`
   - **Postgres version**: deixe a versão recomendada (ex: `16` ou `17`)
   - **Cloud service provider**: deixe `AWS`
   - **Region**: selecione `US East (Ohio)` ou `US East (N. Virginia)`
   - Clique em **"Create project"**.
6. Em poucos segundos, seu banco estará criado!
7. Na página inicial do seu projeto, localize a caixa **"Connection Details"**:
   - Verifique se a opção selecionada está em **"Node.js"** ou **"Parameters only"**.
   - Você verá um link parecido com este:
     ```text
     postgresql://neondb_owner:npg_AbCd123XyZ@ep-cool-lake-a512345.us-east-2.aws.neon.tech/neondb?sslmode=require
     ```
8. **Copie esse endereço completo** e guarde em um bloco de notas. Esse link é o seu `DATABASE_URL`.

---

## Passo 2: Subindo seu Código para o GitHub

O GitHub guardará seu código e permitirá que o Render atualize o site automaticamente sempre que você fizer melhorias.

### 2.1 Criar a conta e o repositório
1. Acesse: **[https://github.com](https://github.com)** e crie uma conta gratuita (ou faça login).
2. No canto superior direito, clique no ícone **`+`** e selecione **"New repository"** (Novo repositório).
3. Preencha:
   - **Repository name**: `explosao-acai`
   - **Visibility**: marque **Private** (Privado) se quiser manter seu código fechado, ou **Public** (Público) para exibir no seu LinkedIn.
   - **NÃO** marque "Add a README file" nem outras caixas (seu projeto já tem esses arquivos).
   - Clique em **"Create repository"** (Criar repositório).

### 2.2 Enviar os arquivos do seu computador para o GitHub
1. No seu computador, abra o terminal **PowerShell** ou o **Prompt de Comando**.
2. Navegue até a pasta do projeto digitando:
   ```powershell
   cd "c:\Users\Moises\Desktop\Delivery Acai"
   ```
3. Execute a sequência de comandos abaixo (copie e cole uma linha por vez, substituindo `SEU_USUARIO` pelo seu usuário do GitHub):
   ```powershell
   git remote add origin https://github.com/SEU_USUARIO/explosao-acai.git
   git branch -M master
   git push -u origin master
   ```
4. Se o GitHub pedir login no navegador, basta autorizar com 1 clique.
5. Ao concluir, atualize a página do GitHub: todos os arquivos do projeto estarão salvos lá!

---

## Passo 3: Criando o Servidor no Render.com

O Render será a máquina em nuvem responsável por servir o cardápio do cliente e o painel administrativo 24 horas por dia.

1. Acesse: **[https://render.com](https://render.com)**
2. Clique em **"Get Started"** e escolha **"Sign in with GitHub"** (isso conecta suas contas automaticamente).
3. No painel do Render, clique no botão azul **"New +"** (no topo) e selecione **"Web Service"**.
4. Selecione a opção **"Build and deploy from a Git repository"** e clique em **Next**.
5. Na lista que aparecer, localize o repositório **`explosao-acai`** e clique em **"Connect"**.
6. Preencha as configurações do serviço:
   - **Name**: `explosao-acai` *(esse nome formará seu link gratuito, ex: `explosao-acai.onrender.com`)*.
   - **Region**: escolha `Ohio (US East)` (mesma região do banco Neon para maior velocidade).
   - **Branch**: `master`
   - **Root Directory**: deixe em branco.
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: selecione **Free ($0/month)**.

---

## Passo 4: Configurando as Variáveis de Ambiente no Render

Ainda na tela de criação do serviço no Render (ou clicando no menu **"Environment"** à esquerda):

1. Role a página até a seção **"Environment Variables"** (Variáveis de Ambiente).
2. Clique no botão **"Add Environment Variable"** para adicionar cada uma das variáveis abaixo:

| Key (Nome da Variável) | Value (Valor que você deve colocar) | Descrição |
| :--- | :--- | :--- |
| `DATABASE_URL` | *(cole aqui o link completo que você copiou do Neon)* | Conecta seu servidor ao banco PostgreSQL em nuvem |
| `NODE_ENV` | `production` | Ativa o modo de alto desempenho |
| `ADMIN_PASSWORD` | `explosao123` *(ou a senha que você preferir)* | Senha para você entrar no `/admin` |
| `STORE_NAME` | `Explosão Açaí` | Nome oficial do seu negócio |
| `STORE_PHONE` | `5516991098863` | WhatsApp oficial para envio de pedidos |
| `STORE_ADDRESS` | `Rua Renato Lourenço Fernandes Rosa, 1721, Franca - SP` | Endereço físico do seu estabelecimento |
| `MERCADO_PAGO_ACCESS_TOKEN` | *(seu token de produção do Mercado Pago - ver Passo 5)* | Chave para receber Pix real na sua conta |

3. Clique no botão azul **"Create Web Service"** (Criar Web Service).
4. O Render começará a compilar e iniciar o sistema. Esse processo dura cerca de **2 minutos**.
5. Quando o status mudar para **"Live"** com um círculo verde, seu delivery estará oficialmente no ar!

### Seus Links Oficiais de Acesso:
- **Cardápio do Cliente (Mobile & Desktop):**  
  `https://explosao-acai.onrender.com`
- **Painel Administrativo do Dono da Loja:**  
  `https://explosao-acai.onrender.com/admin`

*(Você pode acessar esses links de qualquer celular, tablet ou computador do mundo!)*

---

## Passo 5: Ativação do Gateway de Pagamento Real (Mercado Pago Pix)

Para que o Pix caia diretamente na sua conta bancária do Mercado Pago:

1. Acesse: **[https://www.mercadopago.com.br/developers/panel](https://www.mercadopago.com.br/developers/panel)**
2. Faça login com a conta do Mercado Pago onde você deseja receber o dinheiro das vendas.
3. Clique em **"Suas integrações"** -> **"Criar aplicação"**:
   - **Nome da aplicação**: `Delivery Explosão Açaí`
   - **Tipo de solução**: `Pagamentos online`
   - **Qual produto você está integrando?**: `Checkout Transparente`
4. Na tela da aplicação criada, no menu lateral esquerdo, clique em **"Credenciais de produção"**:
   - Preencha os dados da sua loja (CNPJ ou CPF, ramo de alimentação).
   - Você verá o campo **Access Token** (começa com `APP_USR-...`).
5. Copie esse **Access Token** de produção.
6. Volte no painel do Render, abra seu serviço `explosao-acai`, clique na aba **"Environment"**, edite a variável `MERCADO_PAGO_ACCESS_TOKEN`, cole seu token oficial e clique em **"Save Changes"**.
7. Pronto! A partir desse momento, quando um cliente escolher pagar por Pix:
   - O sistema gera um QR Code oficial do Banco Central e o código Pix Copia e Cola.
   - Assim que o cliente paga no banco dele, o Mercado Pago confirma automaticamente.
   - O painel da cozinha toca o alerta sonoro e libera a impressão da comanda!

---

## Passo 6: Configuração de Impressora Térmica Física

O Explosão Açaí possui suporte nativo para qualquer impressora térmica do mercado (USB, Rede ou Bluetooth):
- Modelos homologados: **Epson TM-T20**, **Elgin i7 / i9**, **Bematech MP-4200**, **Daruma**, **ZJ-58**, e mini-impressoras Bluetooth térmicas de 58mm ou 80mm.

### Como Imprimir:
1. Conecte sua impressora térmica no computador do balcão ou da cozinha e instale o driver padrão do fabricante no Windows.
2. No painel `/admin`, ao clicar no botão **"Imprimir Cozinha"** ou **"Imprimir Balcão"**:
   - A janela de impressão do navegador será aberta instantaneamente com a comanda já formatada.
   - Selecione a impressora térmica instalada.
   - Desmarque a opção "Cabeçalhos e rodapés" nas opções de impressão para que o cupom saia limpo.
   - O corte de papel ou picote funcionará perfeitamente.

---

## Dica de Ouro: Mantendo o Servidor Acordado 24/7 de Graça

No plano gratuito do Render, se ninguém acessar o cardápio por 15 minutos seguidos, o servidor entra em modo de repouso ("sleep"). Quando um cliente entra, ele leva cerca de 25 a 30 segundos para acordar.

Para evitar isso e manter seu cardápio abrindo **instantaneamente a qualquer hora do dia ou da noite**, usamos um robô gratuito que faz uma visita ao seu site a cada 5 minutos:

1. Acesse: **[https://uptimerobot.com](https://uptimerobot.com)** (gratuito).
2. Crie sua conta com e-mail e senha.
3. Clique em **"Add New Monitor"**:
   - **Monitor Type**: `HTTP(s)`
   - **Friendly Name**: `Explosão Açaí`
   - **URL (or IP)**: cole o endereço do seu site (ex: `https://explosao-acai.onrender.com/api/store/status`)
   - **Monitoring Interval**: `5 minutes`
4. Clique em **"Create Monitor"**.
5. Pronto! O UptimeRobot enviará um sinal a cada 5 minutos, garantindo que o seu servidor Render nunca durma e fique 100% rápido para todos os seus clientes, sem custar um centavo.

---

## Perguntas Frequentes & Solução de Problemas

### 1. Se eu desligar meu computador, o site continua funcionando?
**Sim!** Como o código está no Render e o banco de dados no Neon, tudo roda na nuvem em computadores de alta disponibilidade da Amazon AWS. Você pode desligar seu computador e os clientes continuarão fazendo pedidos normalmente pelo celular.

### 2. O que acontece se a loja estiver fechada?
No painel `/admin`, no canto superior direito, há o interruptor **"Loja ABERTA / Loja FECHADA"**. Ao mudar para FECHADA, o cardápio avisa os clientes instantaneamente de que a loja está fechada e bloqueia novos envios de pedidos.

### 3. Como recebo pagamentos em Cartão e Dinheiro?
- **Cartão de Crédito e Débito**: O cliente seleciona essa opção e o entregador leva a maquininha física na entrega.
- **Dinheiro**: O cliente informa se precisa de troco (ex: R$ 50). A comanda já sai impressa com o valor exato que o motoboy deve levar de troco.

### 4. Como alterar preços, criar novos açaís ou pausar produtos?
Tudo é feito diretamente pela interface do painel `/admin`, sem mexer em nenhuma linha de código:
- **Pausar um produto:** Clique no botão verde "Ativo" para virar "Pausado" (ele some do cardápio imediatamente).
- **Criar novo produto ou sabor:** Clique em "+ Novo Produto", escolha a foto do seu computador, digite os ingredientes, os preços de 300ml, 500ml e 700ml e o limite de acompanhamentos.
- **Prejuízo:** Se o custo dos insumos for maior que o preço de venda, o sistema avisa na hora em vermelho para você não perder dinheiro!

---

**Explosão Açaí — Engenharia de Software Profissional & Food Service**  
Desenvolvido por Moises Warlen.
