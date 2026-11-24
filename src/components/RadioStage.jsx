import React, { useEffect, useRef } from 'react';
import { artist, album } from '../utils/format.js';
import { SongArtwork, SourceTag, PlayButton } from './Artwork.jsx';

// 深夜电台波段核心主舞台：横向错落封面波段 + 实况大歌词 + 待播波段横轨
export function RadioStage({
  song,
  playing,
  buffering,
  pending,
  activeProvider,
  playingQueue,
  showLyrics,
  setShowLyrics,
  stagePreview,
  lyricStatus,
  togglePlayback,
  play,
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

  return (
    <section
      className={'lw-stage nr-radio-stage' + (showLyrics ? ' is-lyrics' : '')}
      aria-label={showLyrics ? '歌词舞台' : '播放舞台'}
    >
      <div className="nr-radio-center">
        {/* 左侧：横向错落封面电台波段 */}
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

          {/* 主封面 + 鹅卵石主控键（保留 .lw-stage-cover .play-toggle 与 .lw-stage-image 选择器） */}
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

        {/* 右侧：曲目信息 + 实况大歌词预览 */}
        <div className="lw-stage-info nr-stage-info">
          <div key={songKey} className="nr-stage-heading" data-dir={dir}>
            <h1>{song?.name || '从一首歌开始'}</h1>
            <p>
              {song
                ? [artist(song), albumName].filter(Boolean).join(' · ')
                : '选择一首歌，拨通今晚的电台'}
            </p>
          </div>

          <div
            className="lw-stage-lyrics nr-stage-lyrics"
            role="button"
            tabIndex={0}
            aria-label="进入歌词模式"
            onClick={() => setShowLyrics(true)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setShowLyrics(true);
              }
            }}
          >
            {stagePreview.length ? (
              stagePreview.map((item, i) => (
                <p key={i} className={item.isCurrent ? 'is-current' : ''}>
                  <span>{item.text}</span>
                  {item.isCurrent && item.translation && (
                    <small className="nr-stage-trans">{item.translation}</small>
                  )}
                </p>
              ))
            ) : (
              <p className="is-empty">
                {lyricStatus === 'loading'
                  ? '正在加载歌词…'
                  : lyricStatus === 'error'
                    ? '歌词加载失败'
                    : lyricStatus === 'idle'
                      ? '点击播放后显示歌词'
                      : lyricStatus === 'instrumental'
                        ? '纯音乐，暂无歌词'
                        : '这首歌暂未提供歌词'}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* 中下段：待播波段横轨（仅在非全歌词态且队列有内容时展现） */}
      {!showLyrics && waveSlice.length > 0 && (
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
