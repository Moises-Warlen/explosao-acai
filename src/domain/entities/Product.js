/* =========================================================================
   ENTIDADE PRODUCT (DOMÍNIO) — EXPLOSÃO AÇAÍ
   - Estrutura completa de produto com preços por tamanho, receitas e custos
   - Detecção de prejuízo quando custo de insumos supera o preço de venda
   - Suporte a Combos, Lançamentos e Produtos em Promoção
   ========================================================================= */

export class Product {
  constructor({
    id,
    name,
    category,
    categorySlug,
    description = '',
    details = '',
    image = '',
    active = true,
    isCustomizable = false,
    isNewLaunch = false,
    isPromo = false,
    comboProductIds = [],
    maxAccompaniments = 0,
    prices = [],
    recipes = []
  }) {
    this.id = id || `prod_${Date.now()}`;
    this.name = name;
    this.category = category || categorySlug;
    this.categorySlug = categorySlug || category;
    this.description = description;
    this.details = details;
    this.image = image;
    this.active = active;
    this.isCustomizable = isCustomizable;
    this.isNewLaunch = isNewLaunch;
    this.isPromo = isPromo;
    this.comboProductIds = comboProductIds;
    this.maxAccompaniments = maxAccompaniments;
    this.prices = (prices || []).map(pr => {
      const price = Number(pr.price || 0);
      const costPrice = Number(pr.costPrice || 0);
      const isLoss = costPrice > price;
      return {
        ...pr,
        price,
        costPrice,
        isLoss,
        lossAmount: isLoss ? Number((costPrice - price).toFixed(2)) : 0
      };
    });
    this.recipes = recipes;
  }

  getPriceForSize(size) {
    const p = this.prices.find(x => x.size === Number(size));
    if (!p) return null;
    return p.promoPrice !== null && p.promoPrice !== undefined ? Number(p.promoPrice) : Number(p.price);
  }
}
