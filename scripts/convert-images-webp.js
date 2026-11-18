import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const imgDir = path.resolve(__dirname, '../public/imagens');

async function convertImages() {
  const files = fs.readdirSync(imgDir);
  console.log(`Iniciando conversão de imagens em: ${imgDir}`);

  const converted = [];

  for (const file of files) {
    if (file.toLowerCase().endsWith('.png')) {
      const inputPath = path.join(imgDir, file);
      const stat = fs.statSync(inputPath);
      if (!stat.isFile()) continue;

      const baseName = path.basename(file, path.extname(file));
      const outputPath = path.join(imgDir, `${baseName}.webp`);

      console.log(`Convertendo: ${file} (${(stat.size / 1024 / 1024).toFixed(2)} MB)...`);

      await sharp(inputPath)
        .resize({ width: 800, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(outputPath);

      const newStat = fs.statSync(outputPath);
      console.log(`  -> Gerado ${baseName}.webp: ${(newStat.size / 1024).toFixed(1)} KB (redução de ${((1 - newStat.size / stat.size) * 100).toFixed(1)}%)`);

      converted.push({ original: file, webp: `${baseName}.webp`, oldSize: stat.size, newSize: newStat.size });

      // Remove a versão pesada em PNG (já está no backup)
      fs.unlinkSync(inputPath);
    }
  }

  console.log(`\nConversão concluída! ${converted.length} imagens convertidas para WebP.`);

  // Atualiza referências em arquivos do projeto
  const targets = [
    path.resolve(__dirname, '../data/database.json'),
    path.resolve(__dirname, '../data/official_catalog.json'),
    path.resolve(__dirname, '../data/database.example.json'),
    path.resolve(__dirname, '../public/index.html'),
    path.resolve(__dirname, '../public/admin.html'),
    path.resolve(__dirname, '../public/motoboy.html'),
    path.resolve(__dirname, '../public/js/app.js'),
    path.resolve(__dirname, '../public/js/admin.js'),
    path.resolve(__dirname, '../src/infrastructure/database/JsonDatabase.js')
  ];

  for (const target of targets) {
    if (!fs.existsSync(target)) continue;
    let content = fs.readFileSync(target, 'utf-8');
    let replacedCount = 0;

    for (const item of converted) {
      // Substitui referências com regex global
      const regex = new RegExp(item.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      if (regex.test(content)) {
        content = content.replace(regex, item.webp);
        replacedCount++;
      }
    }

    if (replacedCount > 0) {
      fs.writeFileSync(target, content, 'utf-8');
      console.log(`Atualizadas referências em: ${path.basename(target)} (${replacedCount} imagens referenciadas)`);
    }
  }
}

convertImages().catch(err => {
  console.error('Erro na conversão:', err);
  process.exit(1);
});
