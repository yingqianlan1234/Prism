import React, { memo, useEffect, useRef, useState } from 'react';
import {
  NETEASE_QUALITIES,
  QUALITY_LABELS,
  SHORTCUT_MODIFIERS,
  SHORTCUT_KEY_GROUPS,
  SHORTCUT_ACTIONS,
  DEFAULT_SHORTCUT_BINDINGS,
  parseShortcutBinding,
  formatShortcutBinding,
  findDuplicateShortcutActions,
  hasTextSelectionShortcutWarning,
} from '../utils/format.js';
import {
  formatBytes,
  isSwitchableSourceError,
  parseReleaseNotes,
  validateMirrorPrefix,
} from '../updater.js';
import { AMBIENT_LEVELS, THEME_PRESETS } from '../theme-prefs.js';
import { Icon } from './Icons.jsx';

const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2];
const SLEEP_OPTIONS = [
  { id: 'off', label: '关' },
  { id: '15', label: '15 分' },
  { id: '30', label: '30 分' },
  { id: '60', label: '60 分' },
  { id: 'track', label: '播完本首' },
];
const LYRIC_LAYOUTS = [
  { id: 'dual', label: '双行预告' },
  { id: 'single', label: '单行' },
];
const LYRIC_ALIGNS = [
  { id: 'center', label: '居中' },
  { id: 'left', label: '靠左' },
];
const LYRIC_THEMES = [
  { id: 'night', label: '深夜琥珀', dot: '#F2A65A' },
  { id: 'contrast', label: '高对比', dot: '#FFFFFF' },
  { id: 'warm', label: '暖金', dot: '#F5B762' },
  { id: 'accent', label: '随封面色', dot: 'var(--nr-glow, #73B3E6)' },
];
const LYRIC_FONT_SIZES = [
  { size: 22, label: '小' },
  { size: 28, label: '中' },
  { size: 34, label: '大' },
  { size: 40, label: '特大' },
];

export const SettingsPage = memo(function SettingsPage({
  activeSection,
  onSelectSection,
  onBackToLibrary,
  // 外观与主题
  themePrefs,
  onChangeTheme,
  onChangeAmbient,
  // 常规与窗口
  closeMode,
  closeBusy,
  trayAvailable,
  closeError,
  onChooseCloseMode,
  canAutostart,
  autostartEnabled,
  autostartBusy,
  autostartError,
  onToggleAutostart,
  // 本机跨源歌单备份
  customPlaylistCount,
  customTrackCount,
  onExportCustomPlaylists,
  onImportCustomPlaylists,
  customImportStatus,
  // 播放与听感
  playbackRate,
  onChangeRate,
  sleepMode,
  onSelectSleep,
  canSelectQuality,
  neteaseQuality,
  onChangeQuality,
  song,
  trackQuality,
  onReloadWithQuality,
  audioPrefs,
  onToggleSmoothFadeIn,
  onToggleAutoOpenStage,
  audioOutputSupported,
  audioOutputDevices,
  audioOutputError,
  onSelectOutputDevice,
  onRefreshOutputDevices,
  // 桌面歌词
  canDesktopLyric,
  desktopLyric,
  desktopLyricBusy,
  desktopLyricError,
  onToggleDesktopLyric,
  onToggleDesktopLyricLock,
  onUpdateDesktopLyricStyle,
  // 全局快捷键
  canGlobalShortcuts,
  globalShortcuts,
  shortcutsBusy,
  shortcutsError,
  onToggleShortcutsEnabled,
  onSaveShortcutBindings,
  // 应用更新
  canAppUpdater,
  updateConfig,
  updateState,
  updateSummary,
  updaterBusy,
  onCheckUpdate,
  onDownloadUpdate,
  onInstallUpdate,
  onSkipUpdateVersion,
  onChangeUpdateSource,
  onSaveMirror,
  onToggleAutoCheck,
  onSwitchSourceAndRetry,
}) {
  const sections = [
    { id: 'general', label: '常规与数据', icon: 'collection' },
    { id: 'appearance', label: '外观与主题', icon: 'palette' },
    { id: 'playback', label: '播放与听感', icon: 'sliders' },
    ...(canDesktopLyric ? [{ id: 'lyric', label: '桌面歌词', icon: 'desktopLyric' }] : []),
    ...(canGlobalShortcuts ? [{ id: 'shortcuts', label: '全局快捷键', icon: 'keyboard' }] : []),
    ...(canAppUpdater ? [{ id: 'updater', label: '更新与关于', icon: 'update' }] : []),
  ];
  const currentSection = sections.some(s => s.id === activeSection) ? activeSection : 'general';

  // 桌面歌词透明度节流草稿
  const lyricStyle = desktopLyric?.style || {};
  const panelOpacity = Number.isFinite(Number(lyricStyle.panelOpacity))
    ? Number(lyricStyle.panelOpacity)
    : 82;
  const [opacityDraft, setOpacityDraft] = useState(panelOpacity);
  const opacityTimerRef = useRef(null);
  const pendingOpacityRef = useRef(null);

  useEffect(() => {
    setOpacityDraft(panelOpacity);
  }, [panelOpacity]);

  useEffect(
    () => () => {
      if (opacityTimerRef.current) clearTimeout(opacityTimerRef.current);
    },
    []
  );

  const flushOpacity = value => {
    if (opacityTimerRef.current) {
      clearTimeout(opacityTimerRef.current);
      opacityTimerRef.current = null;
    }
    const target = value ?? pendingOpacityRef.current;
    pendingOpacityRef.current = null;
    if (target == null) return;
    const clamped = Math.min(100, Math.max(40, Math.round(Number(target))));
    if (clamped !== panelOpacity) {
      onUpdateDesktopLyricStyle?.({ panelOpacity: clamped });
    }
  };

  const scheduleOpacity = value => {
    pendingOpacityRef.current = value;
    if (opacityTimerRef.current) clearTimeout(opacityTimerRef.current);
    opacityTimerRef.current = setTimeout(() => flushOpacity(), 80);
  };

  // 全局快捷键草稿
  const activeBindings = { ...DEFAULT_SHORTCUT_BINDINGS, ...(globalShortcuts?.bindings || {}) };
  const [draftBindings, setDraftBindings] = useState(activeBindings);
  useEffect(() => {
    setDraftBindings({ ...DEFAULT_SHORTCUT_BINDINGS, ...(globalShortcuts?.bindings || {}) });
  }, [globalShortcuts?.bindings]);
  const duplicateActions = findDuplicateShortcutActions(draftBindings);
  const textSelectionWarning = hasTextSelectionShortcutWarning(draftBindings);
  const shortcutsDirty = SHORTCUT_ACTIONS.some(a => draftBindings[a.id] !== activeBindings[a.id]);
  const shortcutsIsDefault = SHORTCUT_ACTIONS.every(a => draftBindings[a.id] === a.defaultKey);

  const updateKeyPart = (actionId, part, value) => {
    setDraftBindings(prev => {
      const parsed = parseShortcutBinding(prev[actionId]);
      const nextModifier = part === 'modifier' ? value : parsed.modifier;
      const nextKey = part === 'key' ? value : parsed.key;
      return { ...prev, [actionId]: formatShortcutBinding(nextModifier, nextKey) };
    });
  };

  // 自定义镜像草稿
  const [mirrorDraft, setMirrorDraft] = useState(updateConfig?.customMirror || '');
  const [mirrorError, setMirrorError] = useState('');
  useEffect(() => {
    setMirrorDraft(updateConfig?.customMirror || '');
    setMirrorError('');
  }, [updateConfig?.customMirror]);

  const fileInputRef = useRef(null);

  const handleMirrorSubmit = async e => {
    e.preventDefault();
    const check = validateMirrorPrefix(mirrorDraft);
    if (!check.valid) {
      setMirrorError(check.error);
      return;
    }
    setMirrorError('');
    await onSaveMirror?.(check.normalized);
  };

  const canReloadQuality =
    canSelectQuality &&
    song?.provider === 'netease' &&
    trackQuality?.level &&
    trackQuality.level !== neteaseQuality;

  // 应用更新状态衍生
  const updPhase = updateState?.phase || 'idle';
  const updInfo = updateState?.info || null;
  const updProgress = updateState?.progress || null;
  const updSource = updateConfig?.source === 'mirror' ? 'mirror' : 'github';
  const updAltSource = updSource === 'github' ? 'mirror' : 'github';
  const updAltLabel = updAltSource === 'mirror' ? '国内加速镜像' : 'GitHub 直连';
  const updPercent = Number.isFinite(updProgress?.percent)
    ? Math.max(0, Math.min(100, Math.round(updProgress.percent)))
    : 0;
  const updNoteLines =
    (updPhase === 'available' || updPhase === 'downloading' || updPhase === 'ready') && updInfo?.notes
      ? parseReleaseNotes(updInfo.notes)
      : [];

  return (
    <main className="nr-settings-page" aria-label="独立设置页">
      <div className="nr-settings-shell">
        <aside className="nr-settings-aside">
          <div className="nr-settings-aside-head">
            <span className="nr-side-kicker">偏好设置</span>
            <h1>Vesper 设置</h1>
          </div>
          <nav className="nr-settings-nav" aria-label="设置分组">
            {sections.map(sec => (
              <button
                key={sec.id}
                type="button"
                className={'nr-settings-tab' + (currentSection === sec.id ? ' is-active' : '')}
                aria-current={currentSection === sec.id ? 'page' : undefined}
                onClick={() => onSelectSection(sec.id)}
              >
                <Icon name={sec.icon} className="nr-icon is-sm" />
                <span>{sec.label}</span>
                {sec.id === 'updater' && updateSummary?.hint && (
                  <span className="nr-update-pill is-accent">
                    {updateState?.info?.version ? `v${updateState.info.version}` : updateSummary.badgeText}
                  </span>
                )}
              </button>
            ))}
          </nav>
          <button type="button" className="nr-soft-btn nr-settings-back" onClick={onBackToLibrary}>
            返回音乐库
          </button>
        </aside>

        <section className="nr-settings-body">
          {currentSection === 'general' && (
            <div className="nr-settings-panel" role="region" aria-label="常规与数据设置">
              <header className="nr-settings-head">
                <h2>常规与数据</h2>
                <p>
                  {onChooseCloseMode || canAutostart
                    ? '管理主窗口关闭与启动行为，以及应用内跨源本机歌单的 JSON 备份。'
                    : '管理应用内跨源本机歌单的 JSON 备份。'}
                </p>
              </header>

              <div className="nr-settings-grid">
                {onChooseCloseMode && (
                  <div className="nr-settings-card">
                    <div className="nr-settings-card-head">
                      <div>
                        <h3>关闭主窗口时</h3>
                        <p>决定点击右上角关闭按钮后的默认行为，可随时修改。</p>
                      </div>
                    </div>
                    <div className="nr-seg-pills" role="group" aria-label="关闭主窗口行为">
                      <button
                        type="button"
                        className={'nr-seg-btn' + (closeMode === 'background' ? ' is-on' : '')}
                        aria-pressed={closeMode === 'background'}
                        disabled={closeBusy || !trayAvailable}
                        onClick={() => onChooseCloseMode('background')}
                      >
                        后台运行（最小化到托盘）
                      </button>
                      <button
                        type="button"
                        className={'nr-seg-btn' + (closeMode === 'exit' ? ' is-on' : '')}
                        aria-pressed={closeMode === 'exit'}
                        disabled={closeBusy}
                        onClick={() => onChooseCloseMode('exit')}
                      >
                        完全退出并停止播放
                      </button>
                    </div>
                    {!trayAvailable && (
                      <p className="nr-settings-note">当前系统托盘不可用，暂不支持转入后台运行。</p>
                    )}
                    {closeError && (
                      <p className="nr-dialog-error" role="alert">
                        {closeError}
                      </p>
                    )}
                  </div>
                )}

                {canAutostart && (
                  <div className="nr-settings-card">
                    <div className="nr-settings-card-head">
                      <div>
                        <h3>开机自动启动</h3>
                        <p>默认关闭；开启后随当前 Windows 用户登录自动启动 Vesper。</p>
                      </div>
                    </div>
                    <div className="nr-seg-pills" role="group" aria-label="开机自动启动">
                      <button
                        type="button"
                        className={'nr-seg-btn' + (!autostartEnabled ? ' is-on' : '')}
                        aria-pressed={!autostartEnabled}
                        disabled={autostartBusy}
                        onClick={() => onToggleAutostart?.(false)}
                      >
                        关闭（默认）
                      </button>
                      <button
                        type="button"
                        className={'nr-seg-btn' + (autostartEnabled ? ' is-on' : '')}
                        aria-pressed={autostartEnabled}
                        disabled={autostartBusy}
                        onClick={() => onToggleAutostart?.(true)}
                      >
                        开机自启
                      </button>
                    </div>
                    {autostartError && (
                      <p className="nr-dialog-error" role="alert">
                        {autostartError}
                      </p>
                    )}
                  </div>
                )}

                <div className="nr-settings-card">
                  <div className="nr-settings-card-head">
                    <div>
                      <h3>本机跨源歌单备份</h3>
                      <p>
                        当前已在本机保存 <b>{customPlaylistCount}</b> 个跨源歌单、共{' '}
                        <b>{customTrackCount}</b> 首曲目，不回写任何第三方接口。
                      </p>
                    </div>
                  </div>
                  <div className="nr-settings-actions-row">
                    <button
                      type="button"
                      className="nr-soft-btn"
                      disabled={customPlaylistCount === 0}
                      onClick={onExportCustomPlaylists}
                    >
                      <Icon name="download" className="nr-icon is-sm" />
                      导出 JSON 备份
                    </button>
                    <button
                      type="button"
                      className="nr-soft-btn"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Icon name="upload" className="nr-icon is-sm" />
                      导入 JSON 恢复
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json,application/json"
                      className="sr-only"
                      aria-label="选择本机歌单备份文件"
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) onImportCustomPlaylists?.(file);
                        e.target.value = '';
                      }}
                    />
                  </div>
                  {customImportStatus && (
                    <p className="nr-settings-note" role="status">
                      {customImportStatus}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {currentSection === 'appearance' && (
            <div className="nr-settings-panel" role="region" aria-label="外观与主题设置">
              <header className="nr-settings-head">
                <h2>外观与主题</h2>
                <p>四套光学配色方案与地平线环境光氛围，即时生效并自动记住。</p>
              </header>

              <div className="nr-settings-card">
                <div className="nr-settings-card-head">
                  <div>
                    <h3>界面主题预设</h3>
                    <p>灵感源自黑曜棱镜的深浅基底与镜面切面层次，贴合音乐收听节奏。</p>
                  </div>
                </div>
                <div className="nr-theme-card-grid" role="radiogroup" aria-label="界面主题选择">
                  {THEME_PRESETS.map(preset => {
                    const selected = (themePrefs?.theme || 'obsidian') === preset.id;
                    const [canvas, surface, accent, horizon] = preset.swatches;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        data-theme-option={preset.id}
                        data-tone={preset.tone}
                        className={'nr-theme-card' + (selected ? ' is-selected' : '')}
                        onClick={() => onChangeTheme?.(preset.id)}
                      >
                        <div
                          className="nr-theme-preview"
                          aria-hidden="true"
                          style={{
                            '--pv-canvas': canvas,
                            '--pv-surface': surface,
                            '--pv-accent': accent,
                            '--pv-horizon': horizon,
                            color: preset.tone === 'light' ? '#0F172A' : '#F2F4F8',
                          }}
                        >
                          <span className="nr-theme-preview-glow" />
                          <div className="nr-theme-preview-side">
                            <span className="is-pill" />
                            <span />
                            <span />
                          </div>
                          <div className="nr-theme-preview-main">
                            <div className="nr-theme-preview-bar" />
                            <div className="nr-theme-preview-dock">
                              <i />
                              <b />
                            </div>
                          </div>
                        </div>
                        <div className="nr-theme-card-meta">
                          <div className="nr-theme-card-title">
                            <strong>{preset.name}</strong>
                            {selected && <span className="nr-theme-active-badge">当前使用</span>}
                          </div>
                          <small>{preset.tagline}</small>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="nr-settings-card">
                <div className="nr-settings-card-head">
                  <div>
                    <h3>环境光与地平线极光</h3>
                    <p>待机时舒缓呼吸，播放时随封面色调轻柔律动；关闭环境光或最小化到托盘时自动静默零消耗。</p>
                  </div>
                </div>
                <div className="nr-seg-pills" role="group" aria-label="环境光强度">
                  {AMBIENT_LEVELS.map(level => {
                    const active = (themePrefs?.ambient || 'standard') === level.id;
                    return (
                      <button
                        key={level.id}
                        type="button"
                        className={'nr-seg-btn' + (active ? ' is-on' : '')}
                        aria-pressed={active}
                        onClick={() => onChangeAmbient?.(level.id)}
                      >
                        {level.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {currentSection === 'playback' && (
            <div className="nr-settings-panel" role="region" aria-label="播放与听感设置">
              <header className="nr-settings-head">
                <h2>播放与听感</h2>
                <p>配置音频淡入、输出设备、默认音质、播放倍速与睡眠定时。</p>
              </header>

              <div className="nr-settings-grid">
                <div className="nr-settings-card">
                  <div className="nr-shortcut-master">
                    <div className="nr-shortcut-master-copy">
                      <strong>起播 / 恢复播放柔和淡入（140ms）</strong>
                      <small>切歌或恢复播放时轻柔拉起音量，深夜戴耳机收听更护耳。</small>
                    </div>
                    <button
                      type="button"
                      className={'nr-shortcut-toggle' + (audioPrefs?.smoothFadeIn ? ' is-on' : '')}
                      aria-pressed={Boolean(audioPrefs?.smoothFadeIn)}
                      onClick={() => onToggleSmoothFadeIn?.(!audioPrefs?.smoothFadeIn)}
                    >
                      {audioPrefs?.smoothFadeIn ? '已开启' : '已关闭'}
                    </button>
                  </div>

                  <div className="nr-shortcut-master">
                    <div className="nr-shortcut-master-copy">
                      <strong>点播歌曲时自动进入歌词舞台</strong>
                      <small>在曲库点播歌曲成功后自动切入正在播放与歌词舞台；后台连播与快捷切歌时不打断浏览。</small>
                    </div>
                    <button
                      type="button"
                      data-setting-toggle="auto-open-stage"
                      className={
                        'nr-shortcut-toggle' + (audioPrefs?.autoOpenStageOnPlay !== false ? ' is-on' : '')
                      }
                      aria-pressed={audioPrefs?.autoOpenStageOnPlay !== false}
                      onClick={() => onToggleAutoOpenStage?.(audioPrefs?.autoOpenStageOnPlay === false)}
                    >
                      {audioPrefs?.autoOpenStageOnPlay !== false ? '已开启' : '已关闭'}
                    </button>
                  </div>

                  <div className="nr-settings-field">
                    <div className="nr-more-label-row">
                      <label className="nr-more-label" htmlFor="nr-output-device-select">
                        音频输出设备
                      </label>
                      <button
                        type="button"
                        className="nr-more-reload"
                        onClick={onRefreshOutputDevices}
                      >
                        刷新设备列表
                      </button>
                    </div>
                    {audioOutputSupported ? (
                      <select
                        id="nr-output-device-select"
                        className="nr-shortcut-select nr-settings-select"
                        value={audioPrefs?.outputDeviceId || ''}
                        onChange={e => onSelectOutputDevice?.(e.target.value)}
                      >
                        <option value="">跟随系统默认输出</option>
                        {audioOutputDevices
                          .filter(d => d.deviceId && d.deviceId !== 'default')
                          .map(d => (
                            <option key={d.deviceId} value={d.deviceId}>
                              {d.label}
                            </option>
                          ))}
                      </select>
                    ) : (
                      <p className="nr-settings-note">当前系统环境由操作系统统一托管输出设备。</p>
                    )}
                    {audioOutputError && (
                      <p className="nr-dialog-error" role="alert">
                        {audioOutputError}
                      </p>
                    )}
                  </div>
                </div>

                <div className="nr-settings-card">
                  {canSelectQuality && (
                    <div className="nr-settings-field">
                      <div className="nr-more-label-row">
                        <span className="nr-more-label">网易云默认音质</span>
                        {song?.provider === 'netease' && trackQuality?.level && (
                          <span className="nr-more-sub">
                            当前播放：{QUALITY_LABELS[trackQuality.level] || trackQuality.level}
                          </span>
                        )}
                      </div>
                      <div className="nr-seg-pills" role="group" aria-label="设置页网易云音质">
                        {NETEASE_QUALITIES.map(q => (
                          <button
                            key={q.id}
                            type="button"
                            className={'nr-seg-btn' + (neteaseQuality === q.id ? ' is-on' : '')}
                            aria-pressed={neteaseQuality === q.id}
                            onClick={() => onChangeQuality(q.id)}
                          >
                            {q.label}
                          </button>
                        ))}
                      </div>
                      {canReloadQuality && (
                        <button type="button" className="nr-more-reload" onClick={onReloadWithQuality}>
                          按当前音质重载本首
                        </button>
                      )}
                    </div>
                  )}

                  <div className="nr-settings-field">
                    <span className="nr-more-label">播放倍速</span>
                    <div className="nr-seg-pills" role="group" aria-label="设置页播放倍速">
                      {PLAYBACK_RATES.map(r => (
                        <button
                          key={r}
                          type="button"
                          className={'nr-seg-btn' + (playbackRate === r ? ' is-on' : '')}
                          aria-pressed={playbackRate === r}
                          onClick={() => onChangeRate(r)}
                        >
                          {r}×
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="nr-settings-field">
                    <span className="nr-more-label">睡眠定时</span>
                    <div className="nr-seg-pills" role="group" aria-label="设置页睡眠定时">
                      {SLEEP_OPTIONS.map(opt => (
                        <button
                          key={opt.id}
                          type="button"
                          className={'nr-seg-btn' + (sleepMode === opt.id ? ' is-on' : '')}
                          aria-pressed={sleepMode === opt.id}
                          onClick={() => onSelectSleep(opt.id)}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {currentSection === 'lyric' && canDesktopLyric && (
            <div className="nr-settings-panel" role="region" aria-label="桌面歌词设置">
              <header className="nr-settings-head">
                <h2>桌面歌词</h2>
                <p>原生 Direct2D 桌面悬浮字幕，离手无痕，悬停呈现 9 项播控条。</p>
              </header>

              <div className="nr-settings-card">
                <div className="nr-more-desktop-row" role="group" aria-label="桌面歌词主控制">
                  <button
                    type="button"
                    className={'nr-seg-btn' + (desktopLyric?.enabled ? ' is-on' : '')}
                    aria-pressed={Boolean(desktopLyric?.enabled)}
                    disabled={desktopLyricBusy}
                    onClick={onToggleDesktopLyric}
                  >
                    桌面歌词：{desktopLyric?.enabled ? '已开启' : '未开启'}
                  </button>
                  <button
                    type="button"
                    className={'nr-seg-btn' + (desktopLyric?.locked ? ' is-on' : '')}
                    aria-pressed={Boolean(desktopLyric?.locked)}
                    disabled={desktopLyricBusy}
                    onClick={onToggleDesktopLyricLock}
                  >
                    穿透锁定：{desktopLyric?.locked ? '已锁定' : '未锁定'}
                  </button>
                </div>

                <div className="nr-settings-field">
                  <span className="nr-more-label">字幕模式与伴随字幕</span>
                  <div className="nr-dlyric-split">
                    <div className="nr-seg-pills">
                      {LYRIC_LAYOUTS.map(item => (
                        <button
                          key={item.id}
                          type="button"
                          className={'nr-seg-btn' + ((lyricStyle.layout || 'dual') === item.id ? ' is-on' : '')}
                          aria-pressed={(lyricStyle.layout || 'dual') === item.id}
                          onClick={() => onUpdateDesktopLyricStyle?.({ layout: item.id })}
                        >
                          {item.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        className={'nr-seg-btn' + (lyricStyle.karaoke !== false ? ' is-on' : '')}
                        aria-pressed={lyricStyle.karaoke !== false}
                        onClick={() => onUpdateDesktopLyricStyle?.({ karaoke: lyricStyle.karaoke === false })}
                      >
                        暖光推进
                      </button>
                    </div>
                    <div className="nr-seg-pills">
                      <button
                        type="button"
                        className={'nr-seg-btn' + (lyricStyle.showTranslation !== false ? ' is-on' : '')}
                        aria-pressed={lyricStyle.showTranslation !== false}
                        onClick={() =>
                          onUpdateDesktopLyricStyle?.({ showTranslation: lyricStyle.showTranslation === false })
                        }
                      >
                        译文
                      </button>
                      <button
                        type="button"
                        className={'nr-seg-btn' + (lyricStyle.showRomaji ? ' is-on' : '')}
                        aria-pressed={Boolean(lyricStyle.showRomaji)}
                        onClick={() => onUpdateDesktopLyricStyle?.({ showRomaji: !lyricStyle.showRomaji })}
                      >
                        音译
                      </button>
                    </div>
                  </div>
                </div>

                <div className="nr-settings-field">
                  <span className="nr-more-label">配色主题</span>
                  <div className="nr-theme-grid">
                    {LYRIC_THEMES.map(item => (
                      <button
                        key={item.id}
                        type="button"
                        className={'nr-seg-btn nr-theme-pill' + ((lyricStyle.theme || 'night') === item.id ? ' is-on' : '')}
                        aria-pressed={(lyricStyle.theme || 'night') === item.id}
                        onClick={() => onUpdateDesktopLyricStyle?.({ theme: item.id })}
                      >
                        <span
                          className="nr-theme-dot"
                          style={{ backgroundColor: item.dot }}
                          aria-hidden="true"
                        />
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="nr-settings-field">
                  <div className="nr-more-label-row">
                    <span className="nr-more-label">字号与对齐</span>
                    <span className="nr-more-sub">{Number(lyricStyle.fontSize) || 28}px</span>
                  </div>
                  <div className="nr-dlyric-split">
                    <div className="nr-seg-pills">
                      {LYRIC_FONT_SIZES.map(item => (
                        <button
                          key={item.size}
                          type="button"
                          className={'nr-seg-btn' + ((Number(lyricStyle.fontSize) || 28) === item.size ? ' is-on' : '')}
                          aria-pressed={(Number(lyricStyle.fontSize) || 28) === item.size}
                          onClick={() => onUpdateDesktopLyricStyle?.({ fontSize: item.size })}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                    <div className="nr-seg-pills">
                      {LYRIC_ALIGNS.map(item => (
                        <button
                          key={item.id}
                          type="button"
                          className={'nr-seg-btn' + ((lyricStyle.align || 'center') === item.id ? ' is-on' : '')}
                          aria-pressed={(lyricStyle.align || 'center') === item.id}
                          onClick={() => onUpdateDesktopLyricStyle?.({ align: item.id })}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="nr-settings-field">
                  <div className="nr-more-label-row">
                    <label className="nr-more-label" htmlFor="nr-settings-dlyric-opacity">
                      悬停底板透明度
                    </label>
                    <span className="nr-more-sub">{opacityDraft}%</span>
                  </div>
                  <input
                    id="nr-settings-dlyric-opacity"
                    className="nr-dlyric-range"
                    type="range"
                    min={40}
                    max={100}
                    step={2}
                    value={opacityDraft}
                    onChange={e => {
                      const nextVal = Number(e.target.value);
                      setOpacityDraft(nextVal);
                      scheduleOpacity(nextVal);
                    }}
                    onPointerUp={e => flushOpacity(Number(e.currentTarget.value))}
                    onBlur={e => flushOpacity(Number(e.currentTarget.value))}
                  />
                </div>

                {desktopLyricError && (
                  <p className="nr-dialog-error" role="alert">
                    {desktopLyricError}
                  </p>
                )}
              </div>
            </div>
          )}

          {currentSection === 'shortcuts' && canGlobalShortcuts && (
            <div className="nr-settings-panel" role="region" aria-label="全局快捷键设置">
              <header className="nr-settings-head">
                <h2>全局快捷键</h2>
                <p>开启后即使主窗口最小化或缩进托盘，也能直接控制播控与桌面歌词。</p>
              </header>

              <div className="nr-settings-card">
                <div className="nr-shortcut-master">
                  <div className="nr-shortcut-master-copy">
                    <strong>系统级热键响应</strong>
                    <small>支持 Ctrl+Alt 或 Ctrl+Shift 加方向键、Space、A–Z 或 F1–F11。</small>
                  </div>
                  <button
                    type="button"
                    className={'nr-shortcut-toggle' + (globalShortcuts?.enabled ? ' is-on' : '')}
                    aria-pressed={Boolean(globalShortcuts?.enabled)}
                    disabled={shortcutsBusy || duplicateActions.size > 0}
                    onClick={() => onToggleShortcutsEnabled?.(!globalShortcuts?.enabled, draftBindings)}
                  >
                    {globalShortcuts?.enabled ? '已开启' : '已关闭'}
                  </button>
                </div>

                {(shortcutsError || duplicateActions.size > 0) && (
                  <p className="nr-dialog-error" role="alert">
                    {duplicateActions.size > 0
                      ? '存在重复的快捷键组合，请调整后再保存或开启。'
                      : `${shortcutsError} · 请更换被占用的按键后重试。`}
                  </p>
                )}

                {textSelectionWarning && (
                  <p className="nr-shortcut-hint" role="status">
                    提示：Ctrl+Shift+左右方向键在文本编辑软件中常用于选中文字，如影响日常打字建议改用 Ctrl+Alt。
                  </p>
                )}

                <div className="nr-shortcut-rows">
                  {SHORTCUT_ACTIONS.map(action => {
                    const { modifier, key } = parseShortcutBinding(draftBindings[action.id]);
                    const isDup = duplicateActions.has(action.id);
                    return (
                      <div
                        key={action.id}
                        className={'nr-shortcut-row' + (isDup ? ' is-conflict' : '')}
                      >
                        <span className="nr-shortcut-name">
                          {action.label}
                          {isDup && <em className="nr-shortcut-dup">重复</em>}
                        </span>
                        <div className="nr-shortcut-pickers">
                          <select
                            className="nr-shortcut-select"
                            aria-label={`${action.label} 修饰键`}
                            value={modifier}
                            disabled={shortcutsBusy}
                            onChange={e => updateKeyPart(action.id, 'modifier', e.target.value)}
                          >
                            {SHORTCUT_MODIFIERS.map(mod => (
                              <option key={mod} value={mod}>
                                {mod}
                              </option>
                            ))}
                          </select>
                          <span className="nr-shortcut-plus" aria-hidden="true">+</span>
                          <select
                            className="nr-shortcut-select is-key"
                            aria-label={`${action.label} 主键`}
                            value={key}
                            disabled={shortcutsBusy}
                            onChange={e => updateKeyPart(action.id, 'key', e.target.value)}
                          >
                            {SHORTCUT_KEY_GROUPS.map(group => (
                              <optgroup key={group.label} label={group.label}>
                                {group.items.map(item => (
                                  <option key={item.value} value={item.value}>
                                    {item.label}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="nr-shortcuts-foot">
                  <button
                    type="button"
                    className="nr-ghost-btn"
                    disabled={shortcutsBusy || shortcutsIsDefault}
                    onClick={() => setDraftBindings({ ...DEFAULT_SHORTCUT_BINDINGS })}
                  >
                    恢复默认
                  </button>
                  <button
                    type="button"
                    className="nr-primary-btn"
                    disabled={shortcutsBusy || duplicateActions.size > 0 || !shortcutsDirty}
                    onClick={() => onSaveShortcutBindings?.(draftBindings)}
                  >
                    {shortcutsBusy ? '保存中…' : '保存快捷键'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {currentSection === 'updater' && canAppUpdater && (
            <div className="nr-settings-panel" role="region" aria-label="应用更新与关于">
              <header className="nr-settings-head">
                <h2>应用更新与关于</h2>
                <p>双更新通道自由切换，安装包均经本地公钥签名校验。</p>
              </header>

              <div className="nr-settings-card">
                <div className="nr-update-hero">
                  <div className="nr-update-ver-block">
                    <span className="nr-update-ver">
                      {updInfo?.version && (updPhase === 'available' || updPhase === 'downloading' || updPhase === 'ready')
                        ? `v${updateConfig?.currentVersion || '1.1.0'} → v${updInfo.version}`
                        : `Vesper v${updateConfig?.currentVersion || '1.1.0'}`}
                    </span>
                    <div className="nr-update-subline">
                      <span className="nr-update-source-tag">
                        当前通道：{updSource === 'mirror' ? '国内加速镜像' : 'GitHub 官方直连'}
                      </span>
                    </div>
                  </div>
                  <span className={`nr-update-pill is-${updateSummary?.badgeTone || 'muted'}`}>
                    {updateSummary?.badgeText || '待检查'}
                  </span>
                </div>

                {updNoteLines.length > 0 && (
                  <div className="nr-update-notes" aria-label="更新说明">
                    {updNoteLines.map((row, idx) =>
                      row.type === 'heading' ? (
                        <h3 key={idx}>{row.text}</h3>
                      ) : row.type === 'item' ? (
                        <p key={idx} className="is-item">
                          <span aria-hidden="true">·</span>
                          <span>{row.text}</span>
                        </p>
                      ) : (
                        <p key={idx}>{row.text}</p>
                      )
                    )}
                  </div>
                )}

                {(updPhase === 'downloading' || updPhase === 'ready') && (
                  <div className="nr-update-progress" aria-live="polite">
                    <div className="nr-update-progress-head">
                      <span>{updPhase === 'ready' ? '安装包已校验签名，可随时重启安装' : '正在后台下载安装包…'}</span>
                      <span className="nr-update-progress-num">
                        {updProgress?.totalBytes
                          ? `${formatBytes(updProgress.downloadedBytes)} / ${formatBytes(updProgress.totalBytes)}`
                          : formatBytes(updProgress?.downloadedBytes || 0)}{' '}
                        · {updPhase === 'ready' ? 100 : updPercent}%
                      </span>
                    </div>
                    <div className="nr-update-bar">
                      <span
                        className={'nr-update-bar-fill' + (updPhase === 'ready' ? ' is-ready' : '')}
                        style={{ width: `${updPhase === 'ready' ? 100 : updPercent}%` }}
                      />
                    </div>
                  </div>
                )}

                {updPhase === 'error' && updateState?.error && (
                  <div className="nr-update-error-box" role="alert">
                    <p className="nr-dialog-error">{updateState.error}</p>
                    {isSwitchableSourceError(updateState.errorCode) && (
                      <button
                        type="button"
                        className="nr-soft-btn nr-update-retry-alt"
                        disabled={updaterBusy}
                        onClick={() => onSwitchSourceAndRetry?.(updAltSource)}
                      >
                        {`切换至${updAltLabel}并重试`}
                      </button>
                    )}
                  </div>
                )}

                <div className="nr-update-pref-row">
                  <div className="nr-shortcut-master-copy">
                    <strong>下载通道</strong>
                    <small>
                      {updSource === 'mirror'
                        ? `使用 ${updateConfig?.customMirror || updateConfig?.defaultMirror || 'https://gh-proxy.com/'} 全程代理`
                        : '直接连接 GitHub Releases'}
                    </small>
                  </div>
                  <div className="nr-seg-pills" role="group" aria-label="设置页更新源选择">
                    <button
                      type="button"
                      className={'nr-seg-btn' + (updSource === 'github' ? ' is-on' : '')}
                      aria-pressed={updSource === 'github'}
                      disabled={updaterBusy || updPhase === 'downloading'}
                      onClick={() => onChangeUpdateSource?.('github')}
                    >
                      GitHub 直连
                    </button>
                    <button
                      type="button"
                      className={'nr-seg-btn' + (updSource === 'mirror' ? ' is-on' : '')}
                      aria-pressed={updSource === 'mirror'}
                      disabled={updaterBusy || updPhase === 'downloading'}
                      onClick={() => onChangeUpdateSource?.('mirror')}
                    >
                      国内加速镜像
                    </button>
                  </div>
                </div>

                {updSource === 'mirror' && (
                  <form className="nr-update-mirror-form" onSubmit={handleMirrorSubmit}>
                    <input
                      type="url"
                      className="nr-update-mirror-input"
                      value={mirrorDraft}
                      disabled={updaterBusy || updPhase === 'downloading'}
                      placeholder={updateConfig?.defaultMirror || 'https://gh-proxy.com/'}
                      aria-label="设置页自定义镜像前缀"
                      onChange={e => {
                        setMirrorDraft(e.target.value);
                        if (mirrorError) setMirrorError('');
                      }}
                    />
                    <button type="submit" className="nr-soft-btn" disabled={updaterBusy || updPhase === 'downloading'}>
                      保存镜像
                    </button>
                    {updateConfig?.customMirror && (
                      <button
                        type="button"
                        className="nr-ghost-btn"
                        disabled={updaterBusy || updPhase === 'downloading'}
                        onClick={() => onSaveMirror?.('')}
                      >
                        恢复默认
                      </button>
                    )}
                  </form>
                )}
                {mirrorError && (
                  <p className="nr-dialog-error" role="alert">
                    {mirrorError}
                  </p>
                )}

                <div className="nr-shortcut-master">
                  <div className="nr-shortcut-master-copy">
                    <strong>启动时自动检查更新</strong>
                    <small>常规修复静默亮灯提醒，重要新功能才弹出窗口。</small>
                  </div>
                  <button
                    type="button"
                    className={'nr-shortcut-toggle' + (updateConfig?.autoCheck ? ' is-on' : '')}
                    aria-pressed={Boolean(updateConfig?.autoCheck)}
                    disabled={updaterBusy}
                    onClick={() => onToggleAutoCheck?.(!updateConfig?.autoCheck)}
                  >
                    {updateConfig?.autoCheck ? '已开启' : '已关闭'}
                  </button>
                </div>

                <div className="nr-settings-actions-row">
                  {updPhase === 'ready' ? (
                    <button type="button" className="nr-primary-btn" disabled={updaterBusy} onClick={onInstallUpdate}>
                      {updaterBusy ? '正在安装…' : '重启并安装'}
                    </button>
                  ) : updPhase === 'available' && updInfo?.version ? (
                    <>
                      <button
                        type="button"
                        className="nr-primary-btn"
                        disabled={updaterBusy}
                        onClick={onDownloadUpdate}
                      >
                        立即更新
                      </button>
                      <button
                        type="button"
                        className="nr-ghost-btn"
                        disabled={updaterBusy}
                        onClick={() => onSkipUpdateVersion?.(updInfo.version)}
                      >
                        跳过此版本
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="nr-primary-btn"
                      disabled={updaterBusy || updPhase === 'checking' || updPhase === 'downloading' || !updateConfig?.pubkeyConfigured}
                      onClick={onCheckUpdate}
                    >
                      {updPhase === 'checking' ? '检查中…' : '检查更新'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
});
