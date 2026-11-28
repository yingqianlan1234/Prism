import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

test('ErrorBoundary 捕获渲染异常并提供关闭/重载与原地恢复能力', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'vesper-error-boundary-'));
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  for (const name of ['HTMLElement', 'Event', 'Node']) {
    globalThis[name] = dom.window[name];
  }

  const origConsoleError = console.error;
  console.error = () => {};

  try {
    const entrySrc = join(temp, 'entry.jsx');
    const targetPath = resolve('src/components/ErrorBoundary.jsx').replace(/\\/g, '/');
    await writeFile(
      entrySrc,
      `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { ErrorBoundary } from '${targetPath}';
      export { React, createRoot, ErrorBoundary };
      `,
      'utf8'
    );

    const built = await build({
      configFile: false,
      logLevel: 'error',
      plugins: [react()],
      resolve: {
        alias: {
          react: resolve('node_modules/react'),
          'react-dom/client': resolve('node_modules/react-dom/client.js'),
          '@tauri-apps/api/core': resolve('node_modules/@tauri-apps/api/core.js'),
          '@tauri-apps/api/window': resolve('node_modules/@tauri-apps/api/window.js'),
        },
      },
      build: {
        outDir: temp,
        emptyOutDir: false,
        lib: {
          entry: entrySrc,
          formats: ['es'],
          fileName: () => 'bundle.mjs',
        },
      },
    });
    const entryFile = built[0]?.fileName || 'bundle.mjs';
    const { React, createRoot, ErrorBoundary } = await import(pathToFileURL(join(temp, entryFile)));

    let shouldThrow = true;
    let reloaded = false;
    function Bomb() {
      if (shouldThrow) throw new Error('模拟渲染崩溃\u0007');
      return React.createElement('div', { id: 'recovered-ok' }, '恢复成功');
    }

    const root = createRoot(document.getElementById('root'));
    root.render(
      React.createElement(
        ErrorBoundary,
        {
          onReload: () => {
            reloaded = true;
          },
        },
        React.createElement(Bomb)
      )
    );

    await new Promise(r => setTimeout(r, 30));
    assert(document.body.textContent.includes('界面遇到意外中断'));
    assert(document.body.textContent.includes('模拟渲染崩溃'));
    assert(document.querySelector('[aria-label="最小化窗口"]'));
    assert(document.querySelector('[aria-label="关闭窗口"]'));

    const buttons = [...document.querySelectorAll('button')];
    const reloadBtn = buttons.find(b => b.textContent.trim() === '重新加载');
    const recoverBtn = buttons.find(b => b.textContent.trim() === '尝试原地恢复');
    assert(reloadBtn && recoverBtn);

    reloadBtn.click();
    assert.equal(reloaded, true);

    shouldThrow = false;
    recoverBtn.click();
    await new Promise(r => setTimeout(r, 30));
    assert.equal(document.getElementById('recovered-ok')?.textContent, '恢复成功');
    root.unmount();
  } finally {
    console.error = origConsoleError;
    dom.window.close();
    if (resolve(temp).startsWith(resolve(tmpdir(), 'vesper-error-boundary-'))) {
      await rm(temp, { recursive: true, force: true });
    }
  }
});
