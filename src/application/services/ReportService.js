/* =========================================================================
   SERVIÇO DE RELATÓRIOS GERENCIAIS DE VENDAS E LOGÍSTICA — EXPLOSÃO AÇAÍ
   - Filtros por: Hoje (dia), Mês, Ano e Intervalo Personalizado (Início e Fim)
   - Tempo Médio de Preparo e Tempo Médio de Entrega
   - Ranking de Produtos Mais Vendidos e Menos Vendidos com Fotos e Receita
   - Consolidação de Faturamento Bruto, Líquido, Fretes, Descontos e Custos
   - Análise de Margem e Prejuízos para precificação
   - Estrutura pronta para visualização gráfica e Exportação em PDF A4
   ========================================================================= */

import { db } from '../../infrastructure/database/JsonDatabase.js';

export class ReportService {
  constructor() {
    this.db = db;
  }

  /**
   * Gera relatório financeiro e logístico consolidado
   * @param {Object} options - { period, startDate, endDate }
   */
  getSalesReport({ period = 'all', startDate = null, endDate = null } = {}) {
    const data = this.db.get();
    const orders = data.orders || [];
    const products = data.products || [];
    const now = new Date();

    // 1. Filtragem robusta por datas
    const filteredOrders = orders.filter(o => {
      // Ignora pedidos cancelados na contabilização financeira
      if (o.status === 'cancelled') return false;

      const orderDate = new Date(o.createdAt);

      // Filtro personalizado por intervalo de datas (YYYY-MM-DD ou Date)
      if (startDate || endDate) {
        if (startDate) {
          const s = new Date(startDate);
          s.setHours(0, 0, 0, 0);
          if (orderDate < s) return false;
        }
        if (endDate) {
          const e = new Date(endDate);
          e.setHours(23, 59, 59, 999);
          if (orderDate > e) return false;
        }
        return true;
      }

      // Atalhos de período pré-definido
      if (period === 'today' || period === 'day') {
        return orderDate.toDateString() === now.toDateString();
      } else if (period === 'month') {
        return (
          orderDate.getMonth() === now.getMonth() &&
          orderDate.getFullYear() === now.getFullYear()
        );
      } else if (period === 'year') {
        return orderDate.getFullYear() === now.getFullYear();
      } else if (period === 'week') {
        const weekAgo = new Date();
        weekAgo.setDate(now.getDate() - 7);
        return orderDate >= weekAgo;
      }

      return true; // 'all'
    });

    // 2. Acumuladores financeiros e métricas
    let totalGrossSales = 0; // Soma dos itens/subtotais
    let totalFreight = 0;    // Faturamento total de entregas
    let totalDiscount = 0;   // Descontos concedidos em cupons
    let totalNetSales = 0;   // Total recebido
    let totalCost = 0;       // Custo total de insumos
    const ordersCount = filteredOrders.length;

    // Métricas de tempos operacionais
    let prepTimeSum = 0;
    let prepTimeCount = 0;
    let deliveryTimeSum = 0;
    let deliveryTimeCount = 0;

    // Mapa de itens vendidos para ranking de mais e menos vendidos
    const itemSalesMap = new Map();

    // Inicializa todos os produtos cadastrados no mapa com 0 vendas
    products.forEach(p => {
      itemSalesMap.set(p.name.toLowerCase().trim(), {
        id: p.id,
        name: p.name,
        image: p.image || 'imagens/Logo.png',
        categorySlug: p.categorySlug || 'geral',
        quantitySold: 0,
        grossRevenue: 0,
        totalCost: 0
      });
    });

    const paymentBreakdown = {
      'Pix': { count: 0, total: 0 },
      'Cartão de crédito': { count: 0, total: 0 },
      'Cartão de débito': { count: 0, total: 0 },
      'Dinheiro': { count: 0, total: 0 }
    };

    const deliveryBreakdown = {
      'delivery': { count: 0, totalFreight: 0 },
      'pickup': { count: 0 }
    };

    // 3. Processa cada pedido filtrado
    filteredOrders.forEach(o => {
      const orderSubtotal = Number(o.subtotal || 0);
      const orderFreight = Number(o.freight || 0);
      const orderDiscount = Number(o.discount || 0);
      const orderTotal = Number(o.total || 0);
      const orderCost = Number(o.costTotal || 0);

      totalGrossSales += orderSubtotal;
      totalFreight += orderFreight;
      totalDiscount += orderDiscount;
      totalNetSales += orderTotal;
      totalCost += orderCost;

      // Tempos operacionais
      if (typeof o.preparationTimeMinutes === 'number' && o.preparationTimeMinutes > 0) {
        prepTimeSum += o.preparationTimeMinutes;
        prepTimeCount++;
      }
      if (typeof o.deliveryTimeMinutes === 'number' && o.deliveryTimeMinutes > 0) {
        deliveryTimeSum += o.deliveryTimeMinutes;
        deliveryTimeCount++;
      }

      // Formas de pagamento
      const method = o.payment?.method || 'Dinheiro';
      if (!paymentBreakdown[method]) {
        paymentBreakdown[method] = { count: 0, total: 0 };
      }
      paymentBreakdown[method].count += 1;
      paymentBreakdown[method].total += orderTotal;

      // Modalidade de entrega
      const delType = o.delivery?.type === 'delivery' ? 'delivery' : 'pickup';
      deliveryBreakdown[delType].count += 1;
      if (delType === 'delivery') {
        deliveryBreakdown['delivery'].totalFreight += orderFreight;
      }

      // Contabilização de itens vendidos
      if (Array.isArray(o.items)) {
        o.items.forEach(it => {
          const qty = Number(it.quantity || 1);
          const sub = Number(it.subtotal || (it.unitPrice * qty) || 0);
          const cost = Number(it.costPrice || 0) * qty;

          // Localiza produto correspondente
          const matchingKey = Array.from(itemSalesMap.keys()).find(k => it.name.toLowerCase().includes(k) || k.includes(it.name.toLowerCase()));
          
          if (matchingKey && itemSalesMap.has(matchingKey)) {
            const entry = itemSalesMap.get(matchingKey);
            entry.quantitySold += qty;
            entry.grossRevenue += sub;
            entry.totalCost += cost;
          } else {
            // Item avulso ou customizado
            const newKey = it.name.toLowerCase().trim();
            if (!itemSalesMap.has(newKey)) {
              itemSalesMap.set(newKey, {
                id: `prod_custom_${Date.now()}`,
                name: it.name,
                image: 'imagens/do seu jeitinho.png',
                categorySlug: 'monte',
                quantitySold: qty,
                grossRevenue: sub,
                totalCost: cost
              });
            } else {
              const entry = itemSalesMap.get(newKey);
              entry.quantitySold += qty;
              entry.grossRevenue += sub;
              entry.totalCost += cost;
            }
          }
        });
      }
    });

    // 4. Rankings de Mais e Menos Vendidos
    const allRankedProducts = Array.from(itemSalesMap.values()).map(item => {
      const profit = item.grossRevenue - item.totalCost;
      const marginPercent = item.grossRevenue > 0 ? (profit / item.grossRevenue) * 100 : 0;
      return {
        ...item,
        grossRevenue: Number(item.grossRevenue.toFixed(2)),
        totalCost: Number(item.totalCost.toFixed(2)),
        profit: Number(profit.toFixed(2)),
        marginPercent: Number(marginPercent.toFixed(1))
      };
    });

    // Ordenados por quantidade vendida (descendente para mais vendidos, ascendente para menos vendidos)
    const bestSellers = [...allRankedProducts]
      .sort((a, b) => b.quantitySold - a.quantitySold || b.grossRevenue - a.grossRevenue)
      .slice(0, 10);

    const worstSellers = [...allRankedProducts]
      .sort((a, b) => a.quantitySold - b.quantitySold || a.grossRevenue - b.grossRevenue)
      .slice(0, 10);

    // 5. Médias de tempo
    const averagePreparationTimeMinutes = prepTimeCount > 0 ? Math.round(prepTimeSum / prepTimeCount) : 18;
    const averageDeliveryTimeMinutes = deliveryTimeCount > 0 ? Math.round(deliveryTimeSum / deliveryTimeCount) : 24;

    const grossProfit = totalNetSales - totalCost;
    const profitMargin = totalNetSales > 0 ? (grossProfit / totalNetSales) * 100 : 0;
    const averageTicket = ordersCount > 0 ? totalNetSales / ordersCount : 0;

    return {
      period,
      filter: {
        period,
        startDate: startDate || null,
        endDate: endDate || null
      },
      generatedAt: new Date().toISOString(),
      summary: {
        totalNetSales: Number(totalNetSales.toFixed(2)),
        totalGrossSales: Number(totalGrossSales.toFixed(2)),
        totalFreight: Number(totalFreight.toFixed(2)),
        totalDiscount: Number(totalDiscount.toFixed(2)),
        totalCost: Number(totalCost.toFixed(2)),
        grossProfit: Number(grossProfit.toFixed(2)),
        profitMargin: Number(profitMargin.toFixed(1)),
        ordersCount,
        averageTicket: Number(averageTicket.toFixed(2)),
        averagePreparationTimeMinutes,
        averageDeliveryTimeMinutes
      },
      bestSellers,
      worstSellers,
      paymentBreakdown,
      deliveryBreakdown,
      orders: filteredOrders.map(o => ({
        id: o.id,
        orderNo: o.orderNo,
        customerName: o.customer.name,
        customerPhone: o.customer.phone,
        deliveryType: o.delivery?.type === 'delivery' ? 'Entrega' : 'Retirada',
        bairro: o.delivery?.bairro || '-',
        paymentMethod: o.payment.method,
        paymentTiming: o.payment.timing || (o.payment.method === 'Dinheiro' ? 'delivery' : 'online'),
        paymentStatus: o.payment.status,
        subtotal: o.subtotal,
        freight: o.freight,
        discount: o.discount,
        total: o.total,
        costTotal: o.costTotal,
        profit: Number((o.total - (o.costTotal || 0)).toFixed(2)),
        status: o.status,
        preparationTimeMinutes: o.preparationTimeMinutes || null,
        deliveryTimeMinutes: o.deliveryTimeMinutes || null,
        createdAt: o.createdAt
      }))
    };
  }
}

export const reportService = new ReportService();
