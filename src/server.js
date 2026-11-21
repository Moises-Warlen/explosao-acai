import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

import apiRoutes from './presentation/routes/apiRoutes.js';
import { wsHub } from './infrastructure/websockets/WebSocketHub.js';
import { securityAuditService, SecurityEventType, SecuritySeverity } from './infrastructure/security/SecurityAuditService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// 1. Cabeçalhos de Segurança HTTP (Helmet com CSP defensiva)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        "https://unpkg.com",
        "https://sdk.mercadopago.com",
        "https://*.mercadopago.com",
        "https://cdn.jsdelivr.net"
      ],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://unpkg.com",
        "https://fonts.googleapis.com"
      ],
      fontSrc: [
        "'self'",
        "https://fonts.gstatic.com",
        "data:"
      ],
      imgSrc: [
        "'self'",
        "data:",
        "blob:",
        "https:",
        "http:",
        "https://*.tile.openstreetmap.org",
        "https://*.tile.openstreetmap.fr",
        "https://*.basemaps.cartocdn.com",
        "https://unpkg.com"
      ],
      connectSrc: [
        "'self'",
        "ws:",
        "wss:",
        "http://localhost:*",
        "http://127.0.0.1:*",
        "https://cardapioexplosaoacai.com.br",
        "https://*.mercadopago.com",
        "https://photon.komoot.io",
        "https://router.project-osrm.org",
        "https://viacep.com.br",
        "https://*.tile.openstreetmap.fr",
        "https://*.basemaps.cartocdn.com"
      ],
      frameSrc: [
        "'self'",
        "https://*.mercadopago.com"
      ]
    }
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

// 2. Política Restrita de CORS (cardapioexplosaoacai.com.br + localhost)
const allowedOrigins = [
  'https://cardapioexplosaoacai.com.br',
  'http://cardapioexplosaoacai.com.br',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];

app.use(cors({
  origin: (origin, callback) => {
    // Permite requisições sem origin (mobile apps, webhooks de pagamento, chamadas internas)
    if (!origin || allowedOrigins.includes(origin) || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
      callback(null, true);
    } else {
      callback(new Error('Origem bloqueada pela política de CORS da Explosão Açaí.'));
    }
  },
  credentials: true
}));

// 3. Rate Limiters (Proteção contra Brute Force, Flood e DoS)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 25, // máx 25 tentativas incorretas por IP com liberação imediata ao acertar
  skipSuccessfulRequests: true,
  message: { ok: false, error: 'Muitas tentativas de login incorretas. Tente novamente em alguns minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    try {
      securityAuditService.recordEvent({
        type: SecurityEventType.RATE_LIMIT_EXCEEDED,
        severity: SecuritySeverity.CRITICAL,
        ip: securityAuditService.extractClientIp(req),
        endpoint: req.originalUrl || req.url,
        method: req.method,
        details: 'Força Bruta Bloqueada: Mais de 5 tentativas incorretas de login em 15 minutos.',
        userAgent: req.headers['user-agent']
      });
    } catch (e) {}
    res.status(429).json({ ok: false, error: 'Muitas tentativas de login incorretas. Tente novamente em 15 minutos.' });
  }
});

const ordersLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: process.env.NODE_ENV === 'test' ? 1000 : 30, // flexibilidade para ambiente de testes automatizados
  message: { ok: false, error: 'Limite de pedidos por minuto atingido. Aguarde um instante.' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    try {
      securityAuditService.recordEvent({
        type: SecurityEventType.RATE_LIMIT_EXCEEDED,
        severity: SecuritySeverity.HIGH,
        ip: securityAuditService.extractClientIp(req),
        endpoint: req.originalUrl || req.url,
        method: req.method,
        details: 'Possível Flood/Script de Pedidos: Limite de 10 pedidos por minuto excedido.',
        userAgent: req.headers['user-agent']
      });
    } catch (e) {}
    res.status(429).json({ ok: false, error: 'Limite de pedidos por minuto atingido. Aguarde um instante.' });
  }
});

const generalApiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 120, // máx 120 requisições por minuto por IP
  message: { ok: false, error: 'Muitas requisições ao servidor. Reduza o ritmo.' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    try {
      securityAuditService.recordEvent({
        type: SecurityEventType.RATE_LIMIT_EXCEEDED,
        severity: SecuritySeverity.MEDIUM,
        ip: securityAuditService.extractClientIp(req),
        endpoint: req.originalUrl || req.url,
        method: req.method,
        details: 'Muitas requisições por minuto ao servidor (possível varredura automatizada).',
        userAgent: req.headers['user-agent']
      });
    } catch (e) {}
    res.status(429).json({ ok: false, error: 'Muitas requisições ao servidor. Reduza o ritmo.' });
  }
});

// Parsers de requisição
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Aplicação seletiva dos Rate Limiters
app.use('/api/admin/auth', authLimiter);
app.use('/api/orders', (req, res, next) => {
  if (req.method === 'POST') {
    return ordersLimiter(req, res, next);
  }
  next();
});
app.use('/api', generalApiLimiter);

// Arquivos estáticos (Frontend Cardápio + Painel Admin + Portal do Entregador)
const publicDir = path.resolve(__dirname, '../public');
// Cache-Control: o painel precisa sempre receber a versão mais recente dos arquivos (evita JS antigo preso no navegador/CDN)
app.use(express.static(publicDir, {
  extensions: ['html'],
  etag: true,
  setHeaders: (res, filePath) => {
    if (/\.(html|js|css)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  }
}));

// Respostas da API nunca devem ser armazenadas em cache (pedidos em tempo real)
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// Rotas da API
app.use('/api', apiRoutes);

// Páginas servidas por rota direta também sem cache
app.use(['/admin', '/motoboy', '/m'], (req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  next();
});

// Rotas diretas e amigáveis para SPA e entregador
app.get('/admin', (req, res) => {
  res.sendFile(path.join(publicDir, 'admin.html'));
});

app.get(['/motoboy', '/m'], (req, res) => {
  res.sendFile(path.join(publicDir, 'motoboy.html'));
});

app.use((req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Inicialização do WebSocket Hub
wsHub.initialize(server);

const PORT = process.env.PORT || 3000;
const isRunningTests = process.env.NODE_ENV === 'test' || process.env.npm_lifecycle_event === 'test' || process.argv.some(a => a.toLowerCase().includes('test'));

if (!isRunningTests) {
  server.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`  🚀 EXPLOSÃO AÇAÍ - SERVIDOR DE DELIVERY ONLINE`);
    console.log(`  📱 Cardápio do Cliente: http://localhost:${PORT}`);
    console.log(`  ⚙️ Painel Administrativo: http://localhost:${PORT}/admin`);
    console.log(`  ⚡ WebSockets: ws://localhost:${PORT}/ws`);
    console.log(`=======================================================`);
  });
}

export { app, server };
