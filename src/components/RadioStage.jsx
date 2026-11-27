import React, { useEffect, useRef } from 'react';
import { artist, album, QUALITY_LABELS, formatBitrate } from '../utils/format.js';
import { SongArtwork, SourceTag, PlayButton } from './Artwork.jsx';
import { Icon } from './Icons.jsx';

// 合并后的一体化沉浸舞台：左侧封面波段与曲目控制 + 右侧常驻大字号实时滚动歌词
export function RadioStage({
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
  if (tracks.length && curIdx >= 0) {
    const start = Math.max(0, Math.min(curIdx - 1, Math.max(0, tracks.length - 5)));
    waveSlice = tracks.slice(start, start + 5).map((t, offset) => ({
      track: t,
      index: start + offset,
      isCurrent: start + offset === curIdx,
    }));
  }

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
                <SongArtwork song={prev2} size={240} className="nr-wave-img" />
              </button>
            )}
            {prev1 && (
              <button
                type="button"
                className="nr-wave-card is-prev-1"
                aria-label={`上一首：${prev1.name}`}
                onClick={() => play(prev1, { ...playingQueue, index: curIdx - 1 })}
              >
                <SongArtwork song={prev1} size={320} className="nr-wave-img" />
              </button>
            )}
            {next1 && (
              <button
                type="button"
                className="nr-wave-card is-next-1"
                aria-label={`下一首：${next1.name}`}
                onClick={() => play(next1, { ...playingQueue, index: curIdx + 1 })}
              >
                <SongArtwork song={next1} size={320} className="nr-wave-img" />
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
          <div className="nr-strip-cards">
            {waveSlice.map(({ track, index, isCurrent }) => (
              <button
                key={`${track.id}-${index}`}
                type="button"
                className={'nr-next-pill' + (isCurrent ? ' is-active' : '')}
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
      )}
    </section>
  );
}
