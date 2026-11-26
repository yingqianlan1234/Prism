import React, { useEffect, useRef, useState } from 'react';
import {
  artist,
  providerLabel,
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
import { Icon } from './Icons.jsx';
import { PlaylistCover } from './Artwork.jsx';
import {
  formatBytes,
  isSwitchableSourceError,
  parseReleaseNotes,
  validateMirrorPrefix,
} from '../updater.js';

const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2];
const SLEEP_OPTIONS = [
  { id: 'off', label: '关' },
  { id: '15', label: '15分' },
  { id: '30', label: '30分' },
  { id: '60', label: '60分' },
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

export function MoreSettingsPanel({
  showMore,
  setShowMore,
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
  isStageActive,
  onOpenNowPlaying,
  closeMode,
  onOpenCloseSettings,
  canDesktopLyric,
  desktopLyric,
  desktopLyricBusy,
  desktopLyricError,
  onToggleDesktopLyric,
  onToggleDesktopLyricLock,
  onUpdateDesktopLyricStyle,
  canGlobalShortcuts,
  globalShortcuts,
  onOpenShortcuts,
  canAppUpdater,
  updateSummary,
  onOpenUpdater,
}) {
  const [showLyricStyle, setShowLyricStyle] = useState(false);
  const style = desktopLyric?.style || {};
  const layout = style.layout || 'dual';
  const align = style.align || 'center';
  const theme = style.theme || 'night';
  const fontSize = Number(style.fontSize) || 28;
  const karaoke = style.karaoke !== false;
  const showTranslation = style.showTranslation !== false;
  const showRomaji = Boolean(style.showRomaji);
  const panelOpacity = Number.isFinite(Number(style.panelOpacity)) ? Number(style.panelOpacity) : 82;
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
    opacityTimerRef.current = setTimeout(() => {
      flushOpacity();
    }, 80);
  };

  const canReloadQuality =
    canSelectQuality &&
    song?.provider === 'netease' &&
    trackQuality?.level &&
    trackQuality.level !== neteaseQuality;
  return (
    <div id="lw-more-panel" className="lw-more" role="dialog" aria-label="更多设置" hidden={!showMore}>
      <div className="nr-more-group">
        <span className="nr-more-label">播放倍速</span>
        <div className="nr-seg-pills" role="group" aria-label="播放倍速">
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

      <div className="nr-more-group">
        <span className="nr-more-label">睡眠定时</span>
        <div className="nr-seg-pills" role="group" aria-label="睡眠定时">
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

      {canSelectQuality && (
        <div className="nr-more-group">
          <div className="nr-more-label-row">
            <span className="nr-more-label">网易云音质</span>
            {song?.provider === 'netease' && trackQuality?.level && (
              <span className="nr-more-sub">
                当前：{QUALITY_LABELS[trackQuality.level] || trackQuality.level}
              </span>
            )}
          </div>
          <div className="nr-seg-pills" role="group" aria-label="网易云音质">
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
              按当前设置重载本首
            </button>
          )}
        </div>
      )}

      {canDesktopLyric && (
        <div className="nr-more-group">
          <div className="nr-more-label-row">
            <span className="nr-more-label">桌面歌词</span>
            {desktopLyric?.enabled && (
              <span className="nr-more-sub">{desktopLyric.locked ? '已锁定穿透' : '可拖拽位置'}</span>
            )}
          </div>
          <div className="nr-more-desktop-row" role="group" aria-label="桌面歌词控制">
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
          <button
            type="button"
            className={'nr-seg-btn nr-dlyric-expand' + (showLyricStyle ? ' is-open' : '')}
            aria-expanded={showLyricStyle}
            onClick={() => setShowLyricStyle(v => !v)}
          >
            外观与字幕设置{showLyricStyle ? '（收起）' : ''}
          </button>
          {showLyricStyle && (
            <div className="nr-dlyric-style-box" role="group" aria-label="桌面歌词外观设置">
              <div className="nr-dlyric-subrow">
                <span className="nr-more-sub-label">字幕模式</span>
                <div className="nr-seg-pills">
                  {LYRIC_LAYOUTS.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      className={'nr-seg-btn' + (layout === item.id ? ' is-on' : '')}
                      aria-pressed={layout === item.id}
                      onClick={() => onUpdateDesktopLyricStyle?.({ layout: item.id })}
                    >
                      {item.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={'nr-seg-btn' + (karaoke ? ' is-on' : '')}
                    aria-pressed={karaoke}
                    onClick={() => onUpdateDesktopLyricStyle?.({ karaoke: !karaoke })}
                  >
                    暖光推进
                  </button>
                </div>
              </div>

              <div className="nr-dlyric-subrow">
                <span className="nr-more-sub-label">伴随字幕</span>
                <div className="nr-seg-pills">
                  <button
                    type="button"
                    className={'nr-seg-btn' + (showTranslation ? ' is-on' : '')}
                    aria-pressed={showTranslation}
                    onClick={() =>
                      onUpdateDesktopLyricStyle?.({ showTranslation: !showTranslation })
                    }
                  >
                    译文
                  </button>
                  <button
                    type="button"
                    className={'nr-seg-btn' + (showRomaji ? ' is-on' : '')}
                    aria-pressed={showRomaji}
                    onClick={() => onUpdateDesktopLyricStyle?.({ showRomaji: !showRomaji })}
                  >
                    音译
                  </button>
                </div>
              </div>

              <div className="nr-dlyric-subrow">
                <span className="nr-more-sub-label">配色主题</span>
                <div className="nr-theme-grid">
                  {LYRIC_THEMES.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      className={'nr-seg-btn nr-theme-pill' + (theme === item.id ? ' is-on' : '')}
                      aria-pressed={theme === item.id}
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

              <div className="nr-dlyric-subrow">
                <div className="nr-more-label-row">
                  <span className="nr-more-sub-label">字号与对齐</span>
                  <span className="nr-more-sub">{fontSize}px</span>
                </div>
                <div className="nr-dlyric-split">
                  <div className="nr-seg-pills">
                    {LYRIC_FONT_SIZES.map(item => (
                      <button
                        key={item.size}
                        type="button"
                        className={'nr-seg-btn' + (fontSize === item.size ? ' is-on' : '')}
                        aria-pressed={fontSize === item.size}
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
                        className={'nr-seg-btn' + (align === item.id ? ' is-on' : '')}
                        aria-pressed={align === item.id}
                        onClick={() => onUpdateDesktopLyricStyle?.({ align: item.id })}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="nr-dlyric-subrow">
                <div className="nr-more-label-row">
                  <label className="nr-more-sub-label" htmlFor="nr-dlyric-opacity">
                    悬停底板透明度
                  </label>
                  <span className="nr-more-sub">{opacityDraft}%</span>
                </div>
                <input
                  id="nr-dlyric-opacity"
                  className="nr-dlyric-range"
                  type="range"
                  min={40}
                  max={100}
                  step={2}
                  value={opacityDraft}
                  aria-label="桌面歌词悬停底板透明度"
                  onChange={e => {
                    const nextVal = Number(e.target.value);
                    setOpacityDraft(nextVal);
                    scheduleOpacity(nextVal);
                  }}
                  onPointerUp={e => flushOpacity(Number(e.currentTarget.value))}
                  onBlur={e => flushOpacity(Number(e.currentTarget.value))}
                />
              </div>

              <p className="nr-dlyric-tip">
                未锁定时悬停浮现播控条并可拖宽；锁定后鼠标移到歌词上可点「解锁」。
              </p>
            </div>
          )}
          {desktopLyricError && (
            <p className="nr-dialog-error" role="alert">
              {desktopLyricError}
            </p>
          )}
        </div>
      )}

      <div className="nr-more-divider" />

      {canGlobalShortcuts && (
        <button type="button" className="lw-more-item" onClick={onOpenShortcuts}>
          全局快捷键：{globalShortcuts?.enabled ? '已开启' : '已关闭'}
          {globalShortcuts?.error ? '（有冲突）' : ''}
        </button>
      )}

      <button
        type="button"
        className="lw-more-item"
        aria-pressed={Boolean(isStageActive)}
        onClick={onOpenNowPlaying}
      >
        播放详情
      </button>

      <button type="button" className="lw-more-item" onClick={onOpenCloseSettings}>
        关闭窗口：{closeMode === 'background' ? '后台运行' : closeMode === 'exit' ? '完全退出' : '每次询问'}
      </button>

      {canAppUpdater && (
        <button type="button" className="lw-more-item nr-update-entry" onClick={onOpenUpdater}>
          <span>应用更新</span>
          <span className={`nr-update-pill is-${updateSummary?.badgeTone || 'muted'}`}>
            {updateSummary?.badgeText || '检查更新'}
          </span>
        </button>
      )}

      <button type="button" className="lw-more-item is-close" onClick={() => setShowMore(false)}>
        关闭
      </button>
    </div>
  );
}

export function QueueDrawer({
  showQueue,
  setShowQueue,
  confirmClear,
  setConfirmClear,
  activeProvider,
  ws,
  song,
  pendingPlay,
  selectedTrack,
  setSelectedTrack,
  play,
  editQueue,
}) {
  if (!showQueue) return null;
  const tracks = ws.queue?.tracks || [];
  const isFm = ws.queue?.type === 'fm' || ws.queue?.source === 'fm';

  return (
    <div
      className="overlay queue-overlay"
      onClick={() => {
        setShowQueue(false);
        setConfirmClear(false);
      }}
    >
      <div
        className="dialog queue-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="播放队列"
        aria-labelledby="queue-heading"
        onClick={e => e.stopPropagation()}
      >
        <div className="queue-header">
          <h2 id="queue-heading">
            {providerLabel(activeProvider)}播放队列 · {tracks.length} 首
            {tracks.length ? ` · 接下来 ${Math.max(0, tracks.length - ws.queue.index - 1)} 首` : ''}
          </h2>
          <button
            type="button"
            className="nr-soft-btn"
            onClick={() => {
              setShowQueue(false);
              setConfirmClear(false);
            }}
            aria-label="关闭播放队列"
          >
            关闭
          </button>
        </div>

        {song && song.provider !== activeProvider && (
          <p className="nr-queue-note">
            正在播放的歌曲来自{providerLabel(song.provider)}，这里显示的是
            {providerLabel(activeProvider)}的队列。
          </p>
        )}

        {pendingPlay && (
          <p className="nr-queue-note" role="status">
            歌曲切换中，暂不可修改队列。
          </p>
        )}

        {tracks.length ? (
          <>
            <div className="queue-list">
              {tracks.map((track, index) => {
                const current =
                  song?.provider === activeProvider &&
                  song?.accountId === track.accountId &&
                  song?.id === track.id &&
                  ws.queue.index === index;
                const picked =
                  selectedTrack?.provider === track.provider &&
                  selectedTrack?.id === track.id &&
                  selectedTrack?.accountId === track.accountId;

                return (
                  <div
                    className={'queue-item' + (current ? ' selected' : picked ? ' picked' : '')}
                    key={`${track.id}-${index}`}
                  >
                    <button
                      type="button"
                      className="queue-song"
                      onClick={() =>
                        track.provider === 'netease'
                          ? setSelectedTrack({
                              provider: track.provider,
                              id: track.id,
                              accountId: track.accountId,
                            })
                          : play(track, { ...ws.queue, index })
                      }
                      onDoubleClick={() => {
                        if (track.provider === 'netease') play(track, { ...ws.queue, index });
                      }}
                      onKeyDown={e => {
                        if (track.provider === 'netease' && e.key === 'Enter') {
                          e.preventDefault();
                          play(track, { ...ws.queue, index });
                        }
                      }}
                      aria-current={current ? 'true' : undefined}
                    >
                      <span>
                        {index + 1}. {track.name}
                      </span>
                      <small>{artist(track)}</small>
                    </button>

                    {!isFm && (
                      <button
                        type="button"
                        className="nr-remove-btn"
                        disabled={pendingPlay}
                        aria-disabled={pendingPlay}
                        onClick={() => editQueue(index)}
                        aria-label={(current ? '移除并停止 ' : '移除 ') + track.name}
                      >
                        {current ? '移除并停止' : '移除'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {isFm ? (
              <p className="nr-queue-foot">私人 FM 队列不可编辑，由推荐流管理。</p>
            ) : confirmClear ? (
              <div
                className="lw-confirm"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="clear-queue-title"
              >
                <p id="clear-queue-title">确定清空此工作区队列？正在播放的本平台歌曲会停止。</p>
                <div className="nr-confirm-actions">
                  <button
                    type="button"
                    className="nr-danger-btn"
                    disabled={pendingPlay}
                    onClick={() => editQueue(null, true)}
                  >
                    确认清空
                  </button>
                  <button
                    type="button"
                    className="nr-soft-btn"
                    data-cancel=""
                    onClick={() => setConfirmClear(false)}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="lw-clear-queue nr-soft-btn"
                disabled={pendingPlay}
                aria-disabled={pendingPlay}
                onClick={() => setConfirmClear(true)}
              >
                清空队列
              </button>
            )}
          </>
        ) : (
          <p className="nr-queue-empty">队列为空，选择歌曲后会显示在这里。</p>
        )}
      </div>
    </div>
  );
}

export function QqAuthDialog({ open, busy, message, onComplete, onCancel }) {
  if (!open) return null;
  return (
    <div className="overlay">
      <div
        className="dialog qq-auth-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qq-auth-heading"
      >
        <h2 id="qq-auth-heading">QQ 音乐授权</h2>
        <p>请在腾讯授权窗口由你本人完成登录，再回到这里确认。</p>
        <div className="nr-dialog-actions">
          <button type="button" className="nr-primary-btn" disabled={busy} onClick={onComplete}>
            已完成 QQ 授权
          </button>
          <button type="button" className="nr-soft-btn" onClick={onCancel}>
            取消
          </button>
        </div>
        {message && (
          <p className="nr-dialog-status" role="status">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}

export function CloseBehaviorDialog({
  closeDialog,
  closeBusy,
  trayAvailable,
  closeError,
  onChoose,
  onCancel,
}) {
  if (!closeDialog) return null;
  return (
    <div className="overlay">
      <div
        className="dialog lw-close-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lw-close-heading"
      >
        <h2 id="lw-close-heading">关闭窗口时</h2>
        <p>选择以后点击关闭按钮的行为，可在“更多设置”中修改。</p>
        <div className="nr-close-options">
          <div className="nr-close-opt">
            <button
              type="button"
              className="nr-primary-btn"
              disabled={closeBusy || !trayAvailable}
              onClick={() => onChoose('background')}
            >
              后台运行
            </button>
            <small>
              {trayAvailable
                ? '音乐继续播放，可从系统托盘打开或退出。'
                : '系统托盘不可用，暂不能后台运行。'}
            </small>
          </div>
          <div className="nr-close-opt">
            <button
              type="button"
              className="nr-soft-btn"
              disabled={closeBusy}
              onClick={() => onChoose('exit')}
            >
              完全退出
            </button>
            <small>关闭应用并停止播放。</small>
          </div>
        </div>
        {closeError && (
          <p className="nr-dialog-error" role="alert">
            {closeError}
          </p>
        )}
        <button
          type="button"
          className="nr-ghost-btn"
          data-close-cancel=""
          disabled={closeBusy}
          onClick={onCancel}
        >
          取消
        </button>
      </div>
    </div>
  );
}

export function QrDialog({ qr, onClose }) {
  if (!qr) return null;
  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="dialog qr-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-heading"
        onClick={e => e.stopPropagation()}
      >
        <button type="button" className="close nr-close-btn" onClick={onClose} aria-label="关闭">
          <Icon name="close" />
        </button>
        <h2 id="qr-heading">登录{qr.provider === 'netease' ? '网易云音乐' : 'QQ 音乐'}</h2>
        <p>使用{qr.provider === 'netease' ? '网易云音乐' : 'QQ'} App 扫码并确认</p>
        {qr.image && (
          <div className="nr-qr-frame">
            <img src={qr.image} alt="登录二维码" />
          </div>
        )}
        <small>登录信息由本机安全保存</small>
      </div>
    </div>
  );
}

export function PlaylistPickerDialog({ track, playlists, busyId, error, onSelect, onClose }) {
  if (!track) return null;
  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="dialog nr-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="picker-heading"
        onClick={e => e.stopPropagation()}
      >
        <div className="queue-header">
          <h2 id="picker-heading">收藏到歌单</h2>
          <button
            type="button"
            className="nr-close-btn"
            aria-label="关闭收藏弹窗"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
        <p className="nr-picker-track">
          <b>{track.name}</b> · {artist(track) || '未知歌手'}
        </p>
        {error && (
          <p className="nr-dialog-error" role="alert">
            {error}
          </p>
        )}
        {playlists.length ? (
          <div className="nr-picker-list">
            {playlists.map(pl => {
              const busy = String(busyId ?? '') === String(pl.id);
              return (
                <button
                  key={pl.id}
                  type="button"
                  className="nr-picker-item"
                  disabled={busyId != null}
                  onClick={() => onSelect(pl)}
                >
                  <PlaylistCover className="nr-picker-thumb" url={pl.coverImgUrl} />
                  <span className="nr-picker-copy">
                    <b>{pl.name}</b>
                    <small>{pl.trackCount ?? '——'} 首</small>
                  </span>
                  <span className="nr-picker-state">{busy ? '收藏中…' : '加入'}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="nr-queue-empty">暂无可编辑的自建歌单。</p>
        )}
      </div>
    </div>
  );
}

export function GlobalShortcutsDialog({
  open,
  status,
  busy,
  error,
  onToggleEnabled,
  onSaveBindings,
  onClose,
}) {
  const activeBindings = { ...DEFAULT_SHORTCUT_BINDINGS, ...(status?.bindings || {}) };
  const [draftBindings, setDraftBindings] = useState(activeBindings);

  useEffect(() => {
    if (!open) return;
    setDraftBindings({ ...DEFAULT_SHORTCUT_BINDINGS, ...(status?.bindings || {}) });
  }, [open, status?.bindings]);

  if (!open) return null;

  const duplicateActions = findDuplicateShortcutActions(draftBindings);
  const textSelectionWarning = hasTextSelectionShortcutWarning(draftBindings);
  const dirty = SHORTCUT_ACTIONS.some(a => draftBindings[a.id] !== activeBindings[a.id]);
  const isDefault = SHORTCUT_ACTIONS.every(a => draftBindings[a.id] === a.defaultKey);

  const updateKeyPart = (actionId, part, value) => {
    setDraftBindings(prev => {
      const parsed = parseShortcutBinding(prev[actionId]);
      const nextModifier = part === 'modifier' ? value : parsed.modifier;
      const nextKey = part === 'key' ? value : parsed.key;
      return { ...prev, [actionId]: formatShortcutBinding(nextModifier, nextKey) };
    });
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="dialog nr-shortcuts-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-heading"
        onClick={e => e.stopPropagation()}
      >
        <div className="queue-header">
          <h2 id="shortcuts-heading" className="nr-shortcuts-title">
            <Icon name="keyboard" className="nr-icon" />
            全局快捷键
          </h2>
          <button
            type="button"
            className="nr-close-btn"
            aria-label="关闭全局快捷键设置"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>

        <div className="nr-shortcut-master">
          <div className="nr-shortcut-master-copy">
            <strong>系统级热键响应</strong>
            <small>
              开启后在后台或托盘也可使用；支持 Ctrl+Alt 或 Ctrl+Shift 加方向键、Space、A–Z 或 F1–F11。
            </small>
          </div>
          <button
            type="button"
            className={'nr-shortcut-toggle' + (status?.enabled ? ' is-on' : '')}
            aria-pressed={Boolean(status?.enabled)}
            disabled={busy || duplicateActions.size > 0}
            onClick={() => onToggleEnabled(!status?.enabled, draftBindings)}
          >
            {status?.enabled ? '已开启' : '已关闭'}
          </button>
        </div>

        {(error || duplicateActions.size > 0) && (
          <p className="nr-dialog-error" role="alert">
            {duplicateActions.size > 0
              ? '存在重复的快捷键组合，请调整后再保存或开启。'
              : `${error} · 请更换被占用的按键后重试。`}
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
                    disabled={busy}
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
                    disabled={busy}
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
          <div className="nr-shortcuts-foot-left">
            <button
              type="button"
              className="nr-ghost-btn"
              disabled={busy || isDefault}
              onClick={() => setDraftBindings({ ...DEFAULT_SHORTCUT_BINDINGS })}
            >
              恢复默认
            </button>
          </div>
          <div className="nr-dialog-actions">
            <button type="button" className="nr-soft-btn" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="nr-primary-btn"
              disabled={busy || duplicateActions.size > 0 || !dirty}
              onClick={() => onSaveBindings(draftBindings)}
            >
              {busy ? '保存中…' : '保存快捷键'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AppUpdateDialog({
  open,
  mode,
  config,
  state,
  busy,
  onCheck,
  onDownload,
  onInstall,
  onSkipVersion,
  onRemindLater,
  onChangeSource,
  onSaveMirror,
  onToggleAutoCheck,
  onSwitchSourceAndRetry,
  onClose,
}) {
  const [mirrorExpanded, setMirrorExpanded] = useState(false);
  const [mirrorDraft, setMirrorDraft] = useState(config?.customMirror || '');
  const [mirrorError, setMirrorError] = useState('');

  useEffect(() => {
    if (!open) return;
    setMirrorDraft(config?.customMirror || '');
    setMirrorError('');
    setMirrorExpanded(Boolean(config?.customMirror));
  }, [open, config?.customMirror]);

  if (!open) return null;

  const phase = state?.phase || 'idle';
  const info = state?.info || null;
  const progress = state?.progress || null;
  const currentVersion = config?.currentVersion || '1.1.0';
  const source = config?.source === 'mirror' ? 'mirror' : 'github';
  const altSource = source === 'github' ? 'mirror' : 'github';
  const altLabel = altSource === 'mirror' ? '国内加速镜像' : 'GitHub 直连';
  const pubkeyConfigured = Boolean(config?.pubkeyConfigured);
  const isDownloading = phase === 'downloading';
  const isChecking = phase === 'checking';
  const isReady = phase === 'ready';
  const isAvailable = phase === 'available' && Boolean(info?.version);
  const isFeaturePrompt = mode === 'auto' && isAvailable;
  const noteLines = isAvailable || isDownloading || isReady ? parseReleaseNotes(info?.notes || '') : [];
  const percent = Number.isFinite(progress?.percent)
    ? Math.max(0, Math.min(100, Math.round(progress.percent)))
    : 0;
  const downloadedText = progress?.downloadedBytes ? formatBytes(progress.downloadedBytes) : '0 B';
  const totalText = progress?.totalBytes ? formatBytes(progress.totalBytes) : '';
  const updateKindLabel =
    info?.updateKind === 'feature' ? '功能更新' : info?.updateKind === 'patch' ? '常规修复' : '';

  let statusPillText = '待检查';
  let statusPillTone = 'muted';
  if (!pubkeyConfigured) {
    statusPillText = '未配公钥';
    statusPillTone = 'muted';
  } else if (isChecking) {
    statusPillText = '检查中…';
    statusPillTone = 'muted';
  } else if (isDownloading) {
    statusPillText = `下载中 ${percent}%`;
    statusPillTone = 'accent';
  } else if (isReady) {
    statusPillText = '验签通过 · 待重启';
    statusPillTone = 'ok';
  } else if (isAvailable) {
    statusPillText = '有新版本';
    statusPillTone = 'accent';
  } else if (phase === 'up-to-date') {
    statusPillText = '已是最新';
    statusPillTone = 'ok';
  } else if (phase === 'error') {
    statusPillText = '检查失败';
    statusPillTone = 'danger';
  }

  const handleMirrorSave = async e => {
    e.preventDefault();
    const check = validateMirrorPrefix(mirrorDraft);
    if (!check.valid) {
      setMirrorError(check.error);
      return;
    }
    setMirrorError('');
    await onSaveMirror?.(check.normalized);
  };

  const handleMirrorReset = async () => {
    setMirrorDraft('');
    setMirrorError('');
    await onSaveMirror?.('');
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="dialog nr-update-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-update-heading"
        onClick={e => e.stopPropagation()}
      >
        <div className="queue-header">
          <h2 id="app-update-heading" className="nr-shortcuts-title">
            <Icon name={isReady || phase === 'up-to-date' ? 'checkCircle' : 'update'} className="nr-icon" />
            {isFeaturePrompt ? '发现新版本' : '应用更新'}
          </h2>
          <button
            type="button"
            className="nr-close-btn"
            aria-label="关闭应用更新弹窗"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>

        <div className="nr-update-hero">
          <div className="nr-update-ver-block">
            <span className="nr-update-ver">
              {info?.version && (isAvailable || isDownloading || isReady)
                ? `v${currentVersion} → v${info.version}`
                : `v${currentVersion}`}
            </span>
            <div className="nr-update-subline">
              {updateKindLabel && (isAvailable || isDownloading || isReady) && (
                <span className="nr-update-kind">{updateKindLabel}</span>
              )}
              <span className="nr-update-source-tag">
                当前通道：{source === 'mirror' ? '国内加速镜像' : 'GitHub 官方直连'}
              </span>
            </div>
          </div>
          <span className={`nr-update-pill is-${statusPillTone}`}>{statusPillText}</span>
        </div>

        {!pubkeyConfigured && (
          <p className="nr-shortcut-hint" role="status">
            当前开发构建尚未填入正式更新签名公钥（pubkey）。配置后即可在线拉取并校验 GitHub Release 更新包。
          </p>
        )}

        {noteLines.length > 0 && (
          <div className="nr-update-notes" aria-label="更新说明">
            {noteLines.map((row, idx) =>
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

        {(isDownloading || isReady) && (
          <div className="nr-update-progress" aria-live="polite">
            <div className="nr-update-progress-head">
              <span>{isReady ? '安装包已校验签名，可随时重启安装' : '正在后台下载安装包…'}</span>
              <span className="nr-update-progress-num">
                {totalText ? `${downloadedText} / ${totalText}` : downloadedText} · {isReady ? 100 : percent}%
              </span>
            </div>
            <div
              className="nr-update-bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={isReady ? 100 : percent}
            >
              <span
                className={'nr-update-bar-fill' + (isReady ? ' is-ready' : '')}
                style={{ width: `${isReady ? 100 : percent}%` }}
              />
            </div>
          </div>
        )}

        {phase === 'error' && state?.error && (
          <div className="nr-update-error-box" role="alert">
            <p className="nr-dialog-error">{state.error}</p>
            {isSwitchableSourceError(state.errorCode) && (
              <button
                type="button"
                className="nr-soft-btn nr-update-retry-alt"
                disabled={busy || isChecking || isDownloading}
                onClick={() => onSwitchSourceAndRetry?.(altSource)}
              >
                {`切换至${altLabel}并重试`}
              </button>
            )}
          </div>
        )}

        <div className="nr-update-prefs">
          <div className="nr-update-pref-row">
            <div className="nr-shortcut-master-copy">
              <strong>下载通道</strong>
              <small>
                {source === 'mirror'
                  ? `使用 ${config?.customMirror || config?.defaultMirror || 'https://gh-proxy.com/'} 全程代理元数据与安装包，所有包仍经过本地签名校验`
                  : '直接连接 GitHub Releases，海外或代理网络推荐'}
              </small>
            </div>
            <div className="nr-seg-pills" role="group" aria-label="更新源选择">
              <button
                type="button"
                className={'nr-seg-btn' + (source === 'github' ? ' is-on' : '')}
                aria-pressed={source === 'github'}
                disabled={busy || isDownloading}
                onClick={() => onChangeSource?.('github')}
              >
                GitHub 直连
              </button>
              <button
                type="button"
                className={'nr-seg-btn' + (source === 'mirror' ? ' is-on' : '')}
                aria-pressed={source === 'mirror'}
                disabled={busy || isDownloading}
                onClick={() => onChangeSource?.('mirror')}
              >
                国内加速镜像
              </button>
            </div>
          </div>

          {source === 'mirror' && (
            <div className="nr-update-mirror-box">
              <button
                type="button"
                className="nr-more-reload"
                onClick={() => setMirrorExpanded(v => !v)}
              >
                {mirrorExpanded ? '收起自定义镜像设置' : '自定义镜像前缀（可选）'}
              </button>
              {mirrorExpanded && (
                <form className="nr-update-mirror-form" onSubmit={handleMirrorSave}>
                  <input
                    type="url"
                    className="nr-update-mirror-input"
                    value={mirrorDraft}
                    disabled={busy || isDownloading}
                    placeholder={config?.defaultMirror || 'https://gh-proxy.com/'}
                    aria-label="自定义镜像前缀"
                    onChange={e => {
                      setMirrorDraft(e.target.value);
                      if (mirrorError) setMirrorError('');
                    }}
                  />
                  <button
                    type="submit"
                    className="nr-soft-btn"
                    disabled={busy || isDownloading}
                  >
                    保存
                  </button>
                  {config?.customMirror && (
                    <button
                      type="button"
                      className="nr-ghost-btn"
                      disabled={busy || isDownloading}
                      onClick={handleMirrorReset}
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
            </div>
          )}

          <div className="nr-shortcut-master">
            <div className="nr-shortcut-master-copy">
              <strong>启动时自动检查更新</strong>
              <small>常规修复仅点亮齿轮提示点，重要新功能才弹出提醒。</small>
            </div>
            <button
              type="button"
              className={'nr-shortcut-toggle' + (config?.autoCheck ? ' is-on' : '')}
              aria-pressed={Boolean(config?.autoCheck)}
              disabled={busy}
              onClick={() => onToggleAutoCheck?.(!config?.autoCheck)}
            >
              {config?.autoCheck ? '已开启' : '已关闭'}
            </button>
          </div>
        </div>

        <div className="nr-update-foot">
          {isReady ? (
            <>
              <button type="button" className="nr-soft-btn" disabled={busy} onClick={onClose}>
                稍后重启
              </button>
              <button type="button" className="nr-primary-btn" disabled={busy} onClick={onInstall}>
                {busy ? '正在安装…' : '重启并安装'}
              </button>
            </>
          ) : isDownloading ? (
            <>
              <span className="nr-update-foot-note">关闭窗口不影响下载，可继续听歌</span>
              <button type="button" className="nr-soft-btn" onClick={onClose}>
                后台继续
              </button>
            </>
          ) : isAvailable ? (
            <>
              <button
                type="button"
                className="nr-ghost-btn"
                disabled={busy}
                onClick={() => onSkipVersion?.(info.version)}
              >
                跳过此版本
              </button>
              <div className="nr-dialog-actions">
                <button
                  type="button"
                  className="nr-soft-btn"
                  disabled={busy}
                  onClick={() => onRemindLater?.(info.version)}
                >
                  稍后提醒
                </button>
                <button type="button" className="nr-primary-btn" disabled={busy} onClick={onDownload}>
                  立即更新
                </button>
              </div>
            </>
          ) : (
            <>
              <button type="button" className="nr-soft-btn" onClick={onClose}>
                关闭
              </button>
              <button
                type="button"
                className="nr-primary-btn"
                disabled={busy || isChecking || !pubkeyConfigured}
                onClick={() => onCheck?.()}
              >
                {isChecking ? '检查中…' : '检查更新'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
