import React, { memo, useEffect, useState } from 'react';
import { playlistCoverUrl, coverUrl } from '../cover.js';
import {
  getCachedLocalCover,
  getLocalCoverFetcher,
  loadLocalCover,
  subscribeLocalCoverFetcher,
} from '../local-cover-cache.js';
import { providerLabel } from '../utils/format.js';

function useImageFailure(src) {
  const [state, setState] = useState({ src, failed: false });
  if (state.src !== src) setState({ src, failed: false });
  return [state.src === src && state.failed, () => setState({ src, failed: true })];
}

export const PlaylistCover = memo(function PlaylistCover({ url, className }) {
  const src = playlistCoverUrl(url);
  const [failed, markFailed] = useImageFailure(src);
  if (src && !failed) {
    return (
      <img
        className={className}
        src={src}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={markFailed}
      />
    );
  }
  return <span className={`${className} lw-cover-fallback`} aria-hidden="true" />;
});

export const SongArtwork = memo(function SongArtwork({ song, size, className, variant = 'small' }) {
  const directSrc = coverUrl(song, size);
  const localId = !directSrc && song?.provider === 'local' && song?.id ? String(song.id) : null;
  const [fetcher, setFetcher] = useState(() => getLocalCoverFetcher());
  const [resolvedLocal, setResolvedLocal] = useState(() => ({
    id: localId,
    src: localId ? getCachedLocalCover(localId) || null : null,
  }));

  useEffect(() => subscribeLocalCoverFetcher(() => setFetcher(() => getLocalCoverFetcher())), []);

  useEffect(() => {
    if (!localId || !fetcher) {
      setResolvedLocal({ id: localId, src: null });
      return undefined;
    }
    const cached = getCachedLocalCover(localId);
    if (cached !== undefined) {
      setResolvedLocal({ id: localId, src: cached });
      return undefined;
    }
    let alive = true;
    setResolvedLocal({ id: localId, src: null });
    void loadLocalCover(localId, fetcher).then(dataUrl => {
      if (alive) setResolvedLocal({ id: localId, src: dataUrl || null });
    });
    return () => {
      alive = false;
    };
  }, [localId, fetcher]);

  const src = directSrc || (localId && resolvedLocal.id === localId ? resolvedLocal.src : null);
  const [failed, markFailed] = useImageFailure(src);
  if (src && !failed) {
    return (
      <img
        className={className}
        src={src}
        alt={variant === 'stage' ? `${song?.name || '歌曲'} 专辑封面` : ''}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={markFailed}
      />
    );
  }
  if (variant === 'stage') {
    return (
      <div
        className="lw-stage-placeholder"
        role="img"
        aria-label={song ? `${song.name}，暂无封面` : '暂无封面'}
      >
        <span className="nr-vinyl-glow" aria-hidden="true" />
      </div>
    );
  }
  if (variant === 'panel') {
    return <div className="now-cover lw-cover-fallback" aria-hidden="true" />;
  }
  return <span className={`${className} lw-cover-fallback`} aria-hidden="true" />;
});

export const SourceTag = memo(function SourceTag({ provider, browsing }) {
  if (!provider) return null;
  const label = providerLabel(provider);
  return (
    <span className={'lw-source-tag' + (provider !== browsing ? ' is-other' : '')}>
      {provider !== browsing ? '来源：' : ''}
      {label}
    </span>
  );
});

export function InlineNotice({ tone = 'err', role, children }) {
  if (!children) return null;
  return (
    <p className="lw-notice" data-tone={tone} role={role || (tone === 'err' ? 'alert' : 'status')}>
      {children}
    </p>
  );
}

// 温润鹅卵石主播放键：保持 .play-toggle 与无障碍状态语义，彻底告别锋利方框。
export const PlayButton = memo(function PlayButton({ playing, buffering, pending, onClick, disabled, size = 'md' }) {
  const state = playing || buffering ? 'pause' : 'play';
  return (
    <button
      type="button"
      className={`play-toggle nr-play-pebble is-${size}`}
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled}
      aria-label={state === 'pause' ? '暂停' : '播放'}
      data-state={state}
      data-buffering={buffering || pending ? 'true' : 'false'}
    >
      <svg className="nr-play-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        {state === 'pause' ? (
          <>
            <rect x="6.8" y="5.6" width="3.6" height="12.8" rx="1.6" />
            <rect x="13.6" y="5.6" width="3.6" height="12.8" rx="1.6" />
          </>
        ) : (
          <path d="M8.5 5.8a1.3 1.3 0 0 1 2-.1l8.4 5.4a1.3 1.3 0 0 1 0 2.2l-8.4 5.4a1.3 1.3 0 0 1-2-1.1V5.8Z" />
        )}
      </svg>
    </button>
  );
});
