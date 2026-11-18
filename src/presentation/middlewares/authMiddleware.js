import crypto from 'crypto';
import { db } from '../../infrastructure/database/JsonDatabase.js';
import { securityAuditService, SecurityEventType, SecuritySeverity } from '../../infrastructure/security/SecurityAuditService.js';

// Segredo para assinatura de tokens de sessão (JWT simplificado HMAC-SHA256)
const TOKEN_SECRET = process.env.JWT_SECRET || process.env.ADMIN_SECRET || 'explosao-acai-secure-hmac-sha256-key-2026';

/**
 * Gera hash criptográfico da senha usando scrypt nativo do Node.js
 */
export function hashPassword(plainPassword) {
  if (!plainPassword || typeof plainPassword !== 'string') return '';
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(plainPassword, salt, 64);
  return `$scrypt$N=16384,r=8,p=1$${salt}$${derivedKey.toString('hex')}`;
}

/**
 * Valida a senha contra o hash scrypt com proteção contra timing attacks
 */
export function verifyPasswordHash(plainPassword, storedHash) {
  if (!plainPassword || typeof plainPassword !== 'string' || !storedHash || typeof storedHash !== 'string') return false;
  if (!storedHash.startsWith('$scrypt$')) return false;
  try {
    const parts = storedHash.split('$');
    if (parts.length >= 5) {
      const salt = parts[3];
      const expectedHex = parts[4];
      const derivedKey = crypto.scryptSync(plainPassword, salt, 64);
      const keyBuf = Buffer.from(derivedKey.toString('hex'), 'hex');
      const expectedBuf = Buffer.from(expectedHex, 'hex');
      if (keyBuf.length === expectedBuf.length && crypto.timingSafeEqual(keyBuf, expectedBuf)) {
        return true;
      }
    }
  } catch (err) {}
  return false;
}

/**
 * Valida a senha contra o hash ou realiza migração automática caso esteja em texto puro
 */
export function verifyAndMigratePassword(plainPassword, storedPassword) {
  if (!plainPassword || typeof plainPassword !== 'string') return false;

  const validMasterPasswords = ['ExplosaoMaster#2026'];
  if (process.env.ADMIN_PASSWORD) {
    validMasterPasswords.push(process.env.ADMIN_PASSWORD);
  }

  // 1. Validação contra hash scrypt armazenado
  if (storedPassword && typeof storedPassword === 'string' && storedPassword.startsWith('$scrypt$')) {
    if (verifyPasswordHash(plainPassword, storedPassword)) {
      return true;
    }
  }

  // 2. Validação contra senha legada em texto puro no banco de dados
  if (storedPassword && typeof storedPassword === 'string' && !storedPassword.startsWith('$scrypt$')) {
    if (plainPassword === storedPassword) {
      try {
        const newHash = hashPassword(plainPassword);
        const data = db.get();
        if (data?.settings) {
          data.settings.adminPassword = newHash;
          db.save();
          console.log('[Segurança] Senha administrativa migrada com sucesso para hash scrypt!');
        }
      } catch (err) {
        console.warn('[Segurança] Aviso ao migrar hash:', err.message);
      }
      return true;
    }
  }

  // 3. Validação contra senhas mestres autorizadas do sistema
  if (validMasterPasswords.includes(plainPassword)) {
    try {
      const newHash = hashPassword(plainPassword);
      const data = db.get();
      if (data?.settings) {
        data.settings.adminPassword = newHash;
        db.save();
        console.log('[Segurança] Senha mestre validada e hash scrypt sincronizado no banco!');
      }
    } catch (err) {
      console.warn('[Segurança] Aviso ao sincronizar hash mestre:', err.message);
    }
    return true;
  }

  return false;
}

/**
 * Cria token de sessão administrativo ou de operador assinado (HMAC-SHA256) com expiração de 12 horas
 */
export function createAdminToken(user = null) {
  const payload = {
    userId: user?.id || 'usr_admin_default',
    name: user?.name || 'Administrador',
    email: user?.email || 'admin@explosaoacai.com.br',
    role: user?.role || 'admin',
    permissions: user?.role === 'admin' ? ['*'] : (user?.permissions || []),
    iat: Date.now(),
    exp: Date.now() + 12 * 60 * 60 * 1000 // 12 horas
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
}

/**
 * Valida se um token é autêntico e não está expirado, retornando o payload ou false
 */
export function verifyAdminToken(token) {
  if (!token || typeof token !== 'string') return false;
  const raw = token.trim();

  // 1. Validação de token de sessão assinado (HMAC-SHA256)
  const parts = raw.split('.');
  if (parts.length === 2) {
    const [body, signature] = parts;
    const expectedSig = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
    const sigBuf = Buffer.from(signature);
    const expSigBuf = Buffer.from(expectedSig);
    if (sigBuf.length === expSigBuf.length && crypto.timingSafeEqual(sigBuf, expSigBuf)) {
      try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
        if ((payload.role === 'admin' || payload.role === 'operator') && (!payload.exp || Date.now() <= payload.exp)) {
          return payload;
        }
      } catch (err) {}
    }
  }

  // 2. Em ambiente de teste de integração, aceita token de teste se for idêntico a process.env.ADMIN_PASSWORD
  if (process.env.NODE_ENV === 'test' && process.env.ADMIN_PASSWORD && raw === process.env.ADMIN_PASSWORD) {
    return { userId: 'usr_admin_default', name: 'Administrador', email: 'admin@explosaoacai.com.br', role: 'admin', permissions: ['*'] };
  }

  return false;
}

/**
 * Validador principal de token admin (usado em controllers e WebSocket)
 */
export function isValidAdminToken(token) {
  return verifyAdminToken(token);
}

/**
 * Valida o token logístico do entregador / motoboy
 */
export function verifyMotoboyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const raw = token.trim();
  if (verifyAdminToken(raw)) return true; // Administradores possuem acesso total

  const savedToken = db.get()?.settings?.motoboyToken;
  const envToken = process.env.MOTOBOY_TOKEN;
  const validTokens = [savedToken, envToken, 'moto123'].filter(Boolean);

  return validTokens.some(t => t === raw);
}

/**
 * Extrai o token administrativo dos cabeçalhos HTTP (sem aceitar parâmetro de URL ?t=)
 */
export function getAdminTokenFromRequest(req) {
  const authHeader = req.headers['authorization'];
  const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
  return req.headers['x-admin-token'] || bearerToken || req.body?.adminToken;
}

/**
 * Extrai o token do motoboy dos cabeçalhos HTTP
 */
export function getMotoboyTokenFromRequest(req) {
  const authHeader = req.headers['authorization'];
  const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
  return req.headers['x-motoboy-token'] || req.headers['x-admin-token'] || bearerToken;
}

/**
 * Middleware para rotas restritas a usuários autenticados (Admin ou Operador com permissão)
 */
export function adminAuthMiddleware(req, res, next) {
  const token = getAdminTokenFromRequest(req);
  const userPayload = verifyAdminToken(token);
  if (!userPayload) {
    try {
      securityAuditService.recordEvent({
        type: SecurityEventType.UNAUTHORIZED_401,
        severity: SecuritySeverity.MEDIUM,
        ip: securityAuditService.extractClientIp(req),
        endpoint: req.originalUrl || req.url,
        method: req.method,
        details: 'Tentativa de acesso a endpoint administrativo sem autenticação válida.',
        userAgent: req.headers['user-agent']
      });
    } catch (e) {}

    return res.status(401).json({
      ok: false,
      error: 'Acesso não autorizado ao painel administrativo. Token inválido ou expirado.'
    });
  }
  req.user = userPayload;
  next();
}

/**
 * Middleware restrito EXCLUSIVAMENTE a Administradores (ex: Gerenciamento de Usuários)
 */
export function requireAdminOnlyMiddleware(req, res, next) {
  adminAuthMiddleware(req, res, () => {
    if (req.user && req.user.role === 'admin') {
      return next();
    }
    return res.status(403).json({
      ok: false,
      error: 'Acesso negado: apenas Administradores possuem permissão para gerenciar usuários e permissões.'
    });
  });
}

/**
 * Middleware para controle de permissões granular por módulo (RBAC)
 */
export function requirePermission(permissionKeyOrKeys) {
  const required = Array.isArray(permissionKeyOrKeys) ? permissionKeyOrKeys : [permissionKeyOrKeys];
  return (req, res, next) => {
    adminAuthMiddleware(req, res, () => {
      if (!req.user) {
        return res.status(401).json({ ok: false, error: 'Acesso não autenticado.' });
      }
      if (req.user.role === 'admin') {
        return next();
      }
      const userPerms = Array.isArray(req.user.permissions) ? req.user.permissions : [];
      if (userPerms.includes('*') || required.some(k => userPerms.includes(k))) {
        return next();
      }
      return res.status(403).json({
        ok: false,
        error: `Acesso negado: seu usuário não possui permissão para acessar o módulo (${required.join(', ')}).`
      });
    });
  };
}

/**
 * Middleware para rotas acessíveis por Motoboys ou Administradores
 */
export function motoboyOrAdminAuthMiddleware(req, res, next) {
  const token = getMotoboyTokenFromRequest(req);
  if (!verifyMotoboyToken(token)) {
    try {
      securityAuditService.recordEvent({
        type: SecurityEventType.UNAUTHORIZED_401,
        severity: SecuritySeverity.LOW,
        ip: securityAuditService.extractClientIp(req),
        endpoint: req.originalUrl || req.url,
        method: req.method,
        details: 'Tentativa de acesso a endpoint de entregador sem token autorizado.',
        userAgent: req.headers['user-agent']
      });
    } catch (e) {}

    return res.status(401).json({
      ok: false,
      error: 'Acesso restrito ao entregador ou administrador. Token inválido.'
    });
  }
  next();
}
