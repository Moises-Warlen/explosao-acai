import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

import apiRoutes from './presentation/routes/apiRoutes.js';
import { wsHub } from './infrastructure/websockets/WebSocketHub.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// Middlewares globais
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
