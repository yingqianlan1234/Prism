import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './Icons.jsx';

export function LyricPanel({ lyrics, index, status, onClose, onSeek, stage }) {
  const box = useRef(null);
  const timer = useRef(null);
  const [following, setFollowing] = useState(true);
  const [showTrans, setShowTrans] = useState(true);
  const [showRomaji, setShowRomaji] = useState(false);

  const hasTranslation = lyrics.some(l => !!l.translation);
  const hasRomaji = lyrics.some(l => !!l.romaji);

  const suspend = () => {
    const container = box.current;
    if (container?.scrollTo) {
      container.scrollTo({ top: container.scrollTop, behavior: 'auto' });
    }
    setFollowing(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setFollowing(true);
    }, 5000);
  };

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  useEffect(() => {
    const container = box.current;
    if (!following || index < 0 || !container) return;
    const current = container.querySelector('[aria-current="true"]');
    if (!current) return;
    const boxRect = container.getBoundingClientRect();
    const lineRect = current.getBoundingClientRect();
    const target = Math.max(
      0,
      Math.min(
        container.scrollHeight - container.clientHeight,
        container.scrollTop + lineRect.top - boxRect.top - (container.clientHeight - lineRect.height) / 2
      )
    );
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (container.scrollTo) {
      container.scrollTo({ top: target, behavior: reduced ? 'auto' : 'smooth' });
    } else {
      container.scrollTop = target;
    }
  }, [index, following]);

  return (
    <div className="lyric-panel" data-stage={stage ? 'true' : 'false'}>
      <div className="nr-lyric-header">
        <div className="nr-lyric-title-group">
          <h2>歌词</h2>
          {(hasTranslation || hasRomaji) && (
            <div className="nr-lyric-toggles" role="group" aria-label="歌词显示选项">
              {hasTranslation && (
                <button
                  type="button"
                  className={'nr-pill-toggle' + (showTrans ? ' is-on' : '')}
                  aria-pressed={showTrans}
                  onClick={() => setShowTrans(v => !v)}
                >
                  译文
                </button>
              )}
              {hasRomaji && (
                <button
                  type="button"
                  className={'nr-pill-toggle' + (showRomaji ? ' is-on' : '')}
                  aria-pressed={showRomaji}
                  onClick={() => setShowRomaji(v => !v)}
                >
                  音译
                </button>
              )}
            </div>
          )}
        </div>
        <div className="nr-lyric-actions">
          {!following && (
            <button
              type="button"
              className="lw-lyric-follow"
              onClick={() => {
                if (timer.current) clearTimeout(timer.current);
                timer.current = null;
                box.current?.focus({ preventScroll: true });
                setFollowing(true);
              }}
            >
              回到当前行
            </button>
          )}
          <button type="button" className="nr-close-btn" onClick={onClose} aria-label="关闭歌词">
            <Icon name="close" />
          </button>
        </div>
      </div>

      <div
        ref={box}
        className={'lyric-lines' + (lyrics.length ? ' has-lyrics' : '')}
        onWheel={suspend}
        onTouchStart={suspend}
        onPointerDown={suspend}
        onKeyDown={e => {
          if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) {
            suspend();
          }
        }}
        tabIndex={0}
        aria-label="歌词列表"
      >
        {lyrics.length ? (
          lyrics.map((l, i) => (
            <button
              key={i}
              type="button"
              className={'lyric-line' + (i === index ? ' current-line' : '')}
              aria-current={i === index ? 'true' : undefined}
              data-depth={index < 0 ? 3 : Math.min(3, Math.abs(i - index))}
              onClick={() => onSeek(l.at)}
            >
              <span className="nr-lyric-main">{l.text}</span>
              {showRomaji && l.romaji && Math.abs(i - index) <= 2 && (
                <small className="nr-lyric-romaji">{l.romaji}</small>
              )}
              {showTrans && l.translation && Math.abs(i - index) <= 1 && (
                <small className="lw-lyric-translation">{l.translation}</small>
              )}
            </button>
          ))
        ) : (
          <div className="lw-lyric-state" role={status === 'error' ? 'alert' : 'status'}>
            <strong>
              {status === 'loading'
                ? '正在加载歌词…'
                : status === 'error'
                  ? '歌词加载失败'
                  : status === 'instrumental'
                    ? '纯音乐，暂无歌词'
                    : status === 'idle'
                      ? '点击播放后显示歌词'
                      : '暂无歌词'}
            </strong>
            <span>
              {status === 'loading'
                ? '请稍候'
                : status === 'error'
                  ? '稍后切换歌曲可再次尝试'
                  : status === 'instrumental'
                    ? '请静静聆听'
                    : status === 'idle'
                      ? '这首歌还没有开始播放'
                      : '这首歌暂未提供歌词'}
            </span>
            {status === 'loading' && <i aria-hidden="true" />}
          </div>
        )}
      </div>
    </div>
  );
}
