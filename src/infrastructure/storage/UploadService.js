/* =========================================================================
   MÓDULO DE UPLOAD DE FOTOS DO COMPUTADOR (MULTER)
   - Permite que o lojista escolha fotos reais do computador para produtos e adicionais
   - Salva automaticamente na pasta "public/imagens/uploads"
   - Gera um nome único para cada arquivo evitando sobreposições
   ========================================================================= */

import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Pasta de destino onde as imagens enviadas do computador serão salvas
const uploadDir = path.resolve(__dirname, '../../../public/imagens/uploads');

// Configuração do disco de armazenamento
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Sanitiza e gera nome único: timestamp-nomeoriginal.ext
    const ext = path.extname(file.originalname).toLowerCase();
    const cleanName = path.basename(file.originalname, ext)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-');
    const uniqueName = `${Date.now()}-${cleanName}${ext}`;
    cb(null, uniqueName);
  }
});

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
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // Limite máximo de 10 MB por foto
});
