/**
 * Serviço de Aplicação: UserService
 * Responsável pelas regras de negócio de Usuários, RBAC (Controle de Acesso Baseado em Papéis) e conformidade LGPD.
 */

import { db } from '../../infrastructure/database/JsonDatabase.js';
import { User, UserRole } from '../../domain/entities/User.js';
import { hashPassword, verifyPasswordHash, verifyAndMigratePassword } from '../../presentation/middlewares/authMiddleware.js';
import { securityAuditService, SecurityEventType, SecuritySeverity } from '../../infrastructure/security/SecurityAuditService.js';

export class UserService {
  constructor() {
    this.db = db;
    this.ensureDefaultAdmin();
  }

  /**
   * Garante a existência do usuário Administrador padrão do sistema sem risco de bloqueio
   */
  ensureDefaultAdmin() {
    try {
      const data = this.db.get();
      if (!data) return;
      if (!Array.isArray(data.users)) {
        data.users = [];
      }

      const hasActiveAdmin = data.users.some(u => !u.isDeleted && u.active && u.role === UserRole.ADMIN);
      if (!hasActiveAdmin) {
        const adminPass = data.settings?.adminPassword || process.env.ADMIN_PASSWORD || 'ExplosaoMaster#2026';
        const passwordHash = adminPass.startsWith('$scrypt$') ? adminPass : hashPassword(adminPass);

        const defaultAdmin = new User({
          id: 'usr_admin_default',
          name: 'Administrador',
          email: 'admin@explosaoacai.com.br',
          passwordHash,
          role: UserRole.ADMIN,
          permissions: ['*'],
          active: true,
          isDeleted: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });

        // Se já existia um registro com id padrão, apenas atualiza para ativo
        const existingIdx = data.users.findIndex(u => u.id === 'usr_admin_default');
        if (existingIdx !== -1) {
          data.users[existingIdx].active = true;
          data.users[existingIdx].isDeleted = false;
          data.users[existingIdx].role = UserRole.ADMIN;
          data.users[existingIdx].permissions = ['*'];
          if (!data.users[existingIdx].passwordHash) {
            data.users[existingIdx].passwordHash = passwordHash;
          }
        } else {
          data.users.unshift(defaultAdmin);
        }

        this.db.save();
      }
    } catch (e) {
      console.warn('[UserService] Erro ao assegurar admin padrão:', e.message);
    }
  }

  /**
   * Retorna o usuário Admin padrão do sistema
   */
  getDefaultAdmin() {
    this.ensureDefaultAdmin();
    const data = this.db.get();
    const adminData = (data.users || []).find(u => !u.isDeleted && u.active && u.role === UserRole.ADMIN) || {
      id: 'usr_admin_default',
      name: 'Administrador',
      email: 'admin@explosaoacai.com.br',
      role: UserRole.ADMIN,
      permissions: ['*'],
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    return new User(adminData);
  }

  /**
   * Lista todos os usuários não removidos
   */
  listUsers() {
    this.ensureDefaultAdmin();
    const data = this.db.get();
    const list = (data.users || []).filter(u => !u.isDeleted);
    return list.map(u => new User(u).toDTO());
  }

  /**
   * Busca um usuário pelo ID
   */
  getUserById(id) {
    if (!id) return null;
    const data = this.db.get();
    const found = (data.users || []).find(u => u.id === id && !u.isDeleted);
    return found ? new User(found).toDTO() : null;
  }

  /**
   * Cria um novo usuário com hash de senha seguro e auditoria
   */
  createUser({ name, email, password, role = UserRole.OPERATOR, permissions = [], active = true }) {
    if (!name || String(name).trim().length < 2) {
      throw new Error('O nome do usuário deve conter no mínimo 2 caracteres.');
    }
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail || cleanEmail.length < 3) {
      throw new Error('Informe um login ou e-mail válido para o usuário.');
    }
    if (!password || String(password).trim().length < 4) {
      throw new Error('A senha deve conter no mínimo 4 caracteres.');
    }

    const data = this.db.get();
    if (!Array.isArray(data.users)) data.users = [];

    const emailInUse = data.users.some(u => !u.isDeleted && u.email === cleanEmail);
    if (emailInUse) {
      throw new Error(`O e-mail/login "${cleanEmail}" já está em uso por outro usuário.`);
    }

    const assignedRole = role === UserRole.ADMIN ? UserRole.ADMIN : UserRole.OPERATOR;
    const assignedPermissions = assignedRole === UserRole.ADMIN ? ['*'] : (Array.isArray(permissions) ? permissions : []);
    const passHash = hashPassword(String(password).trim());

    const newUser = new User({
      name: String(name).trim(),
      email: cleanEmail,
      passwordHash: passHash,
      role: assignedRole,
      permissions: assignedPermissions,
      active: active !== false,
      isDeleted: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    data.users.push(newUser);
    this.db.save();

    try {
      securityAuditService.recordEvent({
        type: SecurityEventType.CONFIG_CHANGE,
        severity: SecuritySeverity.LOW,
        ip: 'Internal',
        endpoint: '/api/users',
        method: 'POST',
        details: `Novo usuário criado: ${newUser.name} (${newUser.email}) - Perfil: ${newUser.role}.`
      });
    } catch (e) {}

    return newUser.toDTO();
  }

  /**
   * Atualiza dados de um usuário existente com travas de segurança
   */
  updateUser(id, { name, email, password, role, permissions, active }, currentUserId) {
    if (!id) throw new Error('ID do usuário é obrigatório.');
    const data = this.db.get();
    const userIdx = (data.users || []).findIndex(u => u.id === id && !u.isDeleted);
    if (userIdx === -1) throw new Error('Usuário não encontrado.');

    const targetUser = data.users[userIdx];

    // Trava de segurança: Impedir a desativação ou rebaixamento do último Administrador ativo
    const isTargetAdmin = targetUser.role === UserRole.ADMIN && targetUser.active;
    const willBeInactive = active !== undefined && !active;
    const willBeDemoted = role !== undefined && role !== UserRole.ADMIN;

    if (isTargetAdmin && (willBeInactive || willBeDemoted)) {
      const otherActiveAdmins = (data.users || []).filter(u => !u.isDeleted && u.active && u.role === UserRole.ADMIN && u.id !== id);
      if (otherActiveAdmins.length === 0) {
        throw new Error('Operação bloqueada: não é permitido desativar ou rebaixar o único Administrador ativo do sistema.');
      }
    }

    // Trava de segurança: Impedir a desativação do próprio usuário logado no momento
    if (currentUserId && id === currentUserId && willBeInactive) {
      throw new Error('Operação bloqueada: você não pode desativar o seu próprio usuário logado no momento.');
    }

    if (name) targetUser.name = String(name).trim();

    if (email) {
      const cleanEmail = String(email).trim().toLowerCase();
      const duplicate = (data.users || []).some(u => !u.isDeleted && u.id !== id && u.email === cleanEmail);
      if (duplicate) {
        throw new Error(`O e-mail/login "${cleanEmail}" já está em uso por outro usuário.`);
      }
      targetUser.email = cleanEmail;
    }

    // Alteração de senha opcional na edição
    if (password && String(password).trim().length >= 4) {
      targetUser.passwordHash = hashPassword(String(password).trim());
    }

    if (role !== undefined) {
      targetUser.role = role === UserRole.ADMIN ? UserRole.ADMIN : UserRole.OPERATOR;
      targetUser.permissions = targetUser.role === UserRole.ADMIN ? ['*'] : (Array.isArray(permissions) ? permissions : targetUser.permissions);
    } else if (permissions !== undefined && targetUser.role !== UserRole.ADMIN) {
      targetUser.permissions = Array.isArray(permissions) ? permissions : [];
    }

    if (active !== undefined) {
      targetUser.active = Boolean(active);
    }

    targetUser.updatedAt = new Date().toISOString();
    this.db.save();

    try {
      securityAuditService.recordEvent({
        type: SecurityEventType.CONFIG_CHANGE,
        severity: SecuritySeverity.LOW,
        ip: 'Internal',
        endpoint: `/api/users/${id}`,
        method: 'PUT',
        details: `Usuário atualizado: ${targetUser.name} (${targetUser.email}).`
      });
    } catch (e) {}

    return new User(targetUser).toDTO();
  }

  /**
   * Alterna rapidamente o status ativo/inativo com travas de segurança
   */
  toggleUserStatus(id, currentUserId) {
    if (!id) throw new Error('ID do usuário é obrigatório.');
    const data = this.db.get();
    const user = (data.users || []).find(u => u.id === id && !u.isDeleted);
    if (!user) throw new Error('Usuário não encontrado.');

    // Trava de segurança: se for desativar
    if (user.active) {
      if (user.role === UserRole.ADMIN) {
        const otherActiveAdmins = (data.users || []).filter(u => !u.isDeleted && u.active && u.role === UserRole.ADMIN && u.id !== id);
        if (otherActiveAdmins.length === 0) {
          throw new Error('Operação bloqueada: não é permitido desativar o único Administrador ativo do sistema.');
        }
      }
      if (currentUserId && id === currentUserId) {
        throw new Error('Operação bloqueada: você não pode desativar o seu próprio usuário logado no momento.');
      }
    }

    user.active = !user.active;
    user.updatedAt = new Date().toISOString();
    this.db.save();

    return new User(user).toDTO();
  }

  /**
   * Remove o usuário garantindo integridade referencial e conformidade LGPD (Soft Delete & Anonimização)
   */
  deleteUser(id, currentUserId) {
    if (!id) throw new Error('ID do usuário é obrigatório.');
    const data = this.db.get();
    const user = (data.users || []).find(u => u.id === id && !u.isDeleted);
    if (!user) throw new Error('Usuário não encontrado.');

    // Trava de segurança: não pode remover o único admin ativo
    if (user.role === UserRole.ADMIN && user.active) {
      const otherActiveAdmins = (data.users || []).filter(u => !u.isDeleted && u.active && u.role === UserRole.ADMIN && u.id !== id);
      if (otherActiveAdmins.length === 0) {
        throw new Error('Operação bloqueada: não é permitido remover o único Administrador ativo do sistema.');
      }
    }

    // Trava de segurança: não pode remover a si próprio
    if (currentUserId && id === currentUserId) {
      throw new Error('Operação bloqueada: você não pode remover o seu próprio usuário logado no momento.');
    }

    // Soft Delete conforme LGPD
    user.isDeleted = true;
    user.active = false;
    user.updatedAt = new Date().toISOString();
    this.db.save();

    try {
      securityAuditService.recordEvent({
        type: SecurityEventType.CONFIG_CHANGE,
        severity: SecuritySeverity.MEDIUM,
        ip: 'Internal',
        endpoint: `/api/users/${id}`,
        method: 'DELETE',
        details: `Usuário removido (soft delete LGPD): ${user.name} (${user.email}).`
      });
    } catch (e) {}

    return { ok: true, message: 'Usuário removido com sucesso.' };
  }

  /**
   * Autentica usuário por login/e-mail e senha
   */
  authenticate(loginOrEmail, password) {
    if (!password) return null;
    this.ensureDefaultAdmin();
    const data = this.db.get();
    const cleanLogin = String(loginOrEmail || '').trim().toLowerCase();
    const rawPass = String(password).trim();

    // 1. Busca por login/e-mail específico se informado
    if (cleanLogin) {
      const user = (data.users || []).find(u =>
        !u.isDeleted &&
        (u.email.toLowerCase() === cleanLogin || u.id.toLowerCase() === cleanLogin || (cleanLogin === 'admin' && u.role === UserRole.ADMIN))
      );

      if (user) {
        if (verifyPasswordHash(rawPass, user.passwordHash) || verifyAndMigratePassword(rawPass, user.passwordHash)) {
          return new User(user);
        }
      }
    }

    // 2. Se apenas senha foi informada (ou falhou busca por login), tenta validar contra senha mestre do admin
    const storedAdminPass = data.settings?.adminPassword || process.env.ADMIN_PASSWORD;
    if (verifyAndMigratePassword(rawPass, storedAdminPass)) {
      return this.getDefaultAdmin();
    }

    // 3. Tenta validar contra o primeiro admin ativo cadastrado
    const defaultAdmin = (data.users || []).find(u => !u.isDeleted && u.active && u.role === UserRole.ADMIN);
    if (defaultAdmin && defaultAdmin.passwordHash) {
      if (verifyPasswordHash(rawPass, defaultAdmin.passwordHash)) {
        return new User(defaultAdmin);
      }
    }

    return null;
  }
}

export const userService = new UserService();
