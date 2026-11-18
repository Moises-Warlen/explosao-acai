/**
 * Controlador de Apresentação: UserController
 * Expõe as rotas REST para a gestão de usuários e permissões do painel.
 */

import { userService } from '../../application/services/UserService.js';

export class UserController {
  constructor() {
    this.userService = userService;
  }

  async list(req, res) {
    try {
      const users = this.userService.listUsers();
      return res.json({ ok: true, users });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  async getById(req, res) {
    try {
      const user = this.userService.getUserById(req.params.id);
      if (!user) {
        return res.status(404).json({ ok: false, error: 'Usuário não encontrado.' });
      }
      return res.json({ ok: true, user });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  async create(req, res) {
    try {
      const { name, email, password, role, permissions, active } = req.body || {};
      const newUser = this.userService.createUser({ name, email, password, role, permissions, active });
      return res.status(201).json({ ok: true, user: newUser });
    } catch (e) {
      return res.status(400).json({ ok: false, error: e.message });
    }
  }

  async update(req, res) {
    try {
      const currentUserId = req.user?.userId;
      const { name, email, password, role, permissions, active } = req.body || {};
      const updated = this.userService.updateUser(req.params.id, { name, email, password, role, permissions, active }, currentUserId);
      return res.json({ ok: true, user: updated });
    } catch (e) {
      return res.status(400).json({ ok: false, error: e.message });
    }
  }

  async toggleStatus(req, res) {
    try {
      const currentUserId = req.user?.userId;
      const updated = this.userService.toggleUserStatus(req.params.id, currentUserId);
      return res.json({ ok: true, user: updated });
    } catch (e) {
      return res.status(400).json({ ok: false, error: e.message });
    }
  }

  async delete(req, res) {
    try {
      const currentUserId = req.user?.userId;
      const result = this.userService.deleteUser(req.params.id, currentUserId);
      return res.json(result);
    } catch (e) {
      return res.status(400).json({ ok: false, error: e.message });
    }
  }

  async me(req, res) {
    try {
      if (!req.user) {
        return res.status(401).json({ ok: false, error: 'Sessão não autenticada.' });
      }
      const user = this.userService.getUserById(req.user.userId) || {
        id: req.user.userId,
        name: req.user.name || 'Administrador',
        email: req.user.email || 'admin@explosaoacai.com.br',
        role: req.user.role || 'admin',
        permissions: req.user.permissions || ['*'],
        active: true
      };
      return res.json({ ok: true, user });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
}

export const userController = new UserController();
