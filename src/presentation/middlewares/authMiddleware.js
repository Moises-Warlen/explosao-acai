export function adminAuthMiddleware(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.t || req.body?.adminToken;
  const adminPass = process.env.ADMIN_PASSWORD || 'explosao123';

  if (!token || token !== adminPass) {
    return res.status(401).json({
      ok: false,
      error: 'Acesso não autorizado ao painel administrativo. Senha inválida.'
    });
  }

  next();
}
