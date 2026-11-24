import React from 'react';
import { artist, QUALITY_LABELS, formatBitrate } from '../utils/format.js';
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
  showLyrics,
  onToggleLyrics,
  onOpenLyrics,
  showMore,
  onToggleMore,
  playbackRate,
  sleepLabel,
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
  const modeText = MODE_LABELS[mode] || '顺序播放';
  const showNeteaseActions = neteaseSignedIn && song?.provider === 'netease';
  const qualityText =
    song?.provider === 'netease' && trackQuality?.level
      ? QUALITY_LABELS[trackQuality.level] || trackQuality.level
      : '';
  const bitrateText =
    song?.provider === 'netease' && trackQuality?.br ? formatBitrate(trackQuality.br) : '';

  const currentTrackBlock = (
    <div className="current">
      <button
        type="button"
        className="nr-current-trigger"
        aria-label={song ? `打开 ${song.name} 的歌词` : '打开歌词'}
        title={song ? '点击跳转到歌词' : undefined}
        disabled={!song}
        onClick={onOpenLyrics}
      >
        <span className="nr-cover-wrap">
          <SongArtwork song={song} size={100} className="cover" />
          <span className="nr-cover-hint" aria-hidden="true">
            <Icon name="lyrics" className="nr-icon is-xs" />
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
      variant={view === 'stage' ? 'stage' : 'bar'}
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
      {qualityText && trackQuality?.level !== 'standard' && (
        <span
          className="nr-status-chip nr-quality-chip"
          title={bitrateText ? `${qualityText} · ${bitrateText}` : qualityText}
        >
          {qualityText}
        </span>
      )}
      {playbackRate !== 1 && (
        <span className="nr-status-chip" title="当前播放倍速">
          {playbackRate}×
        </span>
      )}
      {sleepLabel && (
        <span className="nr-status-chip is-sleep" title="睡眠定时已开启">
          <Icon name="moon" className="nr-icon is-xs" />
          {sleepLabel}
        </span>
      )}
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
      <button
        type="button"
        className={'lw-icon-btn tool' + (showLyrics ? ' is-active' : '')}
        aria-label={showLyrics ? '收起歌词' : '歌词'}
        title={showLyrics ? '收起歌词' : '歌词'}
        onClick={onToggleLyrics}
      >
        <Icon name="lyrics" />
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
      <button
        type="button"
        className={'lw-icon-btn tool nr-settings-btn' + (showMore ? ' is-active' : '')}
        aria-label="更多设置"
        title="更多设置"
        aria-expanded={showMore}
        aria-controls="lw-more-panel"
        onClick={onToggleMore}
      >
        <Icon name="settings" />
      </button>
    </div>
  );

  if (view === 'library') {
    return (
      <footer className="nr-dock-shell">
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
    <div className="lw-stage-controls nr-dock-shell is-stage" role="region" aria-label="舞台播放控制">
      <div className="nr-dock-island is-stage">
        <div className="lw-stage-tools">
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
          {auxBlock}
        </div>
      </div>
    </div>
  );
}
