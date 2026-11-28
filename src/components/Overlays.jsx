import React, { memo, useEffect, useRef, useState } from 'react';
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
import { PlaylistCover, SourceTag } from './Artwork.jsx';
import { customTrackKey } from '../custom-playlists.js';
import { computePlayNextTarget } from '../playback-state.js';
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
  onOpenFullSettings,
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

      {onOpenCloseSettings && (
        <button type="button" className="lw-more-item" onClick={onOpenCloseSettings}>
          关闭窗口：{closeMode === 'background' ? '后台运行' : closeMode === 'exit' ? '完全退出' : '每次询问'}
        </button>
      )}

      {canAppUpdater && (
        <button type="button" className="lw-more-item nr-update-entry" onClick={onOpenUpdater}>
          <span>应用更新</span>
          <span className={`nr-update-pill is-${updateSummary?.badgeTone || 'muted'}`}>
            {updateSummary?.badgeText || '检查更新'}
          </span>
        </button>
      )}

      {onOpenFullSettings && (
        <button type="button" className="lw-more-item" onClick={onOpenFullSettings}>
          打开完整设置页
        </button>
      )}

      <button type="button" className="lw-more-item is-close" onClick={() => setShowMore(false)}>
        关闭
      </button>
    </div>
  );
}

export const QueueDrawer = memo(function QueueDrawer({
  showQueue,
  setShowQueue,
  confirmClear,
  setConfirmClear,
  activeProvider,
  ws,
  mixedQueue = null,
  song,
  pendingPlay,
  selectedTrack,
  setSelectedTrack,
  play,
  editQueue,
  editMixedQueue,
  reorderQueue,
  reorderMixedQueue,
}) {
  const [rendered, setRendered] = useState(showQueue);
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef(null);
  const listRef = useRef(null);
  const dragRef = useRef(null);
  const ghostRef = useRef(null);
  const scrollRafRef = useRef(null);
  const tracksRef = useRef([]);
  const [dragUi, setDragUi] = useState(null);

  const stopDrag = () => {
    if (scrollRafRef.current != null && typeof globalThis.cancelAnimationFrame === 'function') {
      globalThis.cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
    dragRef.current = null;
    setDragUi(null);
  };

  useEffect(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (showQueue) {
      setRendered(true);
      setClosing(false);
      return;
    }
    stopDrag();
    if (!rendered) return;
    const reduced =
      typeof globalThis.matchMedia === 'function' &&
      globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setRendered(false);
      setClosing(false);
      return;
    }
    setClosing(true);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setRendered(false);
      setClosing(false);
    }, 210);
  }, [showQueue, rendered]);

  useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      if (scrollRafRef.current != null && typeof globalThis.cancelAnimationFrame === 'function') {
        globalThis.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    },
    []
  );

  const isMixed = Boolean(mixedQueue?.tracks?.length);
  const activeQueue = isMixed ? mixedQueue : ws.queue;
  const tracks = activeQueue?.tracks || [];
  tracksRef.current = tracks;
  const isFm = !isMixed && (ws.queue?.type === 'fm' || ws.queue?.source === 'fm');
  const removeAction = isMixed ? editMixedQueue : editQueue;
  const reorderAction = isMixed ? reorderMixedQueue : reorderQueue;
  const canReorder = rendered && !closing && !isFm && !pendingPlay && tracks.length > 1 && Boolean(reorderAction);

  useEffect(() => {
    if (!canReorder) stopDrag();
  }, [canReorder]);

  useEffect(() => {
    if (!canReorder) return undefined;

    const resolveTargetIndex = (clientY, fromIndex) => {
      const listEl = listRef.current;
      if (!listEl) return fromIndex;
      const items = listEl.querySelectorAll('.queue-item');
      if (!items.length) return fromIndex;
      const listRect = listEl.getBoundingClientRect();
      const contentY = clientY - listRect.top + listEl.scrollTop;
      let slot = 0;
      for (let i = 0; i < items.length; i++) {
        const midY = items[i].offsetTop + items[i].offsetHeight / 2;
        if (contentY >= midY) slot = i + 1;
        else break;
      }
      const next = slot > fromIndex ? slot - 1 : slot;
      return Math.max(0, Math.min(items.length - 1, next));
    };

    const syncDropTarget = clientY => {
      const st = dragRef.current;
      const listEl = listRef.current;
      if (!st || !listEl) return;
      st.currentY = clientY;
      if (!st.active) {
        if (Math.abs(clientY - st.startY) < 4) return;
        const items = listEl.querySelectorAll('.queue-item');
        const srcEl = items[st.fromIndex];
        if (!srcEl) return;
        const srcRect = srcEl.getBoundingClientRect();
        const step =
          items.length > 1
            ? Math.max(srcRect.height, items[1].offsetTop - items[0].offsetTop)
            : srcRect.height + 6;
        st.active = true;
        st.left = srcRect.left;
        st.width = srcRect.width;
        st.height = srcRect.height;
        st.rowStep = step || 58;
        st.pointerOffsetY = st.startY - srcRect.top;
      }

      const listRect = listEl.getBoundingClientRect();
      const rawTop = clientY - st.pointerOffsetY;
      const clampedTop = Math.max(
        listRect.top - 10,
        Math.min(listRect.bottom - st.height + 10, rawTop)
      );
      st.top = clampedTop;
      if (ghostRef.current) {
        ghostRef.current.style.transform = `translate3d(0, ${clampedTop}px, 0) scale(1.02)`;
      }

      const targetIndex = resolveTargetIndex(clientY, st.fromIndex);
      if (!st.uiActive || st.targetIndex !== targetIndex) {
        st.targetIndex = targetIndex;
        st.uiActive = true;
        setDragUi({
          fromIndex: st.fromIndex,
          targetIndex,
          rowStep: st.rowStep,
          left: st.left,
          width: st.width,
          height: st.height,
          initialTop: clampedTop,
          track: tracksRef.current[st.fromIndex] || null,
        });
      }
    };

    const tickAutoScroll = () => {
      const st = dragRef.current;
      const listEl = listRef.current;
      if (!st || !st.active || !listEl) {
        scrollRafRef.current = null;
        return;
      }
      const rect = listEl.getBoundingClientRect();
      const edge = 44;
      let delta = 0;
      if (st.currentY < rect.top + edge) {
        delta = -Math.ceil(((rect.top + edge - st.currentY) / edge) * 10);
      } else if (st.currentY > rect.bottom - edge) {
        delta = Math.ceil(((st.currentY - (rect.bottom - edge)) / edge) * 10);
      }
      if (delta !== 0) {
        listEl.scrollTop += delta;
        syncDropTarget(st.currentY);
      }
      scrollRafRef.current = globalThis.requestAnimationFrame(tickAutoScroll);
    };

    const onPointerMove = e => {
      const st = dragRef.current;
      if (!st || (st.pointerId != null && e.pointerId != null && e.pointerId !== st.pointerId)) return;
      syncDropTarget(e.clientY);
      if (
        st.active &&
        scrollRafRef.current == null &&
        typeof globalThis.requestAnimationFrame === 'function'
      ) {
        scrollRafRef.current = globalThis.requestAnimationFrame(tickAutoScroll);
      }
    };

    const onPointerEnd = e => {
      const st = dragRef.current;
      if (!st || (st.pointerId != null && e.pointerId != null && e.pointerId !== st.pointerId)) return;
      const shouldCommit = st.active && Number.isInteger(st.targetIndex);
      const fromIndex = st.fromIndex;
      const toIndex = st.targetIndex;
      stopDrag();
      if (shouldCommit && toIndex !== fromIndex) {
        reorderAction?.(fromIndex, toIndex);
      }
    };

    const onKeyDown = e => {
      if (e.key === 'Escape' && dragRef.current) {
        e.preventDefault();
        e.stopPropagation();
        stopDrag();
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerEnd);
    window.addEventListener('pointercancel', onPointerEnd);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerEnd);
      window.removeEventListener('pointercancel', onPointerEnd);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [canReorder, reorderAction]);

  if (!rendered) return null;

  const focusGripAt = targetIdx => {
    if (typeof globalThis.requestAnimationFrame !== 'function') return;
    globalThis.requestAnimationFrame(() => {
      const grips = listRef.current?.querySelectorAll('.nr-queue-grip');
      grips?.[targetIdx]?.focus();
    });
  };

  return (
    <div
      className={'overlay queue-overlay' + (closing ? ' is-closing' : '')}
      aria-hidden={closing || undefined}
      onClick={() => {
        if (closing) return;
        setShowQueue(false);
        setConfirmClear(false);
      }}
    >
      <div
        className="dialog queue-dialog"
        role={closing ? undefined : 'dialog'}
        aria-modal={closing ? undefined : 'true'}
        aria-label={closing ? undefined : '播放队列'}
        aria-labelledby={closing ? undefined : 'queue-heading'}
        onClick={e => e.stopPropagation()}
      >
        <div className="queue-header">
          <h2 id="queue-heading">
            {isMixed
              ? `跨源歌单 · ${mixedQueue.playlistName || '混合队列'}`
              : `${providerLabel(activeProvider)}播放队列`}{' '}
            · {tracks.length} 首
            {tracks.length ? ` · 接下来 ${Math.max(0, tracks.length - activeQueue.index - 1)} 首` : ''}
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

        {!isMixed && song && song.provider !== activeProvider && (
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
            <div className={'queue-list' + (dragUi ? ' is-dragging' : '')} ref={listRef}>
              {tracks.map((track, index) => {
                const current = isMixed
                  ? song?.provider === track.provider &&
                    song?.id === track.id &&
                    activeQueue.index === index
                  : song?.provider === activeProvider &&
                    song?.accountId === track.accountId &&
                    song?.id === track.id &&
                    activeQueue.index === index;
                const picked =
                  selectedTrack?.provider === track.provider &&
                  selectedTrack?.id === track.id &&
                  selectedTrack?.accountId === track.accountId;
                const playNextTarget =
                  !isFm && !current && reorderAction
                    ? computePlayNextTarget(activeQueue?.index ?? -1, index, tracks.length)
                    : -1;
                const isPlaceholder = dragUi?.fromIndex === index;
                let shiftY = 0;
                if (dragUi) {
                  const { fromIndex, targetIndex, rowStep } = dragUi;
                  if (index === fromIndex) {
                    shiftY = (targetIndex - fromIndex) * rowStep;
                  } else if (fromIndex < targetIndex && index > fromIndex && index <= targetIndex) {
                    shiftY = -rowStep;
                  } else if (fromIndex > targetIndex && index >= targetIndex && index < fromIndex) {
                    shiftY = rowStep;
                  }
                }

                return (
                  <div
                    className={
                      'queue-item' +
                      (current ? ' selected' : picked ? ' picked' : '') +
                      (isPlaceholder ? ' is-drag-placeholder' : '')
                    }
                    style={
                      dragUi
                        ? { transform: `translate3d(0, ${shiftY}px, 0)` }
                        : undefined
                    }
                    key={`${track.provider || activeProvider}-${track.id}-${index}`}
                  >
                    {isPlaceholder && (
                      <div className="nr-queue-slot-hint" aria-hidden="true">
                        {dragUi.targetIndex === dragUi.fromIndex
                          ? `当前第 ${dragUi.fromIndex + 1} 位`
                          : `松手移至第 ${dragUi.targetIndex + 1} 位`}
                      </div>
                    )}
                    {!isFm && tracks.length > 1 && reorderAction && (
                      <button
                        type="button"
                        className="nr-queue-grip"
                        disabled={pendingPlay}
                        aria-label={`拖动调整 ${track.name} 顺位`}
                        title="按住上下拖动调序（或用 ↑/↓ 键）"
                        onPointerDown={e => {
                          if (!canReorder || e.button !== 0) return;
                          e.preventDefault();
                          dragRef.current = {
                            fromIndex: index,
                            targetIndex: index,
                            startY: e.clientY,
                            currentY: e.clientY,
                            active: false,
                            uiActive: false,
                            pointerId: e.pointerId,
                          };
                        }}
                        onKeyDown={e => {
                          if (!canReorder) return;
                          if (e.key === 'ArrowUp' && index > 0) {
                            e.preventDefault();
                            e.stopPropagation();
                            reorderAction(index, index - 1);
                            focusGripAt(index - 1);
                          } else if (e.key === 'ArrowDown' && index < tracks.length - 1) {
                            e.preventDefault();
                            e.stopPropagation();
                            reorderAction(index, index + 1);
                            focusGripAt(index + 1);
                          }
                        }}
                      >
                        <Icon name="grip" className="nr-icon is-sm" />
                      </button>
                    )}

                    <button
                      type="button"
                      className="queue-song"
                      onClick={() =>
                        !isMixed && track.provider === 'netease'
                          ? setSelectedTrack({
                              provider: track.provider,
                              id: track.id,
                              accountId: track.accountId,
                            })
                          : play(track, { ...activeQueue, index })
                      }
                      onDoubleClick={() => {
                        if (!isMixed && track.provider === 'netease') play(track, { ...activeQueue, index });
                      }}
                      onKeyDown={e => {
                        if (!isMixed && track.provider === 'netease' && e.key === 'Enter') {
                          e.preventDefault();
                          play(track, { ...activeQueue, index });
                        }
                      }}
                      aria-current={current ? 'true' : undefined}
                    >
                      <span className="nr-queue-title-line">
                        <span>
                          {index + 1}. {track.name}
                        </span>
                        {isMixed && <SourceTag provider={track.provider} />}
                      </span>
                      <small>{artist(track)}</small>
                    </button>

                    {!isFm && (
                      <div className="nr-queue-actions">
                        {playNextTarget >= 0 && (
                          <button
                            type="button"
                            className="nr-play-next-btn"
                            disabled={pendingPlay}
                            aria-disabled={pendingPlay}
                            aria-label={`将 ${track.name} 设为下一首播放`}
                            title="下一首播放"
                            onClick={() => reorderAction(index, playNextTarget)}
                          >
                            <Icon name="playNext" className="nr-icon is-xs" />
                          </button>
                        )}
                        <button
                          type="button"
                          className="nr-remove-btn"
                          disabled={pendingPlay}
                          aria-disabled={pendingPlay}
                          onClick={() => removeAction?.(index)}
                          aria-label={(current ? '移除并停止 ' : '移除 ') + track.name}
                        >
                          {current ? '移除并停止' : '移除'}
                        </button>
                      </div>
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
                <p id="clear-queue-title">
                  {isMixed
                    ? '确定清空当前跨源混合队列？正在播放的歌曲会停止。'
                    : '确定清空此工作区队列？正在播放的本平台歌曲会停止。'}
                </p>
                <div className="nr-confirm-actions">
                  <button
                    type="button"
                    className="nr-danger-btn"
                    disabled={pendingPlay}
                    onClick={() => removeAction?.(null, true)}
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

      {dragUi && dragUi.track && (
        <div
          ref={ghostRef}
          className="nr-queue-drag-ghost"
          aria-hidden="true"
          style={{
            left: `${dragUi.left}px`,
            width: `${dragUi.width}px`,
            height: `${dragUi.height}px`,
            transform: `translate3d(0, ${dragRef.current?.top ?? dragUi.initialTop}px, 0) scale(1.02)`,
          }}
        >
          <span className="nr-queue-grip">
            <Icon name="grip" className="nr-icon is-sm" />
          </span>
          <div className="queue-song">
            <span className="nr-queue-title-line">
              <span>
                {dragUi.fromIndex + 1}. {dragUi.track.name}
              </span>
              {isMixed && <SourceTag provider={dragUi.track.provider} />}
            </span>
            <small>{artist(dragUi.track)}</small>
          </div>
          <span className="nr-drag-ghost-badge">
            {dragUi.targetIndex === dragUi.fromIndex
              ? `第 ${dragUi.fromIndex + 1} 位`
              : `→ 第 ${dragUi.targetIndex + 1} 位`}
          </span>
        </div>
      )}
    </div>
  );
});

export const QqAuthDialog = memo(function QqAuthDialog({ open, busy, message, onComplete, onCancel }) {
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
        <p>请在授权窗口选择 QQ 登录或微信登录，扫码确认并等网页显示已登录后，再回到这里确认。</p>
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
});

export const CloseBehaviorDialog = memo(function CloseBehaviorDialog({
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
        <p>选择以后点击关闭按钮的行为，可在右上角「设置 → 常规与数据」中随时修改。</p>
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
});

export const QrDialog = memo(function QrDialog({ qr, onClose }) {
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
});

export const PlaylistPickerDialog = memo(function PlaylistPickerDialog({
  track,
  playlists,
  customPlaylists = [],
  canNeteaseCollect = false,
  busyId,
  error,
  onSelect,
  onSelectCustom,
  onCreateAndSelectCustom,
  onClose,
}) {
  const [newName, setNewName] = useState('');
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (!track) return;
    setNewName('');
    setLocalError('');
  }, [track]);

  if (!track) return null;

  const trackKey = customTrackKey(track);
  const showNeteaseSection = track.provider === 'netease' && canNeteaseCollect;

  const handleCreateCustom = e => {
    e.preventDefault();
    const res = onCreateAndSelectCustom?.(newName, track);
    if (res?.error) {
      setLocalError(res.error);
      return;
    }
    setLocalError('');
    setNewName('');
  };

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
          <SourceTag provider={track.provider} /> <b>{track.name}</b> · {artist(track) || '未知歌手'}
        </p>
        {(error || localError) && (
          <p className="nr-dialog-error" role="alert">
            {localError || error}
          </p>
        )}

        <div className="nr-picker-section">
          <div className="nr-picker-sec-head">
            <span>本机跨源歌单</span>
            <small>保存在本机 · 不回写原平台</small>
          </div>
          <form className="nr-custom-picker-create" onSubmit={handleCreateCustom}>
            <input
              type="text"
              className="nr-custom-side-input"
              maxLength={40}
              value={newName}
              placeholder="新建本机歌单并加入…"
              aria-label="新建本机歌单并加入"
              onChange={e => {
                setNewName(e.target.value);
                if (localError) setLocalError('');
              }}
            />
            <button type="submit" className="nr-soft-btn">
              新建并加入
            </button>
          </form>
          {customPlaylists.length ? (
            <div className="nr-picker-list is-compact">
              {customPlaylists.map(pl => {
                const alreadyIn = Boolean(
                  trackKey && pl.tracks.some(item => customTrackKey(item) === trackKey)
                );
                return (
                  <button
                    key={pl.id}
                    type="button"
                    className="nr-custom-picker-item"
                    disabled={alreadyIn || busyId != null}
                    onClick={() => onSelectCustom?.(pl.id, track)}
                  >
                    <span className="nr-custom-picker-ico" aria-hidden="true">
                      <Icon name="collection" className="nr-icon is-sm" />
                    </span>
                    <span className="nr-picker-copy">
                      <b>{pl.name}</b>
                      <small>{pl.tracks.length} 首 · 本机跨源</small>
                    </span>
                    <span className="nr-picker-state">{alreadyIn ? '已在歌单' : '加入本机'}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="nr-queue-empty">还没有本机歌单，可在上方直接新建并加入。</p>
          )}
        </div>

        {showNeteaseSection && (
          <div className="nr-picker-section">
            <div className="nr-picker-sec-head">
              <span>网易云线上歌单</span>
              <small>同步至你的网易云账号</small>
            </div>
            {playlists.length ? (
              <div className="nr-picker-list is-compact">
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
        )}
      </div>
    </div>
  );
});

export const GlobalShortcutsDialog = memo(function GlobalShortcutsDialog({
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
});

export const AppUpdateDialog = memo(function AppUpdateDialog({
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
});
