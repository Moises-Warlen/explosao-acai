/**
 * Entidade de Domínio: Usuário (User)
 * Representa um operador ou administrador do sistema com suporte a RBAC granular e conformidade LGPD.
 */

export const SystemModules = {
  ORDERS: 'orders',                 // Pedidos & Cozinha (Kanban / PDV)
  CHAT: 'chat',                     // Chat com Clientes
  CATALOG: 'catalog',               // Cardápio, Produtos & Estoque
  ACCOMPANIMENTS: 'accompaniments', // Acompanhamentos, Frutas & Adicionais
  REPORTS: 'reports',               // Relatórios Financeiros & Vendas
  COUPONS: 'coupons',               // Cupons de Desconto
  PRINTERS: 'printers',             // Impressoras Térmicas
  STORE: 'store',                   // Configurações da Loja & Frete
  BOT: 'bot',                       // Bot WhatsApp & IA
  SECURITY: 'security'              // Logs de Segurança & Firewall
};

export const UserRole = {
  ADMIN: 'admin',
  OPERATOR: 'operator'
};

export class User {
  constructor({
    id,
    name,
    email,
    passwordHash,
    role = UserRole.OPERATOR,
    permissions = [],
    active = true,
    isDeleted = false,
    createdAt = new Date().toISOString(),
    updatedAt = new Date().toISOString()
  }) {
    this.id = id || `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.name = String(name || '').trim();
    this.email = String(email || '').trim().toLowerCase();
    this.passwordHash = passwordHash || '';
    this.role = role === UserRole.ADMIN ? UserRole.ADMIN : UserRole.OPERATOR;
    this.permissions = this.role === UserRole.ADMIN ? ['*'] : (Array.isArray(permissions) ? permissions : []);
    this.active = active !== false;
    this.isDeleted = Boolean(isDeleted);
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  isAdmin() {
    return this.role === UserRole.ADMIN;
  }

  hasPermission(moduleKey) {
    if (this.isAdmin()) return true;
    if (this.permissions.includes('*')) return true;
    return this.permissions.includes(moduleKey);
  }

  /**
   * Converte para DTO seguro (sem hash de senha, atendendo requisitos de LGPD e proteção de dados)
   */
  toDTO() {
    return {
      id: this.id,
      name: this.name,
      email: this.email,
      role: this.role,
      permissions: this.permissions,
      active: this.active,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}
