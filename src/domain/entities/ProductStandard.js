/* =========================================================================
   PADRÃO ÚNICO DE PRODUTO — EXPLOSÃO AÇAÍ
   Regra permanente: TODO produto (atual ou futuro, criado pelo painel,
   importado do catálogo oficial ou editado) passa por este normalizador.
   Ele garante a estrutura que a tela de detalhes padrão precisa:
     imagem, nome, descrição, tamanhos + preços, adicionais vinculados.

   - NUNCA inventa nem substitui preços/tamanhos já cadastrados.
   - NUNCA remove campos existentes (custos, receitas, vínculos, etc.).
   - É idempotente: aplicar várias vezes produz o mesmo resultado.
   ========================================================================= */

export const PRODUCT_LAYOUT = 'standard';
export const PRODUCT_LAYOUT_VERSION = 1;
export const DEFAULT_PRODUCT_IMAGE = 'imagens/do seu jeitinho.png';

function toNumberOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normaliza a lista de tamanhos preservando todos os campos de cada tamanho
 * (costPrice, maxAccompaniments, promoPrice, etc.) e a ordem cadastrada.
 */
export function normalizeProductPrices(prices) {
  if (!Array.isArray(prices)) return [];
  return prices
    .filter(pr => pr && toNumberOrNull(pr.size) !== null)
    .map(pr => ({
      ...pr,
      size: Number(pr.size),
      price: toNumberOrNull(pr.price) ?? 0,
      promoPrice: toNumberOrNull(pr.promoPrice)
    }));
}

/**
 * Aplica o padrão visual/estrutural único a um produto.
 * @param {object} product  produto cru
 * @param {Array}  categories categorias (opcional) para completar categoryId/categorySlug
 */
export function applyProductStandard(product, categories = []) {
  if (!product || typeof product !== 'object') return product;

  const slug = product.categorySlug || product.category || '';
  const cat = (categories || []).find(c => c.id === product.categoryId || (slug && c.slug === slug));

  return {
    ...product,
    name: typeof product.name === 'string' ? product.name.trim() : product.name,
    description: product.description == null ? '' : String(product.description),
    image: product.image ? product.image : DEFAULT_PRODUCT_IMAGE,
    categoryId: product.categoryId || (cat ? cat.id : product.categoryId),
    categorySlug: product.categorySlug || (cat ? cat.slug : slug) || undefined,
    category: product.category || product.categorySlug || (cat ? cat.slug : undefined),
    comboProductIds: Array.isArray(product.comboProductIds) ? product.comboProductIds : [],
    prices: normalizeProductPrices(product.prices),
    // Marcadores do padrão único (a tela de detalhes é sempre a mesma, sem configuração manual)
    layout: PRODUCT_LAYOUT,
    layoutVersion: PRODUCT_LAYOUT_VERSION
  };
}
