/* =========================================================================
   MÓDULO DE UPLOAD DE FOTOS DO COMPUTADOR (MULTER)
   - Permite que o lojista escolha fotos reais do computador para produtos e adicionais
   - A foto fica em memória, é otimizada (WebP) e então gravada:
       1) no PostgreSQL (persistente, sobrevive a deploys)  -> ver ImageStore.js
       2) na pasta "public/imagens/uploads" (cache em disco / modo local sem banco)
   - Gera um nome único para cada arquivo evitando sobreposições
   ========================================================================= */

import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Pasta de destino (cache em disco) onde as imagens enviadas também são salvas
export const uploadDir = path.resolve(__dirname, '../../../public/imagens/uploads');

/** Gera nome único: timestamp-nomeoriginal.webp */
export function buildUploadName(originalName, ext = '.webp') {
  const base = path.basename(String(originalName || 'foto'), path.extname(String(originalName || '')))
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'foto';
  return `${Date.now()}-${base}${ext}`;
}

/** Grava a cópia em disco (best-effort: em hospedagem somente-leitura não deve derrubar o upload). */
export function writeUploadToDisk(fileName, buffer) {
  try {
    fs.mkdirSync(uploadDir, { recursive: true });
    fs.writeFileSync(path.join(uploadDir, fileName), buffer);
    return true;
  } catch (e) {
    return false;
  }
}

// Filtro de segurança: aceita apenas imagens válidas
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|webp|gif/;
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
  const mime = file.mimetype.toLowerCase();

  if (allowedTypes.test(ext) && mime.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Apenas arquivos de imagem (JPG, PNG, WEBP) são permitidos.'));
  }
};

export const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // Limite máximo de 10 MB por foto
});
