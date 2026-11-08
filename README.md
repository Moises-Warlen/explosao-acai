# 🍨 Explosão Açaí — Plataforma de Delivery Próprio & Gestão de Food Service

![Node.js](https://img.shields.io/badge/Node.js-v22+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-5.x-000000?style=for-the-badge&logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14+-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Prisma ORM](https://img.shields.io/badge/Prisma-ORM-2D3748?style=for-the-badge&logo=prisma&logoColor=white)
![Mercado Pago](https://img.shields.io/badge/Mercado%20Pago-Gateway-009EE3?style=for-the-badge&logo=mercadopago&logoColor=white)
![Thermal Print](https://img.shields.io/badge/ESC%2FPOS-Thermal%20Print-FFC800?style=for-the-badge)
![Tests](https://img.shields.io/badge/Tests-15%2F15%20Passing-brightgreen?style=for-the-badge)

> **Projeto de Engenharia de Software de Alto Padrão para Portfólio no LinkedIn e GitHub:**  
> Solução completa de delivery próprio e gestão operacional para estabelecimentos de alimentação (*food service*), estruturada em **Clean Architecture (Arquitetura em Camadas)**, com banco de dados relacional **PostgreSQL com Prisma ORM**, gateway **Mercado Pago (Pix dinâmico com QR Code em Base64 e Cartão)**, **impressão térmica multi-estação (Cozinha vs Balcão) com trava de segurança de pagamento**, **ficha técnica de insumos com detecção automática de prejuízo**, **soma automática de custos de combos**, **regras dinâmicas de acompanhamentos inclusos por tamanho**, **relatórios de vendas com gráficos de mais e menos vendidos e exportação em PDF A4 com fotos**, **upload real de fotos do computador**, **chat ao vivo em tempo real** e painel administrativo executivo.

---

## 🏛️ Arquitetura em Camadas (Clean Architecture)

```mermaid
flowchart TD
    subgraph Presentation["Camada de Apresentação (Presentation Layer)"]
        UI_Customer["Cardápio Digital PWA / SPA (Cliente Mobile-First)"]
        UI_Admin["Painel Administrativo (Gestão, Kanban, Ficha Técnica & PDF)"]
        Controllers["Controllers REST, Middlewares de Autenticação & Upload Multer"]
    end

    subgraph Application["Camada de Aplicação (Application Services)"]
        OrderService["OrderService (Orquestração de Pedidos & Trava de Impressão)"]
        CatalogService["CatalogService (Categorias, Produtos, Combos, Acompanhamentos & Margem)"]
        CouponService["CouponService (Cupons, Descontos & Compartilhamento no Chat/Zap)"]
        ReportService["ReportService (Consolidação Financeira, Tempos Médios & Rankings)"]
        StoreService["StoreService (Status Aberto/Fechado, Horários & Tarifas de Frete)"]
        ChatService["ChatService (Mensagens em Tempo Real & Histórico)"]
    end

    subgraph Domain["Camada de Domínio (Domain Entities - Core)"]
        Order["Entidade: Order & OrderItem (Troco, Itens, Custos, Tempos, Trava de Impressão)"]
        Product["Entidade: Product & SizePrice (Tamanhos Dinâmicos, Alerta de Prejuízo & Combos)"]
        Coupon["Entidade: Coupon (Validação de Regras, Percentual e Fixo)"]
        Store["Entidade: StoreSettings (Horários & Tarifas)"]
        Printer["Entidade: PrinterConfig (Destinos: Cozinha vs Balcão)"]
    end

    subgraph Infrastructure["Camada de Infraestrutura (Infrastructure Layer)"]
        PrismaDB["Prisma ORM & PostgreSQL (Modelagem Relacional e Persistência)"]
        MercadoPago["MercadoPagoService (Pix QR Code Base64, Cartão & Webhooks)"]
        Printing["ThermalPrinterService (ESC/POS Bytes & Web Print 80/58mm)"]
        UploadStorage["UploadService (Multer - Upload de Fotos do Computador)"]
        WebSocketHub["WebSocketHub (Eventos em Tempo Real: Novos Pedidos & Chat)"]
    end

    UI_Customer --> Controllers
    UI_Admin --> Controllers
    Controllers --> Application
    Application --> Domain
    Application --> Infrastructure
    Infrastructure -.-> Domain
```

---

## 🚀 Funcionalidades Principais do Sistema

### 💳 1. Gateways de Pagamento & Regra Rígida de Impressão
- **Mercado Pago Oficial**:
  - **Pix Dinâmico**: QR Code gerado em Base64 na tela + código Copia e Cola EMV com botão de cópia em 1 clique.
  - **Cartão de Crédito e Débito com Escolha de Timing**:
    - **Pagar Online Agora**: Cobrança processada pelo gateway Mercado Pago.
    - **Pagar na Entrega com Maquininha**: O cliente escolhe pagar na entrega e o entregador leva a máquina de cartão física.
  - **Dinheiro com Cálculo Automático de Troco**: O cliente digita o valor para troco e o sistema calcula e estampa na comanda: `LEVAR TROCO: R$ 18,20 (Pago com R$ 50,00)`.
- 🔒 **Regra de Impressão Rígida (Pagamento Primeiro)**:
  - **Dinheiro e Cartão na Entrega**: A impressão térmica é liberada de imediato para a produção começar, pois a cobrança será realizada pelo motoboy.
  - **Pix e Cartão Online**: **A IMPRESSÃO É BLOQUEADA** até que o banco confirme o pagamento (`approved`) via Webhook oficial (`/api/webhooks/mercadopago`) ou simulação administrativa. Evita desperdício com pedidos não pagos!

---

### 🍨 2. Acompanhamentos Dinâmicos & Regras por Tamanho no "Monte seu Açaí"
- **Lista Completa dos 15 Acompanhamentos Originais**:
  - Morango, Banana, Kiwi, Uva, Manga, Granola, Leite Condensado, Leite em Pó Ninho, Chantilly, Confete, Bis, Ovomaltine, Paçoca, Sucrilhos, Gotas de Chocolate.
- **Regra de Acompanhamentos Inclusos por Tamanho**:
  - **300 ml**: 3 acompanhamentos inclusos no valor.
  - **500 ml**: 4 acompanhamentos inclusos no valor.
  - **700 ml**: 5 acompanhamentos inclusos no valor.
  - **Configurável no Admin**: O lojista pode editar esses limites individualmente para cada tamanho de produto.
  - **CRUD de Acompanhamentos**: O lojista pode cadastrar quantos acompanhamentos quiser, definir custo unitário de insumo, pausar e vincular a produtos.

---

### 📊 3. Relatórios Executivos, Gráficos e Exportação em PDF A4 com Fotos
- **Filtros Flexíveis**:
  - Filtro rápido por **Hoje (Dia)**, **Este Mês**, **Este Ano** ou **Todo o Histórico**.
  - **Intervalo Personalizado**: Seleção de Data Inicial e Data Final.
- **Métricas e Indicadores Financeiros**:
  - Faturamento Bruto e Faturamento Líquido.
  - Total arrecadado em taxas de entrega (frete).
  - Descontos concedidos em cupons.
  - Custo total de insumos e Lucro Bruto Real com margem percentual.
  - **Tempo Médio de Preparo (Cozinha)** e **Tempo Médio de Entrega (Motoboy)**.
- **Rankings Visuais de Performance de Produtos**:
  - **Mais Vendidos**: Campeões de saída com barra de progresso visual, fotos dos produtos, unidades vendidas, receita bruta e margem.
  - **Menos Vendidos**: Identificação de oportunidades promocionais para otimização de estoque.
- **Exportação em PDF**:
  - Botão de exportação que gera documento A4 corporativo com logotipo da Explosão Açaí, indicadores consolidados, ranking de produtos com fotos e detalhamento de cada transação.

---

### 💰 4. Ficha Técnica, Custos, Soma de Combos & Alerta de Prejuízo
- **Receita de Insumos por Tamanho**: Custo unitário e quantidade de cada ingrediente (polpa de açaí, copo térmico, colher, coberturas e adicionais).
- **Soma Automática em Combos**: Ao criar ou editar um combo (ex: Combo Família, Combo Casal, Combo Kids), o administrador seleciona os produtos componentes e o sistema soma automaticamente o custo total dos insumos de cada copo.
- ⚠️ **Alerta Imediato de Prejuízo**: Se o custo total dos insumos for maior que o preço de venda cobrado, o painel exibe um aviso em vermelho em tempo real: `ALERTA DE PREJUÍZO DETECTADO: Tamanho 500ml: Custo R$ XX,XX é MAIOR que Preço R$ XX,XX`.
- Na tabela de produtos, produtos com prejuízo recebem o selo vermelho `PREJUÍZO`.

---

### 🖼️ 5. Upload de Fotos do Computador & Seções Especiais
- **Upload Real**: Campo de escolha de arquivo do computador (`<input type="file">`) com envio via `multer` para a pasta do servidor `public/imagens/uploads/`.
- **Lançamentos & Promoções**:
  - Checkbox para marcar produto como **Lançamento / Novidade** e **Produto em Promoção**.
  - O cardápio digital cria automaticamente abas dedicadas e selos dourados de `Novidade` e vermelhos de `Promoção` sobre as fotos.

---

### 💬 6. Chat Oficial em Tempo Real & Cupons Compartilháveis
- **Chat ao Vivo**: Comunicação instantânea via WebSockets entre cliente e lojista.
- **Identidade Visual Oficial**: O chat do cliente exibe o cabeçalho e as mensagens da loja como **Explosão Açaí** acompanhado da logo oficial.
- **Botão Flutuante Limpo**: Botão de chat único no canto da tela (sem botões redundantes).
- **Compartilhamento de Cupons**: Botões no painel administrativo para enviar o cupom de desconto diretamente no chat do cliente ou copiar a mensagem formatada para o WhatsApp.

---

## 🛠️ Tecnologias Utilizadas

- **Backend**: Node.js v22 (ESModules), Express 5, WebSockets (`ws`), Multer.
- **Banco de Dados & ORM**: PostgreSQL 14+, Prisma ORM com schema relacional completo e fallback resiliente em JSON com persistência atômica.
- **Pagamentos**: SDK Oficial Mercado Pago v2 (Pix dinâmico Base64 e Cartão).
- **Impressão**: Driver ESC/POS para impressoras térmicas não-fiscais (80mm e 58mm).
- **Frontend**: Vanilla JavaScript modular (SPA), HTML5 semântico, CSS3 com variáveis customizadas (paleta roxo `#4b0f6b` e dourado `#ffc800`) e design 100% responsivo para celulares.
- **Testes**: Node.js Test Runner nativo (`node:test`, `node:assert`).

---

## 🧪 Suíte de Testes Automatizados (15/15 Passando)

Execute a suíte completa de testes unitários e de integração:

```bash
npm test
```

Resultado da execução:
```
# tests 15
# suites 2
# pass 15
# fail 0
```

---

## 🚀 Como Executar o Projeto Localmente

1. **Clone o repositório**:
   ```bash
   git clone https://github.com/seu-usuario/explosao-acai-delivery.git
   cd explosao-acai-delivery
   ```

2. **Instale as dependências**:
   ```bash
   npm install
   ```

3. **Configure as Variáveis de Ambiente**:
   Crie o arquivo `.env` (ou utilize o `.env` já fornecido):
   ```env
   PORT=3000
   ADMIN_PASSWORD=explosao123
   MERCADO_PAGO_ACCESS_TOKEN=seu_token_aqui
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/explosao_acai?schema=public"
   ```

4. **Inicie o Servidor**:
   ```bash
   npm start
   ```

5. **Acesse as Interfaces no Navegador**:
   - **Cardápio do Cliente**: `http://localhost:3000`
   - **Painel Administrativo**: `http://localhost:3000/admin` (Senha padrão: `explosao123`)

---

## 📄 Licença
Desenvolvido como projeto de portfólio de engenharia de software para o **Explosão Açaí**. Todos os direitos reservados.
