import { describe, it } from 'node:test';
import assert from 'node:assert';
import { applyProductStandard, PRODUCT_LAYOUT, DEFAULT_PRODUCT_IMAGE } from '../src/domain/entities/ProductStandard.js';
import { CatalogService } from '../src/application/services/CatalogService.js';
import { db } from '../src/infrastructure/database/JsonDatabase.js';

describe('Padrão único de produto (tela de detalhes padronizada)', () => {
  it('applyProductStandard preserva tamanhos, preços e campos individuais (sem inventar valores)', () => {
    const raw = {
      id: 'x', name: '  Teste  ', categorySlug: 'premium',
      prices: [
        { size: 300, price: 23.9, costPrice: 9.5, promoPrice: null, maxAccompaniments: 0 },
        { size: 500, price: '31.9', costPrice: 13, promoPrice: 29.9 }
      ],
      customField: 'mantido', allowedAccompanimentIds: ['a1']
    };
    const std = applyProductStandard(raw, []);
    assert.strictEqual(std.layout, PRODUCT_LAYOUT);
    assert.strictEqual(std.name, 'Teste');
    assert.strictEqual(std.image, DEFAULT_PRODUCT_IMAGE);
    assert.strictEqual(std.description, '');
    assert.deepStrictEqual(std.prices.map(p => [p.size, p.price, p.promoPrice]), [[300, 23.9, null], [500, 31.9, 29.9]]);
    assert.strictEqual(std.prices[0].costPrice, 9.5);
    assert.strictEqual(std.customField, 'mantido');
    assert.deepStrictEqual(std.allowedAccompanimentIds, ['a1']);
  });

  it('é idempotente', () => {
    const once = applyProductStandard({ id: 'y', name: 'Y', categorySlug: 'fitness', prices: [{ size: 300, price: 10 }] });
    assert.deepStrictEqual(applyProductStandard(once), once);
  });

  it('todos os produtos do cardápio atual saem no padrão, com preços idênticos aos cadastrados', () => {
    const svc = new CatalogService();
    const raw = db.get().products;
    const cat = svc.getCatalog();
    assert.strictEqual(cat.products.length, raw.length);
    for (const r of raw) {
      const p = cat.products.find(x => x.id === r.id);
      assert.ok(p, `produto ${r.id} sumiu`);
      assert.strictEqual(p.layout, PRODUCT_LAYOUT, `${r.id} fora do padrão`);
      assert.ok(p.image && p.name, `${r.id} sem imagem/nome`);
      assert.strictEqual(p.prices.length, (r.prices || []).length, `${r.id} mudou a quantidade de tamanhos`);
      p.prices.forEach((pr, i) => {
        assert.strictEqual(pr.size, Number(r.prices[i].size));
        assert.strictEqual(pr.price, Number(r.prices[i].price), `${r.id} preço alterado`);
      });
    }
    assert.strictEqual(new Set(raw.map(p => p.id)).size, raw.length, 'produtos duplicados');
    assert.strictEqual(new Set(cat.categories.map(c => c.slug)).size, cat.categories.length, 'categorias duplicadas');
  });

  it('produto novo cadastrado recebe o padrão automaticamente e funciona no catálogo/pedido', () => {
    const svc = new CatalogService();
    const id = `prod_teste_padrao_${Date.now()}`;
    try {
      const created = svc.createProduct({
        id, name: 'Produto Teste Padrão', categorySlug: 'fitness',
        prices: [{ size: 300, price: 18.5, costPrice: 6 }, { size: 500, price: 25.5, costPrice: 9 }]
      });
      assert.strictEqual(created.layout, PRODUCT_LAYOUT);
      assert.strictEqual(created.image, DEFAULT_PRODUCT_IMAGE);
      assert.strictEqual(created.categorySlug, 'fitness');
      assert.ok(created.categoryId);

      const inCatalog = svc.getCatalog().products.find(p => p.id === id);
      assert.ok(inCatalog);
      assert.deepStrictEqual(inCatalog.prices.map(p => [p.size, p.price]), [[300, 18.5], [500, 25.5]]);

      // Edição sem tamanhos não pode apagar os tamanhos cadastrados
      const updated = svc.updateProduct(id, { description: 'nova descrição', prices: [] });
      assert.strictEqual(updated.prices.length, 2);
      assert.strictEqual(updated.layout, PRODUCT_LAYOUT);
      assert.strictEqual(updated.description, 'nova descrição');
    } finally {
      try { svc.deleteProduct(id); } catch (e) {}
    }
    assert.ok(!db.get().products.some(p => p.id === id), 'produto de teste deveria ter sido removido');
  });
});
