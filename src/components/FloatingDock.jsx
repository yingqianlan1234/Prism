import React, { useEffect, useRef, useState } from 'react';
import { artist, NETEASE_QUALITIES, QUALITY_LABELS, formatBitrate } from '../utils/format.js';
import { SongArtwork, SourceTag, PlayButton } from './Artwork.jsx';
import { PlaybackProgress } from './PlaybackProgress.jsx';
import { Icon } from './Icons.jsx';

const MODE_LABELS = {
  sequential: '顺序播放',
  'list-loop': '列表循环',
  'repeat-one': '单曲循环',
  shuffle: '随机播放',
};

const MODE_ICONS = {
  sequential: 'modeSequential',
  'list-loop': 'modeLoop',
  'repeat-one': 'modeRepeatOne',
  shuffle: 'modeShuffle',
};

const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2];
const SLEEP_OPTIONS = [
  { id: 'off', label: '关' },
  { id: '15', label: '15 分' },
  { id: '30', label: '30 分' },
  { id: '60', label: '60 分' },
  { id: 'track', label: '播完本首' },
];

export function FloatingDock({
  view,
  song,
  playing,
  buffering,
  pending,
  activeProvider,
  audio,
  restoredProgress,
  onSeek,
  onSeekEnd,
  skipTrack,
  togglePlayback,
  mode,
  onCycleMode,
  muted,
  volume,
  onToggleMute,
  onVolumeChange,
  onVolumeCommit,
  onOpenQueue,
  onToggleStage,
  playbackRate,
  onChangeRate,
  sleepMode,
  sleepLabel,
  onSelectSleep,
  canSelectQuality,
  neteaseQuality,
  onChangeQuality,
  onReloadWithQuality,
  queueCount,
  trackQuality,
  neteaseSignedIn,
  canLike,
  canTrashFm,
  isLiked,
  likeBusy,
  fmTrashBusy,
  onToggleLike,
  onTrashFm,
  canDesktopLyric,
  desktopLyricEnabled,
  desktopLyricLocked,
  desktopLyricBusy,
  onToggleDesktopLyric,
  onToggleDesktopLyricLock,
}) {
  const [openPopover, setOpenPopover] = useState(null); // null | 'quality' | 'tempo'
  const dockRef = useRef(null);

  useEffect(() => {
    if (!openPopover) return undefined;
    const onPointerDown = e => {
      if (dockRef.current && !dockRef.current.contains(e.target)) {
        setOpenPopover(null);
      }
    };
    const onKeyDown = e => {
      if (e.key === 'Escape') {
        setOpenPopover(null);
        e.stopPropagation();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openPopover]);

  const modeText = MODE_LABELS[mode] || '顺序播放';
  const showNeteaseActions = neteaseSignedIn && song?.provider === 'netease';
  const qualityText =
    song?.provider === 'netease' && trackQuality?.level
      ? QUALITY_LABELS[trackQuality.level] || trackQuality.level
      : QUALITY_LABELS[neteaseQuality] || '标准';
  const bitrateText =
    song?.provider === 'netease' && trackQuality?.br ? formatBitrate(trackQuality.br) : '';
  const showQualityChip =
    canSelectQuality && (song?.provider === 'netease' || activeProvider === 'netease');
  const canReloadQuality =
    canSelectQuality &&
    song?.provider === 'netease' &&
    trackQuality?.level &&
    trackQuality.level !== neteaseQuality;
  const tempoActive = playbackRate !== 1 || Boolean(sleepLabel);

  const inStage = view === 'stage';

  const currentTrackBlock = (
    <div className="current">
      <button
        type="button"
        className={'nr-current-trigger' + (inStage ? ' is-in-stage' : '')}
        aria-label={
          inStage
            ? '收起正在播放与歌词'
            : song
              ? `打开 ${song.name} 的播放舞台与歌词`
              : '打开播放舞台与歌词'
        }
        title={inStage ? '点击收起返回曲库' : song ? '点击展开正在播放与歌词' : undefined}
        disabled={!song && !inStage}
        onClick={onToggleStage}
      >
        <span className="nr-cover-wrap">
          <SongArtwork song={song} size={100} className="cover" />
          <span className="nr-cover-hint" aria-hidden="true">
            <Icon name={inStage ? 'chevronDown' : 'lyrics'} className="nr-icon is-xs" />
          </span>
        </span>
        <span className="nr-current-copy">
          <b title={song?.name || ''}>{song?.name || '还没有播放歌曲'}</b>
          <small>
            {song ? (
              <>
                <SourceTag provider={song.provider} browsing={activeProvider} /> · {artist(song)}
              </>
            ) : (
              '选一首歌，开始聆听'
            )}
          </small>
        </span>
      </button>
      {showNeteaseActions && canLike && (
        <div className="nr-dock-track-actions">
          <button
            type="button"
            className={'lw-icon-btn tool nr-heart-btn' + (isLiked ? ' is-liked' : '')}
            aria-label={isLiked ? '取消喜欢' : '喜欢当前歌曲'}
            aria-pressed={isLiked}
            title={isLiked ? '取消喜欢' : '喜欢'}
            disabled={likeBusy}
            onClick={onToggleLike}
          >
            <Icon name={isLiked ? 'heartFill' : 'heart'} className="nr-icon is-sm" />
          </button>
          {canTrashFm && (
            <button
              type="button"
              className="lw-icon-btn tool nr-dislike-btn"
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
  );

  const progressBlock = (
    <PlaybackProgress
      key={view}
      variant={inStage ? 'stage' : 'bar'}
      audio={audio}
      restored={restoredProgress}
      onSeekEnd={onSeekEnd}
      onSeek={onSeek}
    />
  );

  const auxBlock = (
    <div className="footer-right">
      {trackQuality?.isTrial && song?.provider === 'netease' && (
        <span className="nr-status-chip nr-trial-chip" title="当前播放为试听片段">
          试听
        </span>
      )}
      {showQualityChip && (
        <button
          type="button"
          className={
            'nr-status-chip nr-quality-btn' + (openPopover === 'quality' ? ' is-active' : '')
          }
          aria-label={`网易云音质：${qualityText}，点击切换`}
          aria-expanded={openPopover === 'quality'}
          title={bitrateText ? `${qualityText} · ${bitrateText}（点击切换）` : `音质：${qualityText}（点击切换）`}
          onClick={() => setOpenPopover(v => (v === 'quality' ? null : 'quality'))}
        >
          {qualityText}
        </button>
      )}
      <button
        type="button"
        className={
          'lw-icon-btn tool nr-tempo-btn' +
          (tempoActive || openPopover === 'tempo' ? ' is-active' : '')
        }
        aria-label="倍速与睡眠定时"
        aria-expanded={openPopover === 'tempo'}
        title={
          tempoActive
            ? `倍速 ${playbackRate}×${sleepLabel ? ` · 定时 ${sleepLabel}` : ''}`
            : '倍速与睡眠定时'
        }
        onClick={() => setOpenPopover(v => (v === 'tempo' ? null : 'tempo'))}
      >
        <Icon name="timer" />
        {tempoActive && (
          <span className="nr-tempo-badge" aria-hidden="true">
            {sleepLabel || `${playbackRate}×`}
          </span>
        )}
      </button>
      <button
        type="button"
        className={'lw-icon-btn tool nr-mode-btn' + (mode !== 'sequential' ? ' is-nondefault' : '')}
        aria-label={'播放模式：' + modeText}
        title={'播放模式：' + modeText}
        onClick={onCycleMode}
      >
        <Icon name={MODE_ICONS[mode] || 'modeSequential'} />
        <span className="sr-only">{modeText}</span>
        <span className="lw-dot" data-on={mode === 'sequential' ? 'false' : 'true'} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="lw-icon-btn tool"
        aria-label={muted ? '取消静音' : '静音'}
        title={muted ? '取消静音' : '静音'}
        onClick={onToggleMute}
      >
        <Icon name={muted || volume <= 0 ? 'mute' : volume < 0.5 ? 'volumeLow' : 'volume'} />
        <span className="sr-only">{muted ? '已静音' : '音量'}</span>
      </button>
      <input
        className="nr-volume-slider"
        aria-label="音量"
        type="range"
        min="0"
        max="1"
        step="0.05"
        style={{ '--nr-v': `${muted ? 0 : volume * 100}%` }}
        value={volume}
        onChange={e => onVolumeChange(Number(e.target.value))}
        onPointerUp={onVolumeCommit}
      />
      <button
        type="button"
        className="lw-icon-btn tool nr-queue-chip"
        aria-label="打开播放队列"
        title="播放队列"
        onClick={onOpenQueue}
      >
        <Icon name="queue" />
        {queueCount > 0 && <span className="nr-queue-num" aria-hidden="true">{queueCount}</span>}
      </button>
      {canDesktopLyric && (
        <button
          type="button"
          className={'lw-icon-btn tool nr-dlyric-btn' + (desktopLyricEnabled ? ' is-active' : '')}
          aria-label={desktopLyricEnabled ? '关闭桌面歌词' : '开启桌面歌词'}
          aria-pressed={desktopLyricEnabled}
          title={
            desktopLyricEnabled
              ? desktopLyricLocked
                ? '桌面歌词已开启（已锁定穿透）'
                : '关闭桌面歌词'
              : '开启桌面歌词'
          }
          disabled={desktopLyricBusy}
          onClick={onToggleDesktopLyric}
        >
          <Icon name="desktopLyric" />
          <span
            className="lw-dot"
            data-on={desktopLyricEnabled ? 'true' : 'false'}
            aria-hidden="true"
          />
        </button>
      )}
      {canDesktopLyric && desktopLyricEnabled && desktopLyricLocked && (
        <button
          type="button"
          className="lw-icon-btn tool nr-dlyric-unlock is-active"
          aria-label="解除桌面歌词锁定"
          title="桌面歌词已锁定穿透，点击解除锁定"
          disabled={desktopLyricBusy}
          onClick={onToggleDesktopLyricLock}
        >
          <Icon name="lock" className="nr-icon is-sm" />
        </button>
      )}
    </div>
  );

  const popoverNode = openPopover && (
    <div
      className="nr-mini-popover"
      role="dialog"
      aria-label={openPopover === 'quality' ? '音质快捷切换' : '倍速与睡眠定时'}
    >
      {openPopover === 'quality' && showQualityChip && (
        <div className="nr-more-group">
          <div className="nr-more-label-row">
            <span className="nr-more-label">网易云默认音质</span>
            {song?.provider === 'netease' && trackQuality?.level && (
              <span className="nr-more-sub">
                当前播放：{QUALITY_LABELS[trackQuality.level] || trackQuality.level}
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
            <button
              type="button"
              className="nr-more-reload"
              onClick={() => {
                setOpenPopover(null);
                onReloadWithQuality?.();
              }}
            >
              按当前音质重载本首
            </button>
          )}
        </div>
      )}

      {openPopover === 'tempo' && (
        <>
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
        </>
      )}
    </div>
  );

  if (!inStage) {
    return (
      <footer ref={dockRef} className="nr-dock-shell">
        {popoverNode}
        <div className="nr-dock-island">
          {currentTrackBlock}
          <div className="player">
            <div className="nr-transport-keys">
              <button
                type="button"
                className="lw-icon-btn transport is-prev"
                aria-label="上一首"
                title="上一首"
                onClick={() => skipTrack(-1)}
              >
                <Icon name="prev" />
              </button>
              <PlayButton
                playing={playing}
                buffering={buffering}
                pending={pending}
                onClick={togglePlayback}
                disabled={!song}
                size="md"
              />
              <button
                type="button"
                className="lw-icon-btn transport is-next"
                aria-label="下一首"
                title="下一首"
                onClick={() => skipTrack(1)}
              >
                <Icon name="next" />
              </button>
            </div>
            {progressBlock}
          </div>
          {auxBlock}
        </div>
      </footer>
    );
  }

  return (
    <div ref={dockRef} className="lw-stage-controls nr-dock-shell is-stage" role="region" aria-label="舞台播放控制">
      {popoverNode}
      <div className="nr-dock-island is-stage">
        <div className="lw-stage-tools">
          {currentTrackBlock}
          <div className="player is-stage">
            <div className="nr-transport-keys">
              <button
                type="button"
                className="lw-icon-btn transport is-prev"
                aria-label="上一首"
                title="上一首"
                onClick={() => skipTrack(-1)}
              >
                <Icon name="prev" />
              </button>
              <button
                type="button"
                className="lw-icon-btn transport is-next"
                aria-label="下一首"
                title="下一首"
                onClick={() => skipTrack(1)}
              >
                <Icon name="next" />
              </button>
            </div>
            {progressBlock}
          </div>
          {auxBlock}
        </div>
      </div>
    </div>
  );
}
