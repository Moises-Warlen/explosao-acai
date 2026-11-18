import { db } from '../database/JsonDatabase.js';

export const SecurityEventType = {
  AUTH_FAILURE: 'AUTH_FAILURE',
  UNAUTHORIZED_401: 'UNAUTHORIZED_401',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  SUSPICIOUS_PAYLOAD: 'SUSPICIOUS_PAYLOAD',
  MOTOBOY_INVALID_PIN: 'MOTOBOY_INVALID_PIN',
  PROFANITY_OFFENSE: 'PROFANITY_OFFENSE',
  ORDER_TAMPERING_ATTEMPT: 'ORDER_TAMPERING_ATTEMPT',
  SYSTEM_WARNING: 'SYSTEM_WARNING'
};

export const SecuritySeverity = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
};

class SecurityAuditService {
  constructor() {
    this.maxLogs = 200;
  }

  /**
   * Extrai o IP real do cliente mesmo através de proxies reversos
   */
  extractClientIp(req) {
    if (!req) return '127.0.0.1';
    const forwarded = req.headers ? (req.headers['x-forwarded-for'] || req.headers['x-real-ip']) : null;
    if (forwarded) {
      const parts = String(forwarded).split(',');
      return parts[0].trim();
    }
    return req.socket?.remoteAddress || req.ip || '127.0.0.1';
  }

  /**
   * Registra um evento de segurança/auditoria estruturado
   */
  recordEvent({
    type = SecurityEventType.SYSTEM_WARNING,
    severity = SecuritySeverity.LOW,
    ip = '127.0.0.1',
    endpoint = '',
    method = 'GET',
    details = '',
    userAgent = ''
  }) {
    try {
      const data = db.get();
      if (!Array.isArray(data.securityLogs)) {
        data.securityLogs = [];
      }

      const logEntry = {
        id: `sec_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        timestamp: new Date().toISOString(),
        type,
        severity,
        ip: String(ip || '127.0.0.1'),
        endpoint: String(endpoint || ''),
        method: String(method || 'GET'),
        details: String(details || '').slice(0, 500),
        userAgent: String(userAgent || '').slice(0, 200)
      };

      data.securityLogs.unshift(logEntry);

      if (data.securityLogs.length > this.maxLogs) {
        data.securityLogs = data.securityLogs.slice(0, this.maxLogs);
      }

      db.save();
      return logEntry;
    } catch (err) {
      console.error('[SecurityAudit] Falha ao registrar log de segurança:', err.message);
      return null;
    }
  }

  /**
   * Retorna os logs filtrados
   */
  getLogs({ limit = 50, severity = 'all', type = 'all' } = {}) {
    const data = db.get();
    let logs = Array.isArray(data.securityLogs) ? [...data.securityLogs] : [];

    if (severity && severity !== 'all') {
      logs = logs.filter(l => l.severity === severity);
    }
    if (type && type !== 'all') {
      logs = logs.filter(l => l.type === type);
    }

    const total = logs.length;
    const items = logs.slice(0, Math.min(Number(limit) || 50, 200));

    return {
      total,
      limit: Number(limit) || 50,
      logs: items,
      summary: this.getSummary()
    };
  }

  /**
   * Gera resumo executivo para o painel de segurança
   */
  getSummary() {
    const data = db.get();
    const logs = Array.isArray(data.securityLogs) ? data.securityLogs : [];
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    const summary = {
      total: logs.length,
      last24h: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      topTypes: {}
    };

    logs.forEach(l => {
      const ts = new Date(l.timestamp).getTime();
      if (ts >= oneDayAgo) summary.last24h++;
      if (l.severity === SecuritySeverity.CRITICAL) summary.critical++;
      else if (l.severity === SecuritySeverity.HIGH) summary.high++;
      else if (l.severity === SecuritySeverity.MEDIUM) summary.medium++;
      else summary.low++;

      summary.topTypes[l.type] = (summary.topTypes[l.type] || 0) + 1;
    });

    return summary;
  }

  /**
   * Limpa os logs de segurança
   */
  clearLogs() {
    const data = db.get();
    data.securityLogs = [];
    db.save();
    return true;
  }
}

export const securityAuditService = new SecurityAuditService();
