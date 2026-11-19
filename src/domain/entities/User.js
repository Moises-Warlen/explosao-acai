/**
 * Entidade de Domínio: Usuário (User)
 * Representa um operador ou administrador do sistema com suporte a RBAC granular e conformidade LGPD.
 */

export const SystemModules = {
  ORDERS: 'orders',                 // Pedidos & Cozinha (Kanban / PDV)
  ROUTES: 'routes',                 // Rotas & GPS
  MOTOBOYS: 'motoboys',             // Gestão de Entregadores
  CHAT: 'chat',                     // Chat com Clientes
  CATALOG: 'catalog',               // Cardápio, Produtos & Estoque
  ACCOMPANIMENTS: 'accompaniments', // Acompanhamentos, Frutas & Adicionais
  REPORTS: 'reports',               // Relatórios Financeiros & Vendas
  COUPONS: 'coupons',               // Cupons de Desconto
  PRINTERS: 'printers',             // Impressoras Térmicas
  STORE: 'store',                   // Configurações da Loja & Frete
  USERS: 'users',                   // Gerenciamento de Usuários RBAC
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
    if (!moduleKey) return false;

    const requiredKeys = Array.isArray(moduleKey) ? moduleKey : [moduleKey];

    return requiredKeys.some(key => {
      if (this.permissions.includes(key)) return true;

      // Suporte a hierarquia: se tem 'orders', tem acesso a qualquer 'orders.*'
      const parts = String(key).split('.');
      if (parts.length > 1) {
        const rootModule = parts[0];
        if (this.permissions.includes(rootModule) || this.permissions.includes(`${rootModule}.*`)) return true;
        if (parts.length > 2) {
          const subModule = `${parts[0]}.${parts[1]}`;
          if (this.permissions.includes(subModule) || this.permissions.includes(`${subModule}.*`)) return true;
        }
      }

      // Se a verificação é de módulo macro (ex: 'orders') e o usuário possui ao menos uma sub-permissão desse módulo
      if (!key.includes('.') && this.permissions.some(p => p.startsWith(`${key}.`))) {
        return true;
      }

      return false;
    });
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
