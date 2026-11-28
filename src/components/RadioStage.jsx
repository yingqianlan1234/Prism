import React, { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { artist, album, QUALITY_LABELS, formatBitrate } from '../utils/format.js';
import { SongArtwork, SourceTag, PlayButton } from './Artwork.jsx';
import { Icon } from './Icons.jsx';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const STRIP_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

// 合并后的一体化沉浸舞台：左侧封面波段与曲目控制 + 右侧常驻大字号实时滚动歌词
export const RadioStage = memo(function RadioStage({
  song,
  playing,
  buffering,
  pending,
  activeProvider,
  playingQueue,
  lyricSlot,
  togglePlayback,
  play,
  trackQuality,
  neteaseSignedIn,
  canLike,
  canCollect,
  canTrashFm,
  isLiked,
  likeBusy,
  fmTrashBusy,
  fmError,
  fmStageFocus = false,
  onRetryFm,
  onToggleLike,
  onOpenPlaylistPicker,
  onTrashFm,
}) {
  const tracks = playingQueue?.tracks || [];
  const curIdx = playingQueue && song ? playingQueue.index : -1;
  const songKey = song ? `${song.provider}:${song.id}` : 'empty';

  // 根据前后曲目切换索引推导过渡方向，不重挂载外层播控按钮以免丢失焦点
  const prevTrackRef = useRef({ songKey, index: curIdx });
  let dir = 'same';
  if (prevTrackRef.current.songKey !== songKey) {
    if (prevTrackRef.current.index >= 0 && curIdx >= 0 && curIdx < prevTrackRef.current.index) {
      dir = 'prev';
    } else {
      dir = 'next';
    }
  }
  useEffect(() => {
    prevTrackRef.current = { songKey, index: curIdx };
  }, [songKey, curIdx]);

  const prev2 = curIdx >= 2 ? tracks[curIdx - 2] : null;
  const prev1 = curIdx >= 1 ? tracks[curIdx - 1] : null;
  const next1 = curIdx >= 0 && curIdx + 1 < tracks.length ? tracks[curIdx + 1] : null;

  // 取当前队列前后最多 5 首歌组成待播波段横轨
  let waveSlice = [];
  const start =
    tracks.length && curIdx >= 0
      ? Math.max(0, Math.min(curIdx - 1, Math.max(0, tracks.length - 5)))
      : 0;
  if (tracks.length && curIdx >= 0) {
    waveSlice = tracks.slice(start, start + 5).map((t, offset) => ({
      track: t,
      index: start + offset,
      isCurrent: start + offset === curIdx,
      itemKey: `${t.provider || ''}:${t.id}:${start + offset}`,
    }));
  }
  const waveSliceKey = waveSlice.map(item => item.itemKey).join('|');

  const stripCardsRef = useRef(null);
  const pillNodesRef = useRef(new Map());
  const pillAnimsRef = useRef(new Map());
  const prevWaveRef = useRef({ start: -1, curIdx: -1, items: [], rects: new Map(), stride: 0 });
  const exitTimerRef = useRef(null);
  const [exitingPills, setExitingPills] = useState([]);

  useLayoutEffect(() => {
    const container = stripCardsRef.current;
    if (!container || !waveSlice.length) {
      for (const anim of pillAnimsRef.current.values()) {
        try {
          anim.cancel();
        } catch {}
      }
      pillAnimsRef.current.clear();
      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
      prevWaveRef.current = { start: -1, curIdx: -1, items: [], rects: new Map(), stride: 0 };
      setExitingPills([]);
      return;
    }

    const prev = prevWaveRef.current;
    const reduced = prefersReducedMotion();
    const containerRect = container.getBoundingClientRect?.();

    // 连点切歌时先捕获仍在动画中的卡片当前实时横向位置，避免动画跳回
    if (containerRect && containerRect.width > 0) {
      for (const [key, anim] of pillAnimsRef.current.entries()) {
        const node = pillNodesRef.current.get(key);
        const old = prev.rects.get(key);
        if (node && old && anim?.playState === 'running') {
          const liveRect = node.getBoundingClientRect();
          prev.rects.set(key, {
            ...old,
            left: liveRect.left - containerRect.left,
          });
        }
      }
    }

    for (const anim of pillAnimsRef.current.values()) {
      try {
        anim.cancel();
      } catch {}
    }
    pillAnimsRef.current.clear();

    const newRects = new Map();
    const orderedRects = [];
    for (const item of waveSlice) {
      const el = pillNodesRef.current.get(item.itemKey);
      if (!el) continue;
      const rect = {
        left: el.offsetLeft,
        top: el.offsetTop,
        width: el.offsetWidth,
        height: el.offsetHeight,
      };
      newRects.set(item.itemKey, rect);
      if (rect.width > 0) orderedRects.push(rect);
    }

    const stride =
      orderedRects.length >= 2
        ? orderedRects[1].left - orderedRects[0].left
        : orderedRects.length === 1
          ? orderedRects[0].width + 12
          : prev.stride || 0;

    if (exitTimerRef.current) {
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }

    const currentKeySet = new Set(waveSlice.map(item => item.itemKey));
    const overlapCount = prev.items.filter(item => currentKeySet.has(item.itemKey)).length;
    const shift = prev.start >= 0 ? start - prev.start : 0;
    const sameTrackShift = overlapCount > 0 && Math.abs(shift) > 0 && Math.abs(shift) < 5;
    const sameWindowSwitch =
      overlapCount === waveSlice.length &&
      shift === 0 &&
      prev.curIdx >= 0 &&
      curIdx !== prev.curIdx;

    if (!reduced && prev.items.length > 0) {
      if (sameTrackShift && stride > 0) {
        // 分支 A：轨道整体推进 1~4 格（兼容普通切歌和私人 FM 续杯导致的窗口左移居中）
        const trackDx = shift * stride;
        const duration = Math.min(420, 300 + Math.abs(shift) * 35);

        for (const item of waveSlice) {
          const el = pillNodesRef.current.get(item.itemKey);
          const newRect = newRects.get(item.itemKey);
          if (!el || !newRect || newRect.width <= 0 || typeof el.animate !== 'function') continue;

          const oldRect = prev.rects.get(item.itemKey);
          if (oldRect && oldRect.width > 0) {
            const dx = oldRect.left - newRect.left;
            if (Math.abs(dx) > 1) {
              const anim = el.animate(
                [{ transform: `translate3d(${dx}px, 0, 0)` }, { transform: 'translate3d(0, 0, 0)' }],
                { duration, easing: STRIP_EASING }
              );
              pillAnimsRef.current.set(item.itemKey, anim);
              const cleanup = () => {
                if (pillAnimsRef.current.get(item.itemKey) === anim) {
                  pillAnimsRef.current.delete(item.itemKey);
                }
              };
              anim.onfinish = cleanup;
              anim.oncancel = cleanup;
            }
          } else {
            const anim = el.animate(
              [
                { opacity: 0.25, transform: `translate3d(${trackDx}px, 0, 0)` },
                { opacity: 1, transform: 'translate3d(0, 0, 0)' },
              ],
              { duration, easing: STRIP_EASING }
            );
            pillAnimsRef.current.set(item.itemKey, anim);
            const cleanup = () => {
              if (pillAnimsRef.current.get(item.itemKey) === anim) {
                pillAnimsRef.current.delete(item.itemKey);
              }
            };
            anim.onfinish = cleanup;
            anim.oncancel = cleanup;
          }
        }

        const exits = [];
        for (const item of prev.items) {
          if (currentKeySet.has(item.itemKey)) continue;
          const oldRect = prev.rects.get(item.itemKey);
          if (!oldRect || oldRect.width <= 0) continue;
          exits.push({
            key: `${item.itemKey}-${Date.now()}`,
            track: item.track,
            left: oldRect.left,
            top: oldRect.top,
            width: oldRect.width,
            height: oldRect.height,
            exitX: -trackDx,
            duration,
          });
        }
        setExitingPills(exits);
        if (exits.length > 0) {
          exitTimerRef.current = setTimeout(() => {
            exitTimerRef.current = null;
            setExitingPills([]);
          }, duration + 20);
        }
      } else if (sameWindowSwitch) {
        // 分支 B：轨道未滚动，仅切换高亮槽位（由卡片自身柔和点亮 + 轻巧落位微反馈）
        setExitingPills([]);
        const newActiveItem = waveSlice.find(item => item.isCurrent);
        const el = newActiveItem ? pillNodesRef.current.get(newActiveItem.itemKey) : null;
        if (el && el.offsetWidth > 0 && typeof el.animate === 'function') {
          const anim = el.animate(
            [{ transform: 'scale(0.975)' }, { transform: 'scale(1)' }],
            { duration: 240, easing: STRIP_EASING }
          );
          pillAnimsRef.current.set(newActiveItem.itemKey, anim);
          const cleanup = () => {
            if (pillAnimsRef.current.get(newActiveItem.itemKey) === anim) {
              pillAnimsRef.current.delete(newActiveItem.itemKey);
            }
          };
          anim.onfinish = cleanup;
          anim.oncancel = cleanup;
        }
      } else if (overlapCount === 0 && dir !== 'same') {
        // 分支 C：跨度 >= 5 格或切换了全新队列
        setExitingPills([]);
        const shiftX = dir === 'prev' ? -24 : 24;
        for (const item of waveSlice) {
          const el = pillNodesRef.current.get(item.itemKey);
          const newRect = newRects.get(item.itemKey);
          if (!el || !newRect || newRect.width <= 0 || typeof el.animate !== 'function') continue;
          const anim = el.animate(
            [
              { opacity: 0.35, transform: `translate3d(${shiftX}px, 0, 0)` },
              { opacity: 1, transform: 'translate3d(0, 0, 0)' },
            ],
            { duration: 220, easing: STRIP_EASING }
          );
          pillAnimsRef.current.set(item.itemKey, anim);
          const cleanup = () => {
            if (pillAnimsRef.current.get(item.itemKey) === anim) {
              pillAnimsRef.current.delete(item.itemKey);
            }
          };
          anim.onfinish = cleanup;
          anim.oncancel = cleanup;
        }
      } else {
        setExitingPills([]);
      }
    } else if (reduced || prev.items.length === 0) {
      setExitingPills([]);
    }

    prevWaveRef.current = { start, curIdx, items: waveSlice, rects: newRects, stride };
  }, [waveSliceKey, curIdx]);

  useEffect(
    () => () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
      for (const anim of pillAnimsRef.current.values()) {
        try {
          anim.cancel();
        } catch {}
      }
      pillAnimsRef.current.clear();
    },
    []
  );

  const albumName = song ? album(song).name : '';
  const showNeteaseActions = neteaseSignedIn && song?.provider === 'netease';
  const qualityText =
    song?.provider === 'netease' && trackQuality?.level
      ? QUALITY_LABELS[trackQuality.level] || trackQuality.level
      : '';
  const bitrateText =
    song?.provider === 'netease' && trackQuality?.br ? formatBitrate(trackQuality.br) : '';

  return (
    <section
      className="lw-stage nr-radio-stage is-unified"
      aria-label="正在播放与歌词"
    >
      <div className="nr-radio-center">
        {/* 左侧：横向错落封面电台波段 + 曲目信息 */}
        <div className="nr-stage-deck">
          <div className="nr-cover-wave">
            {prev2 && (
              <button
                type="button"
                className="nr-wave-card is-prev-2"
                aria-label={`切换到 ${prev2.name}`}
                onClick={() => play(prev2, { ...playingQueue, index: curIdx - 2 })}
              >
                <span key={`${prev2.provider || ''}:${prev2.id}`} className="nr-wave-card-inner" data-dir={dir}>
                  <SongArtwork song={prev2} size={240} className="nr-wave-img" />
                </span>
              </button>
            )}
            {prev1 && (
              <button
                type="button"
                className="nr-wave-card is-prev-1"
                aria-label={`上一首：${prev1.name}`}
                onClick={() => play(prev1, { ...playingQueue, index: curIdx - 1 })}
              >
                <span key={`${prev1.provider || ''}:${prev1.id}`} className="nr-wave-card-inner" data-dir={dir}>
                  <SongArtwork song={prev1} size={320} className="nr-wave-img" />
                </span>
              </button>
            )}
            {next1 && (
              <button
                type="button"
                className="nr-wave-card is-next-1"
                aria-label={`下一首：${next1.name}`}
                onClick={() => play(next1, { ...playingQueue, index: curIdx + 1 })}
              >
                <span key={`${next1.provider || ''}:${next1.id}`} className="nr-wave-card-inner" data-dir={dir}>
                  <SongArtwork song={next1} size={320} className="nr-wave-img" />
                </span>
              </button>
            )}

            <span className="nr-stage-halo" aria-hidden="true" />
            <div className="lw-stage-cover nr-wave-now">
              <div key={songKey} className="nr-wave-art-frame" data-dir={dir}>
                <SongArtwork song={song} size={800} className="lw-stage-image" variant="stage" />
              </div>
              <PlayButton
                playing={playing}
                buffering={buffering}
                pending={pending}
                onClick={togglePlayback}
                disabled={!song}
                size="lg"
              />
            </div>

            <div className="nr-wave-caption">
              <span className="lw-stage-source">
                {song ? (
                  <>
                    <SourceTag provider={song.provider} browsing={activeProvider} />
                    {playingQueue?.type === 'fm' && <span className="nr-fm-chip">私人 FM</span>}
                    {qualityText && (
                      <span
                        className="nr-quality-chip"
                        title={bitrateText ? `${qualityText} · ${bitrateText}` : qualityText}
                      >
                        {qualityText}
                      </span>
                    )}
                    {trackQuality?.isTrial && song?.provider === 'netease' && (
                      <span className="nr-trial-chip" title="当前播放为试听片段">
                        试听
                      </span>
                    )}
                  </>
                ) : (
                  '尚未播放'
                )}
              </span>
              {tracks.length > 0 && curIdx >= 0 && (
                <span className="nr-wave-pos">
                  {String(curIdx + 1).padStart(2, '0')} / {String(tracks.length).padStart(2, '0')}
                </span>
              )}
            </div>
          </div>

          <div className="lw-stage-info nr-stage-info">
            <div key={songKey} className="nr-stage-heading" data-dir={dir}>
              <div className="nr-stage-title-row">
                <h1>{song?.name || '从一首歌开始'}</h1>
                {song && ((showNeteaseActions && (canLike || canTrashFm)) || canCollect) && (
                  <div className="nr-stage-actions">
                    {showNeteaseActions && canLike && (
                      <button
                        type="button"
                        className={'nr-stage-act-btn nr-heart-btn' + (isLiked ? ' is-liked' : '')}
                        aria-label={isLiked ? '取消喜欢' : '喜欢这首歌'}
                        aria-pressed={isLiked}
                        title={isLiked ? '取消喜欢' : '喜欢'}
                        disabled={likeBusy}
                        onClick={onToggleLike}
                      >
                        <Icon name={isLiked ? 'heartFill' : 'heart'} className="nr-icon is-sm" />
                      </button>
                    )}
                    {canCollect && (
                      <button
                        type="button"
                        className="nr-stage-act-btn"
                        aria-label="收藏到歌单"
                        title="收藏到歌单"
                        onClick={onOpenPlaylistPicker}
                      >
                        <Icon name="plus" className="nr-icon is-sm" />
                      </button>
                    )}
                    {showNeteaseActions && canTrashFm && (
                      <button
                        type="button"
                        className="nr-stage-act-btn nr-dislike-btn"
                        aria-label="私人 FM 不喜欢并跳过"
                        title="不喜欢并跳过"
                        disabled={fmTrashBusy}
                        onClick={onTrashFm}
                      >
                        <Icon name="dislike" className="nr-icon is-sm" />
                      </button>
                    )}
                  </div>
                )}
              </div>
              <p>
                {song
                  ? [artist(song), albumName].filter(Boolean).join(' · ')
                  : '选择一首歌，拨通今晚的电台'}
              </p>
            </div>

            {(playingQueue?.type === 'fm' || fmStageFocus || !song) && fmError && (
              <div className="nr-stage-fm-alert" role="alert">
                <span>{fmError}</span>
                <button type="button" className="nr-soft-btn" onClick={onRetryFm}>
                  重试私人 FM
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 右侧：常驻完整大歌词 */}
        <div className="nr-stage-lyric-pane">{lyricSlot}</div>
      </div>

      {/* 底部待播波段横轨 */}
      {waveSlice.length > 0 && (
        <div className="nr-upnext-strip" aria-label="当前波段曲目">
          <div className="nr-strip-label">
            <span>当前波段 · {playingQueue?.type === 'fm' ? '私人 FM 推荐流' : '播放队列'}</span>
            <span>点击任意卡片直接切歌</span>
          </div>
          <div className="nr-strip-viewport">
            {exitingPills.length > 0 && (
              <div className="nr-strip-exiting-layer" aria-hidden="true">
                {exitingPills.map(item => (
                  <div
                    key={item.key}
                    className="nr-next-pill is-exiting"
                    style={{
                      left: `${item.left}px`,
                      top: `${item.top}px`,
                      width: `${item.width}px`,
                      height: `${item.height}px`,
                      '--nr-exit-x': `${item.exitX}px`,
                      '--nr-exit-dur': `${item.duration}ms`,
                    }}
                  >
                    <SongArtwork song={item.track} size={80} className="nr-next-thumb" />
                    <span className="nr-next-txt">
                      <b>{item.track.name}</b>
                      <small>{artist(item.track)}</small>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div ref={stripCardsRef} className="nr-strip-cards">
              {waveSlice.map(({ track, index, isCurrent, itemKey }) => (
                <button
                  key={itemKey}
                  ref={node => {
                    if (node) pillNodesRef.current.set(itemKey, node);
                    else pillNodesRef.current.delete(itemKey);
                  }}
                  type="button"
                  className={'nr-next-pill' + (isCurrent ? ' is-active' : '')}
                  aria-current={isCurrent ? 'true' : undefined}
                  onClick={() => play(track, { ...playingQueue, index })}
                >
                  <SongArtwork song={track} size={80} className="nr-next-thumb" />
                  <span className="nr-next-txt">
                    <b title={track.name}>{track.name}</b>
                    <small title={artist(track)}>{artist(track)}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
});
