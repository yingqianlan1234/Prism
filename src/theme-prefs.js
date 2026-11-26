export const THEME_PREFS_STORAGE_KEY = 'vesper.themePrefs.v1';

export const THEME_PRESETS = Object.freeze([
  {
    id: 'obsidian',
    name: '深空黑曜',
    tagline: '深邃黑曜基底与贴底光学极光，默认推荐',
    tone: 'dark',
    swatches: ['#080A0F', '#121620', '#F2A65A', '#4B9BFF'],
  },
  {
    id: 'warm',
    name: '暖炭玄岩',
    tagline: '低蓝光暖褐炭黑，深夜戴耳机更护眼',
    tone: 'dark',
    swatches: ['#100F0E', '#1B1917', '#F0A25E', '#D97757'],
  },
  {
    id: 'night-radio',
    name: '深夜雨窗',
    tagline: '经典深海夜空蓝调，保留原版电台氛围',
    tone: 'dark',
    swatches: ['#0D1522', '#17263D', '#F2A65A', '#5698E2'],
  },
  {
    id: 'crystal',
    name: '白昼冷晶',
    tagline: '清透冷调高对比浅色，明亮桌面环境友好',
    tone: 'light',
    swatches: ['#EEF3FA', '#FFFFFF', '#C2591A', '#3B82F6'],
  },
]);

export const AMBIENT_LEVELS = Object.freeze([
  { id: 'off', label: '关闭', multiplier: 0 },
  { id: 'soft', label: '柔和', multiplier: 0.55 },
  { id: 'standard', label: '标准', multiplier: 1 },
  { id: 'rich', label: '浓郁', multiplier: 1.35 },
]);

export const DEFAULT_THEME_PREFS = Object.freeze({
  theme: 'obsidian',
  ambient: 'standard',
});

const VALID_THEME_IDS = new Set(THEME_PRESETS.map(item => item.id));
const AMBIENT_MULTIPLIER_MAP = new Map(AMBIENT_LEVELS.map(item => [item.id, item.multiplier]));

export function normalizeThemePrefs(input) {
  const theme = typeof input?.theme === 'string' && VALID_THEME_IDS.has(input.theme)
    ? input.theme
    : DEFAULT_THEME_PREFS.theme;
  const ambient = typeof input?.ambient === 'string' && AMBIENT_MULTIPLIER_MAP.has(input.ambient)
    ? input.ambient
    : DEFAULT_THEME_PREFS.ambient;
  return { theme, ambient };
}

export function getAmbientMultiplier(ambientId) {
  return AMBIENT_MULTIPLIER_MAP.has(ambientId)
    ? AMBIENT_MULTIPLIER_MAP.get(ambientId)
    : AMBIENT_MULTIPLIER_MAP.get(DEFAULT_THEME_PREFS.ambient);
}

export function loadThemePrefs(storage = globalThis?.localStorage) {
  try {
    const raw = storage?.getItem?.(THEME_PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_THEME_PREFS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_THEME_PREFS };
    return normalizeThemePrefs(parsed);
  } catch {
    return { ...DEFAULT_THEME_PREFS };
  }
}

export function saveThemePrefs(prefs, storage = globalThis?.localStorage) {
  const normalized = normalizeThemePrefs(prefs);
  try {
    storage?.setItem?.(THEME_PREFS_STORAGE_KEY, JSON.stringify(normalized));
  } catch {}
  return normalized;
}

export function applyThemePrefsToDocument(prefs, doc = globalThis?.document) {
  const normalized = normalizeThemePrefs(prefs);
  const root = doc?.documentElement;
  if (!root) return normalized;
  if (root.dataset) {
    root.dataset.theme = normalized.theme;
    root.dataset.ambient = normalized.ambient;
  } else {
    root.setAttribute?.('data-theme', normalized.theme);
    root.setAttribute?.('data-ambient', normalized.ambient);
  }
  root.style?.setProperty?.('--nr-ambient-mul', String(getAmbientMultiplier(normalized.ambient)));
  return normalized;
}
