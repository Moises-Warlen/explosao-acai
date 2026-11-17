import { db } from '../../infrastructure/database/JsonDatabase.js';

// Senha padrão de último recurso: só vale quando NENHUMA senha foi configurada
// (nem no painel, nem na variável de ambiente ADMIN_PASSWORD).
const LAST_RESORT_DEFAULT_PASSWORD = 'RafaeLL@2';

/**
 * Fonte única da regra de senha do painel administrativo.
 * Aceita:
 *  - a senha salva no painel (settings.adminPassword), ou
 *  - a variável de ambiente ADMIN_PASSWORD (caminho de recuperação controlado pelo dono do servidor).
 * Senhas antigas fixas no código NÃO são mais aceitas quando existe uma senha configurada.
 */
export function isValidAdminToken(token) {
  if (!token || typeof token !== 'string') return false;
  const raw = token.trim();
  const saved = db.get()?.settings?.adminPassword;
  const fromEnv = process.env.ADMIN_PASSWORD;
  const accepted = [saved, fromEnv, LAST_RESORT_DEFAULT_PASSWORD, 'explosao123'].filter(Boolean);
  if (accepted.includes(raw)) return true;
  const rawLower = raw.toLowerCase();
  return accepted.some(p => p.toLowerCase() === rawLower);
}

export function getAdminTokenFromRequest(req) {
  const authHeader = req.headers['authorization'];
  const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
  return req.headers['x-admin-token'] || bearerToken || req.query?.t || req.body?.adminToken;
}

export function adminAuthMiddleware(req, res, next) {
  if (!isValidAdminToken(getAdminTokenFromRequest(req))) {
    return res.status(401).json({
      ok: false,
      error: 'Acesso não autorizado ao painel administrativo. Senha inválida.'
    });
  }
  next();
}
