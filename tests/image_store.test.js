import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { ImageStore, processImage, IMAGE_NAME_REGEX } from '../src/infrastructure/storage/ImageStore.js';
import { buildUploadName } from '../src/infrastructure/storage/UploadService.js';

function fakePool() {
  const rows = new Map();
  const queries = [];
  return {
    queries,
    async query(sql, params = []) {
      queries.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
      if (/^INSERT INTO explosao_images/i.test(sql.trim())) {
        rows.set(params[0], { mime: params[1], data: params[2] });
        return { rows: [] };
      }
      if (/^SELECT mime, data FROM explosao_images/i.test(sql.trim())) {
        const r = rows.get(params[0]);
        return { rows: r ? [r] : [] };
      }
      return { rows: [] };
    }
  };
}

test('processImage converte JPG grande em WebP limitado a 1200px', async () => {
  const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#7b2cbf' } }).jpeg().toBuffer();
  const out = await processImage(big);
  const meta = await sharp(out.buffer).metadata();
  assert.equal(out.mime, 'image/webp');
  assert.equal(meta.format, 'webp');
  assert.equal(Math.max(meta.width, meta.height), 1200);
});

test('processImage rejeita arquivo que nao e imagem', async () => {
  await assert.rejects(() => processImage(Buffer.from('<html>nao sou imagem</html>')));
});

test('buildUploadName gera nome seguro .webp aceito pela rota', () => {
  const name = buildUploadName('Kid Choco (nova)!!.JPG');
  assert.match(name, /^\d+-kid-choco-nova\.webp$/);
  assert.ok(IMAGE_NAME_REGEX.test(name));
});

test('ImageStore salva e le a foto no banco (persistente)', async () => {
  const pool = fakePool();
  const store = new ImageStore(async () => ({ pool, isConnected: true }));
  const data = Buffer.from([1, 2, 3, 4]);
  assert.equal(await store.save('1-foto.webp', 'image/webp', data), true);
  const got = await store.get('1-foto.webp');
  assert.equal(got.mime, 'image/webp');
  assert.deepEqual(got.data, data);
  assert.equal(await store.get('inexistente.webp'), null);
  assert.ok(pool.queries.some(q => q.startsWith('CREATE TABLE')));
});

test('ImageStore sem banco conectado nao persiste e nao quebra', async () => {
  const store = new ImageStore(async () => ({ pool: null, isConnected: false }));
  assert.equal(await store.save('1-foto.webp', 'image/webp', Buffer.from([1])), false);
  assert.equal(await store.get('1-foto.webp'), null);
});

test('ImageStore bloqueia nomes com path traversal', async () => {
  const store = new ImageStore(async () => ({ pool: fakePool(), isConnected: true }));
  assert.equal(await store.get('../../data/database.json'), null);
  await assert.rejects(() => store.save('../x.webp', 'image/webp', Buffer.from([1])));
});
