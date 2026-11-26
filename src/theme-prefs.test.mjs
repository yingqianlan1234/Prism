import test from 'node:test';
import assert from 'node:assert/strict';
import {
  THEME_PREFS_STORAGE_KEY,
  THEME_PRESETS,
  AMBIENT_LEVELS,
  DEFAULT_THEME_PREFS,
  normalizeThemePrefs,
  getAmbientMultiplier,
  loadThemePrefs,
  saveThemePrefs,
  applyThemePrefsToDocument,
} from './theme-prefs.js';

function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, val) => map.set(key, String(val)),
  };
}

test('默认值与预设清单完整', () => {
  assert.deepEqual(DEFAULT_THEME_PREFS, { theme: 'obsidian', ambient: 'standard' });
  assert.deepEqual(
    THEME_PRESETS.map(item => item.id),
    ['obsidian', 'warm', 'night-radio', 'crystal']
  );
  assert.deepEqual(
    AMBIENT_LEVELS.map(item => item.id),
    ['off', 'soft', 'standard', 'rich']
  );
  assert.equal(getAmbientMultiplier('off'), 0);
  assert.equal(getAmbientMultiplier('rich'), 1.35);
  assert.equal(getAmbientMultiplier('unknown'), 1);
});

test('normalizeThemePrefs 对非法输入安全回退', () => {
  assert.deepEqual(normalizeThemePrefs(null), DEFAULT_THEME_PREFS);
  assert.deepEqual(normalizeThemePrefs({ theme: 'invalid', ambient: 'ultra' }), DEFAULT_THEME_PREFS);
  assert.deepEqual(normalizeThemePrefs({ theme: 'warm', ambient: 'bad' }), {
    theme: 'warm',
    ambient: 'standard',
  });
  assert.deepEqual(normalizeThemePrefs({ theme: 'crystal', ambient: 'soft' }), {
    theme: 'crystal',
    ambient: 'soft',
  });
});

test('loadThemePrefs / saveThemePrefs 持久化与损坏 JSON 容错', () => {
  const storage = createMemoryStorage();
  assert.deepEqual(loadThemePrefs(storage), DEFAULT_THEME_PREFS);

  const saved = saveThemePrefs({ theme: 'warm', ambient: 'rich' }, storage);
  assert.deepEqual(saved, { theme: 'warm', ambient: 'rich' });
  assert.deepEqual(loadThemePrefs(storage), { theme: 'warm', ambient: 'rich' });

  const broken = createMemoryStorage({ [THEME_PREFS_STORAGE_KEY]: '{broken-json' });
  assert.deepEqual(loadThemePrefs(broken), DEFAULT_THEME_PREFS);
});

test('applyThemePrefsToDocument 写入 dataset 与 --nr-ambient-mul', () => {
  const styleProps = new Map();
  const fakeDoc = {
    documentElement: {
      dataset: {},
      style: {
        setProperty: (k, v) => styleProps.set(k, v),
      },
    },
  };

  const applied = applyThemePrefsToDocument({ theme: 'crystal', ambient: 'off' }, fakeDoc);
  assert.deepEqual(applied, { theme: 'crystal', ambient: 'off' });
  assert.equal(fakeDoc.documentElement.dataset.theme, 'crystal');
  assert.equal(fakeDoc.documentElement.dataset.ambient, 'off');
  assert.equal(styleProps.get('--nr-ambient-mul'), '0');

  assert.deepEqual(applyThemePrefsToDocument({ theme: 'night-radio', ambient: 'soft' }, null), {
    theme: 'night-radio',
    ambient: 'soft',
  });
});
