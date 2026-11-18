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
        "https://viacep.com.br"
      ],
      frameSrc: [
        "'self'",
        "https://*.mercadopago.com"
      ]
    }
  },
  crossOriginEmbedderPolicy: false
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
  max: 5, // máx 5 tentativas incorretas por IP
  skipSuccessfulRequests: true,
  message: { ok: false, error: 'Muitas tentativas de login incorretas. Tente novamente em 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false
});

const ordersLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 10, // máx 10 pedidos por minuto por IP
  message: { ok: false, error: 'Limite de pedidos por minuto atingido. Aguarde um instante.' },
  standardHeaders: true,
  legacyHeaders: false
});

const generalApiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 120, // máx 120 requisições por minuto por IP
  message: { ok: false, error: 'Muitas requisições ao servidor. Reduza o ritmo.' },
  standardHeaders: true,
  legacyHeaders: false
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
app.use(express.static(publicDir, { extensions: ['html'] }));

// Rotas da API
app.use('/api', apiRoutes);

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
const isRunningTests = process.env.npm_lifecycle_event === 'test' || process.argv.includes('--test') || process.env.NODE_ENV === 'test';

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
