import React, { useEffect, useState } from 'react';
import { time } from '../utils/format.js';

// 进度更新严格收口在这个小组件内部，不触发主页面重绘。
export function PlaybackProgress({ audio, restored, onSeek, onSeekEnd, variant }) {
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    const progress = () => setElapsed(Math.floor(Number.isFinite(a.currentTime) ? a.currentTime : 0));
    const metadata = () => {
      setDuration(Number.isFinite(a.duration) ? a.duration : 0);
      progress();
    };
    const clear = () => {
      setElapsed(0);
      setDuration(0);
    };
    a.addEventListener('timeupdate', progress);
    a.addEventListener('seeked', progress);
    a.addEventListener('loadedmetadata', metadata);
    a.addEventListener('durationchange', metadata);
    a.addEventListener('emptied', clear);
    metadata();
    return () => {
      a.removeEventListener('timeupdate', progress);
      a.removeEventListener('seeked', progress);
      a.removeEventListener('loadedmetadata', metadata);
      a.removeEventListener('durationchange', metadata);
      a.removeEventListener('emptied', clear);
    };
  }, [audio]);

  useEffect(() => {
    if (restored) {
      setElapsed(restored.position);
      setDuration(restored.duration);
    }
  }, [restored]);

  const ratio = duration ? Math.min(100, (elapsed / duration) * 100) : 0;

  return (
    <div className="progress" data-variant={variant}>
      <span className="progress-time">{duration ? time(elapsed) : '--:--'}</span>
      <input
        type="range"
        aria-label="播放进度"
        aria-valuetext={duration ? `${time(elapsed)}，共 ${time(duration)}` : '时长未知'}
        style={{ '--nr-p': `${ratio}%` }}
        min="0"
        max={duration || 0}
        value={Math.min(elapsed, duration || 0)}
        disabled={!duration}
        onPointerUp={onSeekEnd}
        onChange={e => {
          const next = Number(e.target.value);
          onSeek(next);
          setElapsed(next);
        }}
      />
      <span className="progress-time">
        {duration ? `−${time(Math.max(0, duration - elapsed))}` : '--:--'}
      </span>
    </div>
  );
}
