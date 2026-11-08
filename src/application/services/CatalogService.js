/* =========================================================================
   SERVIÇO DE CATÁLOGO & ENGENHARIA DE CARDÁPIO — EXPLOSÃO AÇAÍ
   - CRUD completo de Categorias
   - CRUD completo de Produtos com pausa e tamanhos dinâmicos
   - Ficha Técnica de Insumos & Soma Automática de Custos em Combos
   - Regras de acompanhamentos inclusos por tamanho (300ml: 3, 500ml: 4, 700ml: 5)
   - CRUD de Acompanhamentos/Complementos com vinculação a produtos
   - CRUD de Adicionais com Preço, Custo e Vínculos (Açaí e Combos)
   - Filtros de Lançamentos, Promoções, Mais Vendidos e Menos Vendidos
   ========================================================================= */

import { db } from '../../infrastructure/database/JsonDatabase.js';

export class CatalogService {
  constructor() {
    this.db = db;
  }

  // ================= CATEGORIAS =================
  getCategories() {
    const data = this.db.get();
    return (data.categories || []).sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  createCategory(catData) {
    const data = this.db.get();
    const slug = (catData.slug || catData.name).toLowerCase().replace(/[^a-z0-9]/g, '-');
    
    if (data.categories.some(c => c.slug === slug)) {
      throw new Error('Já existe uma categoria com este identificador/slug.');
    }

    const newCat = {
      id: `cat_${Date.now()}`,
      name: catData.name.trim(),
      slug,
      order: Number(catData.order || data.categories.length + 1),
      active: catData.active !== undefined ? !!catData.active : true
    };

    data.categories.push(newCat);
    this.db.save();
    return newCat;
  }

  updateCategory(id, updates) {
    const data = this.db.get();
    const idx = data.categories.findIndex(c => c.id === id);
    if (idx === -1) throw new Error('Categoria não encontrada.');

    data.categories[idx] = {
      ...data.categories[idx],
      ...updates,
      id
    };

    this.db.save();
    return data.categories[idx];
  }

  deleteCategory(id) {
    const data = this.db.get();
    const idx = data.categories.findIndex(c => c.id === id);
    if (idx === -1) throw new Error('Categoria não encontrada.');

    const removed = data.categories.splice(idx, 1);
    this.db.save();
    return removed[0];
  }

  // ================= ACOMPANHAMENTOS / COMPLEMENTOS =================
  getAccompaniments(productId = null) {
    const data = this.db.get();
    let list = data.accompaniments || [];

    // Normaliza para objetos caso haja strings antigas
    list = list.map((ac, idx) => {
      if (typeof ac === 'string') {
        return {
          id: `acomp_${idx + 1}`,
          name: ac,
          costPrice: 0.50,
          active: true,
          allowedProductIds: [] // Vazio = liberado para todos
        };
      }
      return ac;
    });

    if (productId) {
      list = list.filter(ac => {
        if (!ac.active) return false;
        if (!ac.allowedProductIds || ac.allowedProductIds.length === 0) return true;
        return ac.allowedProductIds.includes(productId);
      });
    }

    return list;
  }

  createAccompaniment(data) {
    const dbData = this.db.get();
    if (!Array.isArray(dbData.accompaniments)) dbData.accompaniments = [];

    const newAcomp = {
      id: `acomp_${Date.now()}`,
      name: data.name.trim(),
      costPrice: Number(data.costPrice || 0.50),
      active: data.active !== undefined ? !!data.active : true,
      allowedProductIds: Array.isArray(data.allowedProductIds) ? data.allowedProductIds : []
    };

    dbData.accompaniments.push(newAcomp);
    this.db.save();
    return newAcomp;
  }

  updateAccompaniment(id, updates) {
    const dbData = this.db.get();
    const idx = dbData.accompaniments.findIndex(a => a.id === id || a.name === id);
    if (idx === -1) throw new Error('Acompanhamento não encontrado.');

    dbData.accompaniments[idx] = {
      ...dbData.accompaniments[idx],
      ...updates,
      id
    };

    this.db.save();
    return dbData.accompaniments[idx];
  }

  deleteAccompaniment(id) {
    const dbData = this.db.get();
    const idx = dbData.accompaniments.findIndex(a => a.id === id || a.name === id);
    if (idx === -1) throw new Error('Acompanhamento não encontrado.');

    const removed = dbData.accompaniments.splice(idx, 1);
    this.db.save();
    return removed[0];
  }

  // ================= PRODUTOS & FICHA TÉCNICA =================
  getCatalog() {
    const data = this.db.get();
    
    // Enriquece os produtos com análise de margem e custos de combos
    const enrichedProducts = (data.products || []).map(p => this.enrichProductWithCosts(p, data.products));

    return {
      categories: this.getCategories(),
      products: enrichedProducts,
      accompaniments: this.getAccompaniments(),
      fruits: data.fruits || [],
      extras: data.extras || []
    };
  }

  getProductById(id) {
    const products = this.db.get().products || [];
    const p = products.find(x => x.id === id);
    return p ? this.enrichProductWithCosts(p, products) : null;
  }

  /**
   * Calcula custos de insumos, soma custos de combos e detecta alertas de prejuízo
   */
  enrichProductWithCosts(product, allProducts = []) {
    const isCombo = product.categorySlug === 'combos' || product.category === 'combos';

    // Se for combo com produtos vinculados, calcula custo somando os custos dos copos
    let comboCalculatedCost = 0;
    if (isCombo && Array.isArray(product.comboProductIds) && product.comboProductIds.length > 0) {
      product.comboProductIds.forEach(pId => {
        const subProd = allProducts.find(x => x.id === pId);
        if (subProd && subProd.prices && subProd.prices.length > 0) {
          comboCalculatedCost += (subProd.prices[0].costPrice || 0);
        }
      });
    }

    const prices = (product.prices || []).map(pr => {
      // Busca a receita cadastrada para este tamanho (se houver)
      const recipe = (product.recipes || []).find(r => r.size === pr.size);
      let calculatedCost = pr.costPrice || 0;

      if (comboCalculatedCost > 0) {
        calculatedCost = comboCalculatedCost;
      } else if (recipe && Array.isArray(recipe.ingredients) && recipe.ingredients.length > 0) {
        calculatedCost = recipe.ingredients.reduce((acc, ing) => acc + (Number(ing.totalCost) || (ing.quantity * ing.unitCost)), 0);
      }

      // Regra padrão de acompanhamentos inclusos caso não especificado no tamanho:
      // 300ml: 3 inclusos, 500ml: 4 inclusos, 700ml: 5 inclusos
      let maxAccompaniments = pr.maxAccompaniments;
      if (maxAccompaniments === undefined || maxAccompaniments === null) {
        if (pr.size === 300) maxAccompaniments = 3;
        else if (pr.size === 500) maxAccompaniments = 4;
        else if (pr.size === 700) maxAccompaniments = 5;
        else maxAccompaniments = product.maxAccompaniments || 0;
      }

      const effectivePrice = pr.promoPrice !== null && pr.promoPrice !== undefined ? pr.promoPrice : pr.price;
      const margin = effectivePrice - calculatedCost;
      const marginPercent = effectivePrice > 0 ? (margin / effectivePrice) * 100 : 0;
      const isLoss = calculatedCost > effectivePrice; // ALERTA DE PREJUÍZO!

      return {
        ...pr,
        maxAccompaniments,
        costPrice: Number(calculatedCost.toFixed(2)),
        margin: Number(margin.toFixed(2)),
        marginPercent: Number(marginPercent.toFixed(1)),
        isLoss,
        lossAmount: isLoss ? Number((calculatedCost - effectivePrice).toFixed(2)) : 0
      };
    });

    const hasAnyLoss = prices.some(pr => pr.isLoss);

    return {
      ...product,
      prices,
      hasAnyLoss
    };
  }

  createProduct(productData) {
    const data = this.db.get();
    const id = productData.id || `prod_${Date.now()}`;

    const categorySlug = productData.categorySlug || productData.category || 'prontos';
    const category = data.categories.find(c => c.slug === categorySlug || c.id === productData.categoryId);

    // Ajusta tamanhos e regras de acompanhamentos
    const prices = (productData.prices || [{ size: 500, price: 20.00, promoPrice: null, costPrice: 9.00, maxAccompaniments: 4 }]).map(pr => {
      let maxAcc = pr.maxAccompaniments;
      if (maxAcc === undefined) {
        if (pr.size === 300) maxAcc = 3;
        else if (pr.size === 500) maxAcc = 4;
        else if (pr.size === 700) maxAcc = 5;
        else maxAcc = productData.maxAccompaniments || 0;
      }
      return { ...pr, maxAccompaniments: Number(maxAcc) };
    });

    const newProduct = {
      id,
      name: productData.name.trim(),
      categoryId: category ? category.id : 'cat_prontos',
      categorySlug: category ? category.slug : categorySlug,
      description: productData.description || '',
      details: productData.details || '',
      image: productData.image || 'imagens/do seu jeitinho.png',
      active: productData.active !== undefined ? !!productData.active : true,
      isCustomizable: !!productData.isCustomizable,
      isNewLaunch: !!productData.isNewLaunch,
      isPromo: !!productData.isPromo,
      comboProductIds: Array.isArray(productData.comboProductIds) ? productData.comboProductIds : [],
      prices,
      recipes: productData.recipes || []
    };

    data.products.push(newProduct);
    this.db.save();
    return this.enrichProductWithCosts(newProduct, data.products);
  }

  updateProduct(id, updates) {
    const data = this.db.get();
    const idx = data.products.findIndex(p => p.id === id);
    if (idx === -1) throw new Error('Produto não encontrado.');

    data.products[idx] = {
      ...data.products[idx],
      ...updates,
      id
    };

    this.db.save();
    return this.enrichProductWithCosts(data.products[idx], data.products);
  }

  toggleProductActive(id) {
    const data = this.db.get();
    const p = data.products.find(x => x.id === id);
    if (!p) throw new Error('Produto não encontrado.');
    p.active = !p.active;
    this.db.save();
    return p;
  }

  deleteProduct(id) {
    const data = this.db.get();
    const idx = data.products.findIndex(p => p.id === id);
    if (idx === -1) throw new Error('Produto não encontrado.');

    const removed = data.products.splice(idx, 1);
    this.db.save();
    return removed[0];
  }

  // ================= ADICIONAIS / EXTRAS =================
  createExtra(extraData) {
    const data = this.db.get();
    const newExtra = {
      id: `ext_${Date.now()}`,
      name: extraData.name.trim(),
      price: Number(extraData.price || 0),
      costPrice: Number(extraData.costPrice || 0),
      active: extraData.active !== undefined ? !!extraData.active : true,
      isFruitExtra: !!extraData.isFruitExtra,
      allowInAcai: extraData.allowInAcai !== undefined ? !!extraData.allowInAcai : true,
      allowInCombos: extraData.allowInCombos !== undefined ? !!extraData.allowInCombos : false
    };

    data.extras.push(newExtra);
    this.db.save();
    return newExtra;
  }

  updateExtra(id, updates) {
    const data = this.db.get();
    const idx = data.extras.findIndex(e => e.id === id);
    if (idx === -1) throw new Error('Adicional não encontrado.');

    data.extras[idx] = {
      ...data.extras[idx],
      ...updates,
      id
    };

    this.db.save();
    return data.extras[idx];
  }

  deleteExtra(id) {
    const data = this.db.get();
    const idx = data.extras.findIndex(e => e.id === id);
    if (idx === -1) throw new Error('Adicional não encontrado.');

    const removed = data.extras.splice(idx, 1);
    this.db.save();
    return removed[0];
  }

  // ================= MAIS VENDIDOS E MENOS VENDIDOS =================
  getProductSalesRanking() {
    const orders = this.db.get().orders || [];
    const counts = {};
    const revenue = {};

    orders.forEach(o => {
      if (o.status === 'cancelled') return;
      (o.items || []).forEach(it => {
        const baseName = it.name.replace(/\s+\d+\s*ml/i, '').trim();
        counts[baseName] = (counts[baseName] || 0) + (it.quantity || 1);
        revenue[baseName] = (revenue[baseName] || 0) + (it.subtotal || (it.unitPrice * it.quantity));
      });
    });

    const products = this.db.get().products || [];
    const ranking = products.map(p => {
      const enriched = this.enrichProductWithCosts(p, products);
      return {
        ...enriched,
        salesCount: counts[p.name] || 0,
        salesRevenue: Number((revenue[p.name] || 0).toFixed(2))
      };
    });

    const bestSellers = [...ranking].sort((a, b) => b.salesCount - a.salesCount);
    const worstSellers = [...ranking].sort((a, b) => a.salesCount - b.salesCount);

    return { bestSellers, worstSellers };
  }

  getBestSellers(limit = 4) {
    const { bestSellers } = this.getProductSalesRanking();
    return bestSellers.slice(0, limit);
  }

  getWorstSellers(limit = 4) {
    const { worstSellers } = this.getProductSalesRanking();
    return worstSellers.slice(0, limit);
  }

  getPromotions() {
    const products = this.db.get().products || [];
    return products
      .filter(p => p.active && (p.isPromo || p.prices.some(pr => pr.promoPrice !== null && pr.promoPrice !== undefined)))
      .map(p => this.enrichProductWithCosts(p, products));
  }

  getLaunches() {
    const products = this.db.get().products || [];
    return products
      .filter(p => p.active && p.isNewLaunch)
      .map(p => this.enrichProductWithCosts(p, products));
  }
}

export const catalogService = new CatalogService();
