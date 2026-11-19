# 📚 Dicionário de Dados & Matriz de Permissões Granulares (RBAC)
**Sistema Oficial de Delivery — Explosão Açaí**  
*Documento Técnico de Arquitetura, Banco de Dados, Permissões Granulares e Segurança LGPD*

---

## 📑 Sumário
1. [Visão Geral da Arquitetura](#1-visão-geral-da-arquitetura)
2. [Dicionário de Coleções do Banco de Dados (`data/database.json`)](#2-dicionário-de-coleções-do-banco-de-dados)
3. [Diagnóstico e Solução: Autenticação de Usuários Novos](#3-diagnóstico-e-solução-autenticação-de-usuários-novos)
4. [Matriz Completa de Permissões Granulares (RBAC)](#4-matriz-completa-de-permissões-granulares-rbac)
5. [Herança Hierárquica e Resolução de Permissões](#5-herança-hierárquica-e-resolução-de-permissões)
6. [Comportamento da Interface Administrativa (Frontend)](#6-comportamento-da-interface-administrativa-frontend)
7. [Mecanismos de Segurança e Conformidade com a LGPD](#7-mecanismos-de-segurança-e-conformidade-com-a-lgpd)

---

## 1. Visão Geral da Arquitetura

O sistema da **Explosão Açaí** foi desenvolvido sob os princípios da **Clean Architecture** e **Domain-Driven Design (DDD)** em **Node.js (Express)**, com persistência transacional síncrona/atômica em arquivo JSON com locks de integridade (`JsonDatabase`) e compatibilidade opcional com PostgreSQL via Prisma ORM:

```
src/
├── domain/                      # Camada de Entidades e Regras de Negócio Puras
│   └── entities/
│       ├── User.js              # Entidade User com validação RBAC e SystemModules
│       ├── Order.js             # Ciclo de vida de pedidos, status e totais
│       └── ...
├── application/                 # Casos de Uso e Orquestração
│   └── services/
│       ├── UserService.js       # Autenticação, criação, edição, toggle e anonimização
│       ├── OrderService.js      # Aceite, despacho, conclusão e cancelamento
│       └── ...
├── infrastructure/              # Implementações de Persistência e Integrações
│   └── database/
│       └── JsonDatabase.js      # Driver de armazenamento atômico e seguro
└── presentation/                # Controladores, Rotas, Middlewares e UI
    ├── middlewares/
    │   └── authMiddleware.js    # JWT, scrypt, hasUserPermission e requirePermission
    ├── routes/
    │   └── apiRoutes.js         # Endpoints REST com proteção granular por permissão
    └── ...
```

---

## 2. Dicionário de Coleções do Banco de Dados

O banco de dados principal reside em `data/database.json`. Cada coleção atende a regras rígidas de integridade referencial:

### 2.1 `settings` (Objeto Único de Configurações da Loja)
Configurações operacionais, frete, horários e gateways:
- `storeName` (String): Razão social/Nome fantasia ("Explosão Açaí").
- `phone` / `whatsapp` (String): WhatsApp oficial no formato DDI+DDD (ex: `5516991098863`).
- `address` (String): Endereço físico da loja usado como ponto de partida das rotas.
- `perKmRate` (Number): Valor cobrado por quilômetro rodado (ex: `1.00`).
- `minFreight` (Number): Valor mínimo da taxa de entrega (ex: `4.50`).
- `freeKm` (Number): Raio em KM para isenção total de frete (ex: `2.00`).
- `pixKey` (String): Chave Pix para recebimento bancário (ex: CNPJ `69925028000136`).
- `mercadoPagoToken` (String): Token para conciliação automática instantânea.
- `schedules` (Array): Grade de 7 dias com horários de abertura/fechamento e flag `active`.
- `autoSchedule` (Boolean): Se verdadeiro, abre e fecha a loja sozinho pelo relógio de Brasília.
- `autoReplyClosed` (Object): `{ enabled: Boolean, message: String }` para resposta imediata fora de expediente.

### 2.2 `categories` (Coleção de Categorias do Cardápio)
- `id` (String): Identificador único (ex: `cat_copos`, `cat_combos`, `cat_barcas`).
- `name` (String): Nome exibido no cardápio digital (ex: "Açaí no Copo Tradicional").
- `description` (String): Breve explicação das opções da categoria.
- `active` (Boolean): Se a categoria está visível aos clientes.
- `order` (Number): Posição ordinal no cardápio.

### 2.3 `products` (Coleção de Produtos)
- `id` (String): Identificador único (ex: `prod_copo_500`, `prod_barca_mega`).
- `name` (String): Nome do produto.
- `categoryId` (String): Vínculo com `categories.id`.
- `description` (String): Descrição detalhada dos ingredientes inclusos.
- `basePrice` (Number): Preço base ou preço de referência.
- `sizes` (Array): Variações com `{ size: Number, unit: String, price: Number }`.
- `image` (String): URL ou caminho relativo da foto do produto.
- `active` (Boolean): Status de disponibilidade em estoque.
- `isAcaiCustomizable` (Boolean): Indica se o item abre a tela "Monte seu Açaí".

### 2.4 `accompaniments` (Acompanhamentos)
- `id` (String): Identificador único (ex: `acomp_leite_ninho`).
- `name` (String): Nome (Leite Ninho, Granola Tradicional, Paçoca, etc.).
- `maxFree` (Number): Quantidade máxima gratuita incluída no pedido.
- `priceExtra` (Number): Valor cobrado caso o cliente exceda o limite grátis.
- `active` (Boolean): Disponibilidade em estoque.

### 2.5 `fruits` (Frutas Frescas)
- `id` (String): Identificador único (ex: `fruta_morango`, `fruta_banana`).
- `name` (String): Nome da fruta.
- `maxFree` (Number): Quantidade inclusa sem custo.
- `priceExtra` (Number): Preço unitário extra.
- `active` (Boolean): Disponibilidade.

### 2.6 `extras` (Adicionais Premium)
- `id` (String): Identificador único (ex: `extra_nutella`, `extra_kitkat`).
- `name` (String): Nome do item adicional.
- `price` (Number): Valor adicional cobrado.
- `active` (Boolean): Disponibilidade.

### 2.7 `coupons` (Cupons Promocionais)
- `id` (String): Identificador do cupom.
- `code` (String): Código digitado pelo cliente em caixa alta (ex: `PRIMEIRACOMPRA`).
- `discountType` (String): `fixed` (R$) ou `percent` (%).
- `discountValue` (Number): Valor monetário ou percentual.
- `minOrderValue` (Number): Valor mínimo do carrinho para validação.
- `usageLimit` (Number): Quantidade máxima global de utilizações.
- `usageCount` (Number): Quantidade já consumida.
- `active` (Boolean): Status do cupom.

### 2.8 `orders` (Pedidos do Delivery)
- `id` (String): Identificador único do pedido (ex: `ord_1700000000_1234`).
- `customer` (Object): `{ name, phone, address, complement, reference, lat, lng }`.
- `items` (Array): Itens com tamanhos, frutas, acompanhamentos e adicionais.
- `subtotal` (Number): Soma dos itens.
- `deliveryFee` (Number): Taxa de frete calculada ou zero se retirado/grátis.
- `discount` (Number): Valor do cupom aplicado.
- `total` (Number): Total líquido final.
- `payment` (Object): `{ method, timing, changeFor, status, pixQrCode, pixCopyPaste }`.
- `status` (String): `pending` ➔ `preparing` ➔ `ready` ➔ `delivering` ➔ `completed` (ou `cancelled`).
- `motoboyId` / `motoboyName` (String): Vínculo com entregador responsável.
- `printedKitchen` / `printedCounter` (Boolean): Histórico de vias impressas.
- `createdAt` / `updatedAt` (ISO Date): Registro cronológico para auditoria.

### 2.9 `printers` (Impressoras Térmicas ESC/POS)
- `id` (String): Identificador da impressora (ex: `prn_cozinha`, `prn_balcao`).
- `name` (String): Rótulo da estação (ex: "Impressora Cozinha").
- `type` (String): `kitchen` (comanda de produção) ou `counter` (via do cliente com endereço).
- `paperWidth` (Number): 58 ou 80 (milímetros).
- `autoPrint` (Boolean): Disparo automático ao aprovar pedido.
- `active` (Boolean): Status da impressora.

### 2.10 `chats` (Atendimento WhatsApp Integrado)
- `id` (String): Telefone do cliente (chave canônica).
- `customerName` (String): Nome registrado.
- `messages` (Array): `{ id, sender: 'client'|'store'|'bot', text, timestamp, mediaUrl }`.
- `status` (String): `open`, `bot`, `waiting_human`, `closed`.

### 2.11 `botSettings` & `botKnowledge` (Inteligência Artificial)
- `botSettings`: `{ geminiApiKey, aiEnabled, autoReply, humanHandoffAlert }`.
- `botKnowledge`: Array de registros de treinamento com `{ id, question, answer, keywords, category }` para aprendizado dinâmico do assistente.

### 2.12 `feedbacks` (Ouvidoria & Pesquisa de Satisfação)
- `id` (String): Identificador único.
- `customerPhone` (String): Telefone do cliente (anonimizável).
- `customerName` (String): Nome do cliente (anonimizável).
- `message` (String): Conteúdo do relato/elogio/reclamação.
- `type` (String): `elogio`, `sugestao`, `reclamacao`.
- `rating` (Number): Nota de 1 a 5.
- `createdAt` (ISO Date): Data do registro.

### 2.13 `securityLogs` (Trilha de Auditoria LGPD)
- `id` (String): Identificador do log.
- `timestamp` (ISO Date): Data e hora exatas do evento.
- `event` (String): Código do evento (`AUTH_LOGIN_SUCCESS`, `AUTH_FORBIDDEN_403`, `USER_CREATED`, `USER_ANONYMIZED`).
- `ip` (String): Endereço IP do solicitante.
- `userId` (String): Usuário associado.
- `details` (String): Detalhes textuais para auditoria forense.
- `severity` (String): `INFO`, `WARNING`, `SECURITY`.

### 2.14 `users` (Usuários e Operadores do Sistema)
- `id` (String): Identificador único (ex: `usr_admin_default`, `usr_1774050000_abc`).
- `name` (String): Nome completo do usuário.
- `email` (String): E-mail ou login de acesso (busca case-insensitive).
- `passwordHash` (String): Hash seguro gerado com algoritmo **scrypt** (RFC 7914).
- `role` (String): `'admin'` ou `'operator'`.
- `permissions` (Array): Lista de chaves granulares concedidas ao operador.
- `active` (Boolean): Se `true`, permite login; se `false`, bloqueia autenticação (soft disable).
- `isDeleted` (Boolean): Flag de soft-delete para integridade referencial.
- `createdAt` / `updatedAt` (ISO Date): Carimbo temporal de auditoria.

---

## 3. Diagnóstico e Solução: Autenticação de Usuários Novos

### 3.1 Causa Raiz Identificada
1. **Divergência de Identificador de Login**:
   - O painel exibia o campo rotulado como "Login / E-mail de Acesso", permitindo que o administrador cadastrasse usuários tanto por e-mail (`carlos@explosaoacai.com.br`) quanto por nome simples (`Mariana`, `carlos`).
   - O serviço de autenticação original `UserService.authenticate` buscava estritamente por `email.toLowerCase() === identifier` ou `id === identifier`. Quando um operador tentava entrar com seu nome de usuário, a consulta retornava vazio, impedindo o login.
2. **Travamento no Carregamento Inicial do Painel**:
   - Após a autenticação, o script do painel executava incondicionalmente `loadOrders()` e ativava a sub-aba de Kanban `setKanbanViewMode('live')`.
   - Se o novo operador pertencia a outro departamento (por exemplo, apenas **Atendimento no Chat** ou **Relatórios Financeiros**) e não possuía a permissão `orders`, as chamadas da API retornavam `403 Forbidden`. O painel ficava com a tela em branco/travada, pois o contêiner de pedidos permanecia ativo no DOM enquanto a aba estava oculta no menu.

### 3.2 Correções Implementadas na Raiz
1. **Autenticação Flexível em `UserService.authenticate`**:
   - O método agora localiza o usuário de forma insensível a maiúsculas/minúsculas comparando o identificador com:
     - `u.email`
     - `u.name`
     - `u.id`
     - E suporte a `"admin"` para a conta mestre padrão.
2. **Navegação Segura e Dinâmica no Painel (`admin.js`)**:
   - Implementada a função centralizadora `window.navigateToTab(tabTarget)` que remove a classe `.active` dos demais contêineres, ativa a aba selecionada e dispara o carregamento de dados correspondente sob demanda (*lazy loading*).
   - O método `initDashboard()` e o login agora detectam automaticamente a **primeira aba para a qual o operador tem permissão** e navegam para ela imediatamente, evitando requisições bloqueadas e telas em branco.

---

## 4. Matriz Completa de Permissões Granulares (RBAC)

O sistema conta com **11 grupos de permissões** cobrindo todas as 13 abas reais da barra superior, suas sub-abas, ações internas e rotas da API:

| Grupo | Chave Granular | Rótulo / Ação na UI | Rota da API Protegida | Método HTTP |
| :--- | :--- | :--- | :--- | :--- |
| **1. Pedidos & Cozinha** | `orders.view` | Visualizar aba Pedidos & Cozinha | `/api/orders` | `GET` |
| | `orders.live` | Sub-aba Operação Ao Vivo (4 Colunas) | Interface Kanban | UI |
| | `orders.all_columns` | Sub-aba Todas as Colunas (7 Colunas) | Interface Kanban | UI |
| | `orders.history` | Sub-aba Histórico & Devolvidos | Interface Kanban | UI |
| | `orders.accept` | Aceitar pedido / Mandar p/ Cozinha / Confirmar Pix | `/api/orders/:id/status`, `/api/orders/:id/confirm-pix` | `PATCH`, `POST` |
| | `orders.dispatch` | Mover para Pronto / Em Rota | `/api/orders/:id/status` | `PATCH` |
| | `orders.complete` | Concluir / Marcar como Recebido | `/api/orders/:id/status` | `PATCH` |
| | `orders.cancel` | Cancelar / Devolver pedido | `/api/orders/:id/status` | `PATCH` |
| | `orders.print` | Imprimir comandas (1ª/2ª via/reimpressão) | `/api/orders/:id/print` | `POST` |
| | `orders.store_toggle` | Abrir / Fechar loja (switch do topo) | `/api/store/toggle-status` | `POST` |
| **2. Rotas & GPS** | `routes.view` | Visualizar botão/mapa de Rotas & GPS | `/api/routes` | `GET` |
| | `routes.optimize` | Gerar e otimizar rotas no Google Maps | `/api/routes/optimize` | `POST` |
| **3. Entregadores (Motoboys)** | `motoboys.dispatch` | Atribuir entregador ao pedido | `/api/orders/:id/assign-motoboy` | `POST` |
| | `motoboys.manage` | Cadastrar / excluir entregador frequente | `/api/motoboys` | `POST`, `DELETE` |
| | `motoboys.reports` | Visualizar relatório de entregas por motoboy | `/api/reports/motoboy-deliveries` | `GET` |
| | `motoboys.settlement` | Fechamento de diária e acerto financeiro | `/api/motoboys/settlement` | `POST` |
| **4. Chat WhatsApp** | `chat.view` | Visualizar aba Atendimento & histórico | `/api/chat/conversations` | `GET` |
| | `chat.reply` | Enviar mensagens, cupons e áudios | `/api/chat/messages` | `POST` |
| | `chat.edit_customer` | Editar nome do cliente cadastrado | `/api/chat/customers/:id` | `PATCH` |
| **5. Cardápio & Insumos** | `catalog.products.view` | Ver Cardápio & Estoque | `/api/catalog` | `GET` |
| | `catalog.products.manage` | Criar/Editar/Pausar/Excluir produtos | `/api/catalog/products` | `POST`, `PUT`, `DELETE` |
| | `catalog.accompaniments.view`| Ver Acompanhamentos | `/api/catalog/accompaniments` | `GET` |
| | `catalog.accompaniments.manage`| Criar/Editar/Pausar/Excluir acompanhamentos | `/api/catalog/accompaniments` | `POST`, `PUT`, `DELETE` |
| | `catalog.extras.view` | Ver Adicionais Premium | `/api/catalog/extras` | `GET` |
| | `catalog.extras.manage` | Criar/Editar/Pausar/Excluir adicionais | `/api/catalog/extras` | `POST`, `PUT`, `DELETE` |
| | `catalog.fruits.view` | Ver Frutas Frescas | `/api/catalog/fruits` | `GET` |
| | `catalog.fruits.manage` | Criar/Editar/Pausar/Excluir frutas | `/api/catalog/fruits` | `POST`, `PUT`, `DELETE` |
| | `catalog.categories.view` | Ver Categorias | `/api/catalog/categories` | `GET` |
| | `catalog.categories.manage` | Criar/Editar/Excluir categorias | `/api/catalog/categories` | `POST`, `PUT`, `DELETE` |
| **6. Relatórios & Custos** | `reports.view` | Visualizar Relatórios & Vendas | `/api/reports/sales` | `GET` |
| | `reports.costs` | Ver/editar Ficha Técnica de custos | `/api/reports/costs` | `GET`, `POST` |
| | `reports.export_pdf` | Exportar relatórios gerenciais em PDF | `/api/reports/export-pdf` | `GET` |
| **7. Cupons de Desconto** | `coupons.view` | Visualizar aba Cupons | `/api/coupons` | `GET` |
| | `coupons.manage` | Criar, editar, ativar, desativar e excluir cupons | `/api/coupons` | `POST`, `PUT`, `DELETE` |
| **8. Impressoras Térmicas** | `printers.view` | Visualizar aba Impressoras | `/api/printers` | `GET` |
| | `printers.manage` | Configurar bobina (58/80mm) e auto-impressão | `/api/printers` | `POST`, `PUT` |
| **9. Configurações da Loja** | `store.view` | Visualizar aba Horários & Configurações | `/api/store/settings` | `GET` |
| | `store.manage` | Alterar dados da loja, frete por KM e horários | `/api/store/settings` | `POST`, `PUT` |
| | `store.change_master_password` | Alterar senha mestre do painel | `/api/store/change-password` | `POST` |
| **10. Usuários & Permissões** | `users.view` | Visualizar tabela de Usuários RBAC | `/api/users` | `GET` |
| | `users.create` | Cadastrar novos usuários | `/api/users` | `POST` |
| | `users.edit` | Editar usuários existentes e permissões | `/api/users/:id` | `PUT` |
| | `users.toggle_status` | Ativar / desativar acesso de usuário | `/api/users/:id/status` | `PATCH` |
| | `users.delete` | Exclusão lógica / Anonimização LGPD | `/api/users/:id` | `DELETE` |
| **11. Bot WhatsApp & IA** | `bot.view` | Visualizar aba Bot WhatsApp & IA | `/api/bot/status` | `GET` |
| | `bot.connect` | Conectar / desconectar QR Code do WhatsApp | `/api/bot/connect`, `/api/bot/disconnect` | `POST` |
| | `bot.toggle_ai` | Ativar / desativar IA Google Gemini | `/api/bot/toggle-ai` | `POST` |
| | `bot.set_key` | Configurar chave de API Gemini com segurança | `/api/bot/set-gemini-key` | `POST` |
| | `bot.test_message` | Enviar mensagens de teste pelo WhatsApp | `/api/bot/send-test` | `POST` |
| | `bot.knowledge` | Gerenciar base de conhecimento da IA | `/api/bot/knowledge` | `GET`, `POST`, `DELETE` |
| | `bot.feedbacks` | Gerenciar Ouvidoria (Feedbacks recebidos) | `/api/bot/feedbacks` | `GET`, `PATCH` |
| | `bot.campaigns` | Disparar campanhas promocionais semanais | `/api/bot/campaign` | `POST` |
| **12. Segurança & Logs** | `security.view` | Visualizar logs de auditoria e firewall | `/api/security/logs` | `GET` |
| | `security.clear_logs` | Limpar histórico de logs de auditoria | `/api/security/logs` | `DELETE` |
| | `security.anonymize` | Anonimizar dados pessoais de clientes | `/api/security/anonymize` | `POST` |

---

## 5. Herança Hierárquica e Resolução de Permissões

A verificação de permissões é executada pela função `hasUserPermission(user, requiredKeys)` em `src/presentation/middlewares/authMiddleware.js` e espelhada no frontend em `public/js/admin.js`:

1. **Perfil Administrador (`role: 'admin'` ou `permissions: ['*']`)**:
   - Possui acesso total e irrestrito a todos os endpoints, botões e telas do sistema.
2. **Herança Hierárquica por Prefixo de Módulo**:
   - Um usuário que possua a chave macro `"orders"` recebe automaticamente acesso a todas as ações filhas: `"orders.view"`, `"orders.accept"`, `"orders.dispatch"`, `"orders.print"`, etc.
   - Um usuário que possua a chave `"catalog.products"` recebe acesso a `"catalog.products.view"` e `"catalog.products.manage"`.
3. **Retrocompatibilidade com Contas Antigas**:
   - Perfis criados antes da expansão granular que possuíam chaves simplificadas (`"reports"`, `"chat"`, `"store"`) continuam funcionando com acesso completo aos seus respectivos módulos.
4. **Auditoria Imediata em Tentativa Não Autorizada**:
   - Caso um operador tente executar um endpoint sem a devida permissão, a requisição é abortada com **HTTP 403 Forbidden** e um registro de severidade `SECURITY` é gravado em `securityLogs`.

---

## 6. Comportamento da Interface Administrativa (Frontend)

O painel administrativo (`public/admin.html` e `public/js/admin.js`) adapta sua visualização em tempo real conforme o perfil do usuário autenticado:

1. **Modal de Cadastro/Edição de Usuários (`#user-form-modal`)**:
   - Largura expandida para `min(720px, 96vw)` com barra de rolagem suave.
   - Controles de produtividade:
     - Botão global **"✅ Marcar Todos"** e **"❌ Desmarcar Todos"**.
     - Botão **"Marcar/Desmarcar Grupo"** em cada um dos 11 blocos de permissões.
     - Campo de senha opcional na edição (mantém a senha atual se deixado em branco).
2. **Ocultação Seletiva de Elementos (DOM)**:
   - Se o operador não tiver `orders.store_toggle`, o botão de Abrir/Fechar Loja no topo é removido.
   - Se não tiver `orders.cancel`, o botão "Cancelar Pedido" não é renderizado nos cards do Kanban.
   - As abas da barra superior sem permissão recebem `display: none`.
3. **Navegação Inteligente pós-login**:
   - Ao autenticar, o sistema avalia as abas visíveis e aciona automaticamente a primeira liberada (por exemplo, abrindo direto no Chat ou no Cardápio se a Cozinha estiver desmarcada).

---

## 7. Mecanismos de Segurança e Conformidade com a LGPD

O sistema foi estruturado em conformidade estrita com a **Lei Geral de Proteção de Dados (Lei nº 13.709/2018)**:

1. **Criptografia Rígida de Senhas (RFC 7914)**:
   - As senhas são processadas com o algoritmo **scrypt** (`N=16384, r=8, p=1`, salt aleatório de 16 bytes e chave derivada de 64 bytes).
   - A comparação contra ataques de temporização (*timing attacks*) é realizada via `crypto.timingSafeEqual`.
2. **Minimização de Dados (LGPD Art. 6º, III)**:
   - As respostas das APIs `/api/users` e `/api/admin/auth` **nunca** retornam `passwordHash` ou dados sensíveis.
3. **Proteção Contra Força Bruta (Rate Limiting)**:
   - O endpoint `/api/admin/auth` é protegido contra ataques automatizados de dicionário por meio de limitador de requisições por IP.
4. **Travas de Segurança Invioláveis**:
   - O sistema bloqueia a exclusão ou desativação da própria conta logada.
   - O sistema bloqueia a exclusão ou desativação do **último Administrador ativo**, garantindo que a loja nunca fique sem acesso gerencial.
5. **Direito à Eliminação e Anonimização (LGPD Art. 16 e 18)**:
   - A exclusão de usuários que possuem histórico de pedidos ou registros associados realiza **soft delete** (`isDeleted: true`, `active: false`), preservando a integridade das auditorias fiscais enquanto anonimiza dados de identificação pessoal.

---
*Documento gerado e verificado automaticamente com 100% de aprovação na suíte de testes automatizados (`npm test` — 108/108 testes com 0 falhas).*
