/* =========================================================================
   BANCO DE DADOS PERSISTENTE COM HISTÓRICO REAL — EXPLOSÃO AÇAÍ
   - Estrutura completa alinhada com o Prisma / PostgreSQL
   - Acompanhamentos dinâmicos com custos e vinculação a produtos
   - Ficha técnica com cálculo de custos de açaí e soma automática em combos
   - Lançamentos e Produtos em Promoção
   - Histórico permanente com tempo de preparo e tempo de entrega
   ========================================================================= */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../../data');
const DB_FILE = path.join(DATA_DIR, 'database.json');

const INITIAL_DATA = {
  // CONFIGURAÇÕES GERAIS DA LOJA
  settings: {
    storeName: "Explosão Açaí",
    adminPassword: "RafaeLL@2",
    chatSenderName: "Delivery",
    freeKmThreshold: 2.0,
    wpp: "5516991098863",
    pixKey: "16991098863",
    address: "Rua Renato Lourenço Fernandes Rosa, 1721, Aeroporto 3, Franca - SP",
    city: "Franca",
    state: "SP",
    perKmRate: 1.0,
    minFreight: 4.5,
    maxKm: 25,
    isOpenManual: true, // true = Aberta, false = Fechada
    useAutoSchedule: false,
    bannerPromo: "Bem-vindo ao nosso delivery próprio! Peça direto por aqui e ganhe descontos exclusivos.",
    schedules: [
      { day: 0, dayName: "Domingo", open: "13:00", close: "23:00", active: true },
      { day: 1, dayName: "Segunda-feira", open: "14:00", close: "22:00", active: false },
      { day: 2, dayName: "Terça-feira", open: "13:00", close: "23:00", active: true },
      { day: 3, dayName: "Quarta-feira", open: "13:00", close: "23:00", active: true },
      { day: 4, dayName: "Quinta-feira", open: "13:00", close: "23:00", active: true },
      { day: 5, dayName: "Sexta-feira", open: "13:00", close: "23:30", active: true },
      { day: 6, dayName: "Sábado", open: "13:00", close: "23:30", active: true }
    ]
  },

  // CATEGORIAS DE PRODUTOS
  categories: [
    { id: "cat_lancamentos", name: "Lançamentos & Novidades", slug: "lancamentos", order: 1, active: true },
    { id: "cat_promocoes", name: "Produtos em Promoção", slug: "promocoes", order: 2, active: true },
    { id: "cat_monte", name: "Monte seu Açaí", slug: "monte", order: 3, active: true },
    { id: "cat_prontos", name: "Sabores Prontos", slug: "prontos", order: 4, active: true },
    { id: "cat_combos", name: "Combos", slug: "combos", order: 5, active: true },
    { id: "cat_polpa", name: "Pura Polpa", slug: "polpa", order: 6, active: true }
  ],

  // CONFIGURAÇÕES DE IMPRESSORAS DE COMANDA
  printers: [
    {
      id: "prt_kitchen",
      name: "Impressora Cozinha / Produção",
      target: "kitchen",
      paperWidth: 80,
      isDefault: true,
      autoPrintOnApproved: true,
      headerText: "EXPLOSÃO AÇAÍ - PRODUÇÃO"
    },
    {
      id: "prt_counter",
      name: "Impressora Caixa / Balcão & Entrega",
      target: "counter",
      paperWidth: 80,
      isDefault: false,
      autoPrintOnApproved: true,
      headerText: "EXPLOSÃO AÇAÍ - VIA CLIENTE / MOTOBOY"
    }
  ],

  // PRODUTOS COM CUSTOS, REGRAS DE ACOMPANHAMENTO E LANÇAMENTOS
  products: [
    {
      id: "prod_monte",
      name: "Monte seu açaí",
      categoryId: "cat_monte",
      categorySlug: "monte",
      description: "Escolha o tamanho e os acompanhamentos inclusos no valor (300ml: 3 inclusos, 500ml: 4 inclusos, 700ml: 5 inclusos). Depois turbine com extras!",
      image: "imagens/do seu jeitinho.png",
      active: true,
      isCustomizable: true,
      isNewLaunch: false,
      isPromo: false,
      prices: [
        { size: 300, price: 15.90, promoPrice: null, costPrice: 6.80, maxAccompaniments: 3 },
        { size: 500, price: 19.90, promoPrice: null, costPrice: 9.40, maxAccompaniments: 4 },
        { size: 700, price: 26.90, promoPrice: null, costPrice: 12.50, maxAccompaniments: 5 }
      ],
      recipes: [
        { size: 300, ingredients: [
          { name: "Polpa de açaí especial batida", quantity: 200, unit: "g", unitCost: 0.02, totalCost: 4.00 },
          { name: "Copo térmico 300ml com tampa", quantity: 1, unit: "un", unitCost: 0.80, totalCost: 0.80 },
          { name: "3 acompanhamentos inclusos", quantity: 3, unit: "porções", unitCost: 0.60, totalCost: 1.80 },
          { name: "Colher e guardanapo", quantity: 1, unit: "kit", unitCost: 0.20, totalCost: 0.20 }
        ]},
        { size: 500, ingredients: [
          { name: "Polpa de açaí especial batida", quantity: 350, unit: "g", unitCost: 0.02, totalCost: 7.00 },
          { name: "Copo térmico 500ml com tampa", quantity: 1, unit: "un", unitCost: 0.90, totalCost: 0.90 },
          { name: "4 acompanhamentos inclusos", quantity: 4, unit: "porções", unitCost: 0.325, totalCost: 1.30 },
          { name: "Colher e guardanapo", quantity: 1, unit: "kit", unitCost: 0.20, totalCost: 0.20 }
        ]},
        { size: 700, ingredients: [
          { name: "Polpa de açaí especial batida", quantity: 500, unit: "g", unitCost: 0.02, totalCost: 10.00 },
          { name: "Copo térmico 700ml com tampa", quantity: 1, unit: "un", unitCost: 1.10, totalCost: 1.10 },
          { name: "5 acompanhamentos inclusos", quantity: 5, unit: "porções", unitCost: 0.24, totalCost: 1.20 },
          { name: "Colher e guardanapo", quantity: 1, unit: "kit", unitCost: 0.20, totalCost: 0.20 }
        ]}
      ]
    },
    {
      id: "prod_docetentacao",
      name: "Doce Tentação",
      categoryId: "cat_prontos",
      categorySlug: "prontos",
      description: "Chocolate com avelã, morango, Ninho, mescla de bombom e Sonho de Valsa.",
      image: "imagens/doce tentacao.png",
      active: true,
      isNewLaunch: false,
      isPromo: false,
      prices: [
        { size: 300, price: 24.90, promoPrice: null, costPrice: 10.50, maxAccompaniments: 0 },
        { size: 500, price: 30.90, promoPrice: null, costPrice: 13.80, maxAccompaniments: 0 },
        { size: 700, price: 36.90, promoPrice: null, costPrice: 16.90, maxAccompaniments: 0 }
      ],
      recipes: [
        { size: 500, ingredients: [
          { name: "Polpa de açaí", quantity: 320, unit: "g", unitCost: 0.02, totalCost: 6.40 },
          { name: "Creme de avelã", quantity: 40, unit: "g", unitCost: 0.06, totalCost: 2.40 },
          { name: "Morango fresco", quantity: 50, unit: "g", unitCost: 0.03, totalCost: 1.50 },
          { name: "Sonho de Valsa", quantity: 1, unit: "un", unitCost: 1.80, totalCost: 1.80 },
          { name: "Leite Ninho", quantity: 20, unit: "g", unitCost: 0.04, totalCost: 0.80 },
          { name: "Copo 500ml e tampa", quantity: 1, unit: "un", unitCost: 0.90, totalCost: 0.90 }
        ]}
      ]
    },
    {
      id: "prod_mixfini",
      name: "Mix Fini",
      categoryId: "cat_prontos",
      categorySlug: "prontos",
      description: "Cobertura Fini, confete, Ninho e Fini.",
      image: "imagens/mix fini.png",
      active: true,
      isNewLaunch: false,
      isPromo: true,
      prices: [
        { size: 300, price: 22.90, promoPrice: 19.90, costPrice: 9.20, maxAccompaniments: 0 },
        { size: 500, price: 27.90, promoPrice: 24.90, costPrice: 12.10, maxAccompaniments: 0 },
        { size: 700, price: 33.90, promoPrice: null, costPrice: 15.40, maxAccompaniments: 0 }
      ],
      recipes: []
    },
    {
      id: "prod_puropolpa",
      name: "Puro Polpa",
      categoryId: "cat_prontos",
      categorySlug: "prontos",
      description: "Polpa pura de açaí, textura extremamente cremosa e sabor marcante.",
      image: "imagens/Pura Polpa.png",
      active: true,
      isNewLaunch: false,
      isPromo: false,
      prices: [
        { size: 300, price: 15.90, promoPrice: null, costPrice: 5.50, maxAccompaniments: 0 },
        { size: 500, price: 19.90, promoPrice: null, costPrice: 8.50, maxAccompaniments: 0 },
        { size: 700, price: 26.90, promoPrice: null, costPrice: 11.80, maxAccompaniments: 0 }
      ],
      recipes: []
    },
    {
      id: "prod_ninhomorango",
      name: "Ninho com Morango",
      categoryId: "cat_prontos",
      categorySlug: "prontos",
      description: "Mescla de Ninho, morango fresco selecionado e camada generosa de leite Ninho.",
      image: "imagens/ninho com morango.png",
      active: true,
      isNewLaunch: false,
      isPromo: false,
      prices: [
        { size: 300, price: 24.90, promoPrice: null, costPrice: 10.20, maxAccompaniments: 0 },
        { size: 500, price: 30.90, promoPrice: null, costPrice: 13.50, maxAccompaniments: 0 },
        { size: 700, price: 36.90, promoPrice: null, costPrice: 16.50, maxAccompaniments: 0 }
      ],
      recipes: []
    },
    {
      id: "prod_classico",
      name: "Clássico",
      categoryId: "cat_prontos",
      categorySlug: "prontos",
      description: "Chantilly, morango e leite condensado de primeira qualidade.",
      image: "imagens/classico.png",
      active: true,
      isNewLaunch: false,
      isPromo: false,
      prices: [
        { size: 300, price: 21.90, promoPrice: null, costPrice: 8.90, maxAccompaniments: 0 },
        { size: 500, price: 26.90, promoPrice: null, costPrice: 11.90, maxAccompaniments: 0 },
        { size: 700, price: 32.90, promoPrice: null, costPrice: 14.80, maxAccompaniments: 0 }
      ],
      recipes: []
    },
    {
      id: "prod_nutella",
      name: "Nutella",
      categoryId: "cat_prontos",
      categorySlug: "prontos",
      description: "Nutella original, Bis crocante, morango fresco e Ninho.",
      image: "imagens/nutella.png",
      active: true,
      isNewLaunch: false,
      isPromo: false,
      prices: [
        { size: 300, price: 26.50, promoPrice: null, costPrice: 11.80, maxAccompaniments: 0 },
        { size: 500, price: 33.90, promoPrice: null, costPrice: 15.20, maxAccompaniments: 0 },
        { size: 700, price: 40.90, promoPrice: null, costPrice: 18.90, maxAccompaniments: 0 }
      ],
      recipes: []
    },
    {
      id: "prod_parperfeito",
      name: "Par Perfeito",
      categoryId: "cat_prontos",
      categorySlug: "prontos",
      description: "Brigadeiro artesanal, mescla de Ninho, Bis, morango, Ninho, chocolate com avelã e chocolates em formato de coração.",
      image: "imagens/par perfeito.png",
      active: true,
      isNewLaunch: true, // Marcado como Lançamento
      isPromo: false,
      prices: [
        { size: 300, price: 26.50, promoPrice: null, costPrice: 12.00, maxAccompaniments: 0 },
        { size: 500, price: 33.90, promoPrice: null, costPrice: 15.50, maxAccompaniments: 0 },
        { size: 700, price: 40.90, promoPrice: null, costPrice: 19.20, maxAccompaniments: 0 }
      ],
      recipes: []
    },
    {
      id: "prod_granola",
      name: "Granola",
      categoryId: "cat_prontos",
      categorySlug: "prontos",
      description: "Açaí tradicional com granola crocante, mel puro, banana e morango.",
      image: "imagens/granola.png",
      active: true,
      isNewLaunch: false,
      isPromo: false,
      prices: [
        { size: 300, price: 21.90, promoPrice: null, costPrice: 8.80, maxAccompaniments: 0 },
        { size: 500, price: 26.90, promoPrice: null, costPrice: 11.50, maxAccompaniments: 0 },
        { size: 700, price: 32.90, promoPrice: null, costPrice: 14.50, maxAccompaniments: 0 }
      ],
      recipes: []
    },
    {
      id: "combo_familia",
      name: "Combo Família",
      categoryId: "cat_combos",
      categorySlug: "combos",
      description: "4 copos de açaí (tamanho à sua escolha: 300ml, 500ml ou 700ml): 1 Nutella · 1 Ninho com Morango · 1 Clássico · 1 Mix Fini.",
      details: "Ideal para compartilhar com quem você ama!",
      image: "imagens/combo familia.png",
      active: true,
      isNewLaunch: false,
      isPromo: false,
      comboProductIds: ["prod_nutella", "prod_ninhomorango", "prod_classico", "prod_mixfini"], // Itens que somam o custo automaticamente!
      prices: [
        { size: 300, price: 79.90, promoPrice: null, costPrice: 42.00, maxAccompaniments: 0 },
        { size: 500, price: 99.00, promoPrice: null, costPrice: 52.70, maxAccompaniments: 0 },
        { size: 700, price: 129.90, promoPrice: null, costPrice: 68.00, maxAccompaniments: 0 }
      ],
      recipes: []
    },
    {
      id: "combo_kids",
      name: "Combo Kids",
      categoryId: "cat_combos",
      categorySlug: "combos",
      description: "3 copos de açaí (tamanho à sua escolha: 300ml, 500ml ou 700ml): 2 Mix Fini (cobertura Fini, confete e Ninho) · 1 Clássico.",
      details: "A alegria da criançada em cada colherada!",
      image: "imagens/combo kids.png",
      active: true,
      isNewLaunch: false,
      isPromo: false,
      comboProductIds: ["prod_mixfini", "prod_mixfini", "prod_classico"],
      prices: [
        { size: 300, price: 54.90, promoPrice: null, costPrice: 27.30, maxAccompaniments: 0 },
        { size: 500, price: 69.90, promoPrice: null, costPrice: 35.00, maxAccompaniments: 0 },
        { size: 700, price: 89.90, promoPrice: null, costPrice: 45.00, maxAccompaniments: 0 }
      ],
      recipes: []
    },
    {
      id: "combo_casal",
      name: "Combo Casal",
      categoryId: "cat_combos",
      categorySlug: "combos",
      description: "2 copos de açaí (tamanho à sua escolha: 300ml, 500ml ou 700ml): 2 Par Perfeito com brigadeiro, Ninho, Bis, morango, chocolate com avelã e chocolates em formato de coração.",
      details: "O combo mais apaixonante da casa!",
      image: "imagens/combo casal.png",
      active: true,
      isNewLaunch: false,
      isPromo: false,
      comboProductIds: ["prod_parperfeito", "prod_parperfeito"],
      prices: [
        { size: 300, price: 49.90, promoPrice: null, costPrice: 24.00, maxAccompaniments: 0 },
        { size: 500, price: 64.90, promoPrice: null, costPrice: 31.00, maxAccompaniments: 0 },
        { size: 700, price: 84.90, promoPrice: null, costPrice: 40.00, maxAccompaniments: 0 }
      ],
      recipes: []
    },
    {
      id: "combo_economico",
      name: "Combo Econômico",
      categoryId: "cat_combos",
      categorySlug: "combos",
      description: "2 copos de açaí (tamanho à sua escolha: 300ml, 500ml ou 700ml): Em cada copo: banana, Ninho, leite condensado e granola.",
      details: "Saboroso e no precinho que cabe no bolso!",
      image: "imagens/combo economico.png",
      active: true,
      isNewLaunch: false,
      isPromo: true, // Marcado como Promoção
      comboProductIds: [],
      prices: [
        { size: 300, price: 29.90, promoPrice: 26.90, costPrice: 14.00, maxAccompaniments: 0 },
        { size: 500, price: 39.90, promoPrice: 35.90, costPrice: 19.00, maxAccompaniments: 0 },
        { size: 700, price: 49.90, promoPrice: 44.90, costPrice: 24.00, maxAccompaniments: 0 }
      ],
      recipes: []
    },
    {
      id: "polpa_1l",
      name: "Pura Polpa de Açaí 1 litro",
      categoryId: "cat_polpa",
      categorySlug: "polpa",
      description: "Pote de 1 Litro de açaí cremoso puro, pronto para consumo ou para criar suas próprias receitas em casa.",
      image: "imagens/pote 1l e 2 l.png",
      active: true,
      isNewLaunch: false,
      isPromo: false,
      prices: [
        { size: 1000, price: 29.90, promoPrice: null, costPrice: 15.00, maxAccompaniments: 0 }
      ],
      recipes: []
    },
    {
      id: "polpa_2l",
      name: "Pura Polpa de Açaí 2 litros",
      categoryId: "cat_polpa",
      categorySlug: "polpa",
      description: "Pote de 2 Litros de pura polpa cremosa com rendimento máximo.",
      image: "imagens/pote 1l e 2 l.png",
      active: true,
      isNewLaunch: false,
      isPromo: false,
      prices: [
        { size: 2000, price: 38.73, promoPrice: null, costPrice: 22.00, maxAccompaniments: 0 }
      ],
      recipes: []
    }
  ],

  // ACOMPANHAMENTOS DISPONÍVEIS COM CRUD E VÍNCULOS
  accompaniments: [
    { id: "acomp_1", name: "Morango", costPrice: 0.80, active: true, allowedProductIds: [] },
    { id: "acomp_2", name: "Banana", costPrice: 0.40, active: true, allowedProductIds: [] },
    { id: "acomp_3", name: "Kiwi", costPrice: 0.70, active: true, allowedProductIds: [] },
    { id: "acomp_4", name: "Uva", costPrice: 0.60, active: true, allowedProductIds: [] },
    { id: "acomp_5", name: "Manga", costPrice: 0.50, active: true, allowedProductIds: [] },
    { id: "acomp_6", name: "Granola", costPrice: 0.30, active: true, allowedProductIds: [] },
    { id: "acomp_7", name: "Leite condensado", costPrice: 0.50, active: true, allowedProductIds: [] },
    { id: "acomp_8", name: "Ninho", costPrice: 0.60, active: true, allowedProductIds: [] },
    { id: "acomp_9", name: "Chantilly", costPrice: 0.40, active: true, allowedProductIds: [] },
    { id: "acomp_10", name: "Confete", costPrice: 0.40, active: true, allowedProductIds: [] },
    { id: "acomp_11", name: "Bis", costPrice: 0.70, active: true, allowedProductIds: [] },
    { id: "acomp_12", name: "Ovomaltine", costPrice: 0.60, active: true, allowedProductIds: [] },
    { id: "acomp_13", name: "Paçoca", costPrice: 0.30, active: true, allowedProductIds: [] },
    { id: "acomp_14", name: "Sucrilhos", costPrice: 0.30, active: true, allowedProductIds: [] },
    { id: "acomp_15", name: "Gotas de chocolate", costPrice: 0.50, active: true, allowedProductIds: [] },
    { id: "acomp_16", name: "Mel", costPrice: 0.50, active: true, allowedProductIds: [] }
  ],

  // FRUTAS SELECIONÁVEIS
  fruits: ["Banana", "Morango", "Uva", "Manga", "Kiwi"],

  // ADICIONAIS / EXTRAS COM CUSTOS E VÍNCULOS
  extras: [
    { id: "ext_nutella", name: "Nutella", price: 5.90, costPrice: 2.20, active: true, allowInAcai: true, allowInCombos: true },
    { id: "ext_brigadeiro", name: "Brigadeiro", price: 4.90, costPrice: 1.50, active: true, allowInAcai: true, allowInCombos: true },
    { id: "ext_chocoavela", name: "Chocolate com avelã", price: 4.90, costPrice: 1.60, active: true, allowInAcai: true, allowInCombos: true },
    { id: "ext_ovomaltine", name: "Ovomaltine", price: 3.90, costPrice: 1.20, active: true, allowInAcai: true, allowInCombos: true },
    { id: "ext_bis", name: "Bis", price: 4.90, costPrice: 1.40, active: true, allowInAcai: true, allowInCombos: true },
    { id: "ext_sonhodevalsa", name: "Sonho de Valsa", price: 4.90, costPrice: 1.80, active: true, allowInAcai: true, allowInCombos: true },
    { id: "ext_kitkat", name: "Kit Kat (picado)", price: 5.90, costPrice: 2.10, active: true, allowInAcai: true, allowInCombos: true },
    { id: "ext_ninho", name: "Ninho", price: 3.90, costPrice: 0.90, active: true, allowInAcai: true, allowInCombos: true },
    { id: "ext_leitecond", name: "Leite condensado", price: 2.90, costPrice: 0.80, active: true, allowInAcai: true, allowInCombos: true },
    { id: "ext_chantilly", name: "Chantilly", price: 3.90, costPrice: 1.10, active: true, allowInAcai: true, allowInCombos: true },
    { id: "ext_granola", name: "Granola extra", price: 2.90, costPrice: 0.70, active: true, allowInAcai: true, allowInCombos: true },
    { id: "ext_pacoca", name: "Paçoca", price: 2.90, costPrice: 0.60, active: true, allowInAcai: true, allowInCombos: true },
    { id: "ext_confete", name: "Confete", price: 2.90, costPrice: 0.70, active: true, allowInAcai: true, allowInCombos: true },
    { id: "ext_fruta", name: "Acrescentar fruta", price: 3.90, costPrice: 1.30, isFruitExtra: true, active: true, allowInAcai: true, allowInCombos: true }
  ],

  // CUPONS DE DESCONTO
  coupons: [
    {
      id: "cp_1",
      code: "EXPLOSAO10",
      type: "percent",
      value: 10,
      minOrder: 30.00,
      maxDiscount: 15.00,
      active: true,
      uses: 0,
      maxUses: 100
    },
    {
      id: "cp_2",
      code: "PRIMEIRACOMPRA",
      type: "fixed",
      value: 5.00,
      minOrder: 25.00,
      maxDiscount: null,
      active: true,
      uses: 0,
      maxUses: 200
    },
    {
      id: "cp_3",
      code: "QUEROACAI",
      type: "fixed",
      value: 8.00,
      minOrder: 45.00,
      maxDiscount: null,
      active: true,
      uses: 0,
      maxUses: 50
    }
  ],

  // HISTÓRICO REAL DE PEDIDOS
  orders: [],

  // HISTÓRICO REAL DE MENSAGENS DO CHAT
  chats: []
};

class JsonDatabase {
  constructor() {
    this.filePath = DB_FILE;
    this.data = null;
    this.pool = null;
    this.ensureInitialized();
    this.setupPostgres();
  }

  ensureInitialized() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (!fs.existsSync(this.filePath)) {
      this.data = JSON.parse(JSON.stringify(INITIAL_DATA));
      this.saveLocal();
    } else {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.data = JSON.parse(raw);
        for (const [k, v] of Object.entries(INITIAL_DATA)) {
          if (this.data[k] === undefined) {
            this.data[k] = v;
          }
        }
      } catch (err) {
        console.error("Erro ao ler database.json, restaurando inicial:", err);
        this.data = JSON.parse(JSON.stringify(INITIAL_DATA));
        this.saveLocal();
      }
    }
  }

  setupPostgres() {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) return;

    try {
      this.pool = new Pool({
        connectionString: dbUrl,
        ssl: (dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1')) ? false : { rejectUnauthorized: false }
      });

      this.initPostgresTable();
    } catch (e) {
      this.isConnected = false;
    }
  }

  async initPostgresTable() {
    if (!this.pool) return;
    try {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS explosao_database (
          id VARCHAR(50) PRIMARY KEY,
          content JSONB NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      const res = await this.pool.query('SELECT content FROM explosao_database WHERE id = $1', ['main']);
      if (res.rows.length > 0 && res.rows[0].content) {
        this.data = res.rows[0].content;
        this.saveLocal();
        this.isConnected = true;
        console.log('✅ Banco de dados PostgreSQL conectado e sincronizado com sucesso!');
      } else {
        await this.pool.query(
          'INSERT INTO explosao_database (id, content, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (id) DO UPDATE SET content = $2',
          ['main', this.data]
        );
        this.isConnected = true;
        console.log('✅ Banco de dados PostgreSQL inicializado com os dados do Explosão Açaí!');
      }
    } catch (err) {
      this.isConnected = false;
    }
  }

  get() {
    if (!this.data) this.ensureInitialized();
    return this.data;
  }

  saveLocal() {
    const jsonStr = JSON.stringify(this.data, null, 2);
    const tempFile = `${this.filePath}.${Date.now()}.${Math.random().toString(36).substring(2, 7)}.tmp`;
    try {
      fs.writeFileSync(tempFile, jsonStr, 'utf-8');
      fs.renameSync(tempFile, this.filePath);
    } catch (err) {
      try {
        fs.writeFileSync(this.filePath, jsonStr, 'utf-8');
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      } catch (innerErr) {
        console.error("Erro ao salvar database.json localmente:", innerErr);
      }
    }
  }

  save() {
    this.saveLocal();

    if (this.pool && this.isConnected) {
      this.pool.query(
        'INSERT INTO explosao_database (id, content, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (id) DO UPDATE SET content = $2, updated_at = NOW()',
        ['main', this.data]
      ).catch(e => {
        console.error('Erro ao persistir no PostgreSQL:', e.message);
      });
    }
  }
}

export const db = new JsonDatabase();
