/* =========================================================================
   ARMAZENAMENTO PERSISTENTE DE FOTOS (PostgreSQL)
   - Hospedagens como Render/Railway apagam o disco a cada deploy; por isso as
     fotos enviadas pelo painel admin também são guardadas no banco de dados
     (tabela explosao_images, coluna BYTEA) e servidas de lá quando o arquivo
     não existir no disco.
   - Sem PostgreSQL conectado (ex.: desenvolvimento local), cai no disco apenas.
   ========================================================================= */

import sharp from 'sharp';

export const MAX_IMAGE_SIDE = 1200; // px (maior lado) - suficiente para cardápio/panfleto
export const IMAGE_NAME_REGEX = /^[A-Za-z0-9._-]{1,150}$/;

/**
 * Converte qualquer foto (jpg/png/webp/gif) em WebP otimizado, respeitando a rotação do celular.
 */
export async function processImage(buffer) {
  const out = await sharp(buffer)
    .rotate()
    .resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  return { buffer: out, mime: 'image/webp', ext: '.webp' };
}

export class ImageStore {
  /**
   * @param {() => Promise<{pool: any, isConnected: boolean}>} getDb - devolve o pool do PostgreSQL (ou pool null)
   */
  constructor(getDb) {
    this.getDb = getDb;
    this.tableReady = false;
  }

  async _pool() {
    const { pool, isConnected } = await this.getDb();
    if (!pool || !isConnected) return null;
    if (!this.tableReady) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS explosao_images (
          name VARCHAR(160) PRIMARY KEY,
          mime VARCHAR(60) NOT NULL,
          data BYTEA NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      this.tableReady = true;
    }
    return pool;
  }

  /** Salva a foto no banco. Retorna true se ficou persistida, false se não há banco conectado. */
  async save(name, mime, buffer) {
    if (!IMAGE_NAME_REGEX.test(name)) throw new Error('Nome de arquivo inválido.');
    const pool = await this._pool();
    if (!pool) return false;
    await pool.query(
      `INSERT INTO explosao_images (name, mime, data) VALUES ($1, $2, $3)
       ON CONFLICT (name) DO UPDATE SET mime = $2, data = $3`,
      [name, mime, buffer]
    );
    return true;
  }

  /** Busca a foto no banco. Retorna { mime, data } ou null. */
  async get(name) {
    if (!IMAGE_NAME_REGEX.test(name)) return null;
    const pool = await this._pool();
    if (!pool) return null;
    const res = await pool.query('SELECT mime, data FROM explosao_images WHERE name = $1', [name]);
    return res.rows[0] || null;
  }
}

// Instância padrão: usa o mesmo pool do banco principal (carregado sob demanda)
export const imageStore = new ImageStore(async () => {
  const { db } = await import('../database/JsonDatabase.js');
  return db;
});
