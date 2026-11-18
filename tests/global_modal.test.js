import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Componente Global de Modal (Alert, Confirm, Prompt)', () => {
  const modalFilePath = path.join(__dirname, '../public/js/global-modal.js');

  test('1. Arquivo global-modal.js existe e possui implementação válida', () => {
    assert.ok(fs.existsSync(modalFilePath), 'O arquivo public/js/global-modal.js deve existir');
    const content = fs.readFileSync(modalFilePath, 'utf-8');
    assert.ok(content.length > 500, 'O arquivo deve conter a implementação do modal');
  });

  test('2. Exportação das funções globais no objeto window', () => {
    const content = fs.readFileSync(modalFilePath, 'utf-8');

    // Cria um ambiente simulado de DOM simples
    const fakeDocument = {
      readyState: 'complete',
      head: {
        appendChild: () => {}
      },
      body: {
        appendChild: () => {}
      },
      getElementById: () => null,
      createElement: () => {
        return {
          id: '',
          className: '',
          style: {},
          setAttribute: () => {},
          appendChild: () => {},
          addEventListener: () => {},
          querySelector: () => ({
            textContent: '',
            innerHTML: '',
            style: {},
            className: '',
            value: '',
            classList: { add: () => {}, remove: () => {}, contains: () => false },
            addEventListener: () => {},
            focus: () => {},
            select: () => {}
          }),
          classList: { add: () => {}, remove: () => {}, contains: () => false }
        };
      },
      addEventListener: () => {}
    };

    const fakeWindow = {
      document: fakeDocument
    };

    const context = vm.createContext({
      window: fakeWindow,
      document: fakeDocument,
      setTimeout: (fn) => fn(),
      clearTimeout: () => {}
    });

    vm.runInContext(content, context);

    assert.strictEqual(typeof fakeWindow.customPrompt, 'function', 'window.customPrompt deve ser uma função');
    assert.strictEqual(typeof fakeWindow.customConfirm, 'function', 'window.customConfirm deve ser uma função');
    assert.strictEqual(typeof fakeWindow.customAlert, 'function', 'window.customAlert deve ser uma função');
    assert.strictEqual(typeof fakeWindow.showConfirmModal, 'function', 'window.showConfirmModal deve ser compatível');
  });

  test('3. Tag de inclusão do script em public/admin.html e public/index.html', () => {
    const adminHtml = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf-8');
    const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf-8');

    assert.ok(adminHtml.includes('global-modal.js'), 'admin.html deve carregar global-modal.js');
    assert.ok(indexHtml.includes('global-modal.js'), 'index.html deve carregar global-modal.js');
  });

  test('4. Substituição no admin.js das chamadas nativas de prompt de rota', () => {
    const adminJs = fs.readFileSync(path.join(__dirname, '../public/js/admin.js'), 'utf-8');

    assert.ok(adminJs.includes('window.customPrompt'), 'admin.js deve chamar window.customPrompt para rotas');
    assert.ok(adminJs.includes('openSendRouteToMotoboyModal'), 'admin.js deve conter openSendRouteToMotoboyModal');
  });
});
