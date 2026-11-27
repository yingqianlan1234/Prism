import React from 'react';

// 统一 24x24 光学网格 SVG 图标库：支持多元素组合、填充强调与独立模式图标
const ICONS = {
  prev: (
    <>
      <path d="M6.2 6.5v11" />
      <path
        d="M17.6 6.7a1 1 0 0 0-1.5-.86l-7.8 4.9a1 1 0 0 0 0 1.72l7.8 4.9a1 1 0 0 0 1.5-.86V6.7Z"
        fill="currentColor"
        stroke="none"
      />
    </>
  ),
  next: (
    <>
      <path d="M17.8 6.5v11" />
      <path
        d="M6.4 6.7a1 1 0 0 1 1.5-.86l7.8 4.9a1 1 0 0 1 0 1.72l-7.8 4.9a1 1 0 0 1-1.5-.86V6.7Z"
        fill="currentColor"
        stroke="none"
      />
    </>
  ),
  modeSequential: (
    <>
      <path d="M4.5 7h11.5" />
      <path d="M4.5 12h9" />
      <path d="M4.5 17h13.5" />
      <path d="M15.5 14.2 19 17l-3.5 2.8" />
    </>
  ),
  modeLoop: (
    <>
      <path d="M17.2 4.8 19.8 7.4 17.2 10" />
      <path d="M4.5 11.2V9.8A2.4 2.4 0 0 1 6.9 7.4h12.6" />
      <path d="M6.8 19.2 4.2 16.6 6.8 14" />
      <path d="M19.5 12.8v1.4a2.4 2.4 0 0 1-2.4 2.4H4.5" />
    </>
  ),
  modeRepeatOne: (
    <>
      <path d="M17.2 4.6 19.8 7.1 17.2 9.6" />
      <path d="M4.5 10.8V9.5A2.4 2.4 0 0 1 6.9 7.1h12.6" />
      <path d="M6.8 19.4 4.2 16.9 6.8 14.4" />
      <path d="M19.5 13.2v1.3a2.4 2.4 0 0 1-2.4 2.4H4.5" />
      <path d="M11.1 10.6 12.4 9.7v4.7" strokeWidth="1.95" />
    </>
  ),
  modeShuffle: (
    <>
      <path d="M17.3 5 20 7.7 17.3 10.4" />
      <path d="M17.3 13.6 20 16.3 17.3 19" />
      <path d="M4.2 16.3h3.2c1.8 0 2.9-1.1 4.4-4.3 1.5-3.2 2.6-4.3 4.4-4.3h3.5" />
      <path d="M4.2 7.7h3.2c1.2 0 2.1.5 3 1.8" />
      <path d="M13.6 14.5c.9 1.3 1.8 1.8 3 1.8h3.1" />
    </>
  ),
  // 向后兼容名
  mode: (
    <>
      <path d="M4.5 7h11.5" />
      <path d="M4.5 12h9" />
      <path d="M4.5 17h13.5" />
      <path d="M15.5 14.2 19 17l-3.5 2.8" />
    </>
  ),
  volume: (
    <>
      <path
        d="M4.2 9.6h3.2l4.1-3.3a.8.8 0 0 1 1.3.6v10.2a.8.8 0 0 1-1.3.6L7.4 14.4H4.2a1 1 0 0 1-1-1v-2.8a1 1 0 0 1 1-1Z"
        fill="currentColor"
        fillOpacity="0.16"
      />
      <path d="M15.6 9.3a4.1 4.1 0 0 1 0 5.4" />
      <path d="M18.2 6.8a7.4 7.4 0 0 1 0 10.4" />
    </>
  ),
  volumeLow: (
    <>
      <path
        d="M4.2 9.6h3.2l4.1-3.3a.8.8 0 0 1 1.3.6v10.2a.8.8 0 0 1-1.3.6L7.4 14.4H4.2a1 1 0 0 1-1-1v-2.8a1 1 0 0 1 1-1Z"
        fill="currentColor"
        fillOpacity="0.16"
      />
      <path d="M15.6 9.3a4.1 4.1 0 0 1 0 5.4" />
    </>
  ),
  mute: (
    <>
      <path
        d="M4.2 9.6h3.2l4.1-3.3a.8.8 0 0 1 1.3.6v10.2a.8.8 0 0 1-1.3.6L7.4 14.4H4.2a1 1 0 0 1-1-1v-2.8a1 1 0 0 1 1-1Z"
        fill="currentColor"
        fillOpacity="0.12"
      />
      <path d="m15.6 9.6 4.6 4.8" />
      <path d="m20.2 9.6-4.6 4.8" />
    </>
  ),
  queue: (
    <>
      <path d="M4.5 6.8h12.5" />
      <path d="M4.5 12h10" />
      <path d="M4.5 17.2h7.5" />
      <path d="M16.2 14.3a.6.6 0 0 1 .9-.5l3.2 1.9a.6.6 0 0 1 0 1l-3.2 1.9a.6.6 0 0 1-.9-.5v-3.8Z" fill="currentColor" stroke="none" />
    </>
  ),
  lyrics: (
    <>
      <rect x="4.5" y="6" width="2.4" height="12" rx="1.2" fill="currentColor" stroke="none" />
      <path d="M9.6 7.4h9.8" />
      <path d="M9.6 12h7.6" />
      <path d="M9.6 16.6h5.4" />
    </>
  ),
  desktopLyric: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="3.2" />
      <path d="M3.5 9.2h17" strokeOpacity="0.45" />
      <path d="M7.5 12.8h9" />
      <path d="M9.2 15.8h5.6" strokeOpacity="0.72" />
    </>
  ),
  settings: (
    <>
      <path d="M4.5 7.2h15" />
      <circle cx="9.2" cy="7.2" r="2.1" fill="var(--nr-night-0, #0E1624)" />
      <path d="M4.5 12h15" />
      <circle cx="15" cy="12" r="2.1" fill="var(--nr-night-0, #0E1624)" />
      <path d="M4.5 16.8h15" />
      <circle cx="10.8" cy="16.8" r="2.1" fill="var(--nr-night-0, #0E1624)" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.8 12a7.8 7.8 0 1 1-2.2-5.4" />
      <path d="M19.8 4.4v4.6h-4.6" />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.4" />
      <path d="m19.6 19.6-4.1-4.1" />
    </>
  ),
  moon: (
    <path d="M18.6 14.4A7.1 7.1 0 0 1 9.6 5.4a7.1 7.1 0 1 0 9 9Z" />
  ),
  menu: (
    <>
      <path d="M4.8 7.2h14.4" />
      <path d="M4.8 12h14.4" />
      <path d="M4.8 16.8h10.4" />
    </>
  ),
  close: (
    <>
      <path d="m6.8 6.8 10.4 10.4" />
      <path d="m17.2 6.8-10.4 10.4" />
    </>
  ),
  heart: (
    <path d="M12 20.1s-7-4.5-8.9-9.1C1.8 7.9 3.6 4.8 7 4.8c2 0 3.7 1.1 5 2.7 1.3-1.6 3-2.7 5-2.7 3.4 0 5.2 3.1 3.9 6.2-1.9 4.6-8.9 9.1-8.9 9.1Z" />
  ),
  heartFill: (
    <path
      d="M12 20.1s-7-4.5-8.9-9.1C1.8 7.9 3.6 4.8 7 4.8c2 0 3.7 1.1 5 2.7 1.3-1.6 3-2.7 5-2.7 3.4 0 5.2 3.1 3.9 6.2-1.9 4.6-8.9 9.1-8.9 9.1Z"
      fill="currentColor"
    />
  ),
  dislike: (
    <>
      <path d="M12 19.6s-6.3-4.1-8.1-8.3C2.7 8.4 4.4 5.5 7.4 5.5c1.6 0 3.1.8 4.2 2" />
      <path d="M19.8 11.7c-1.1 2.7-4 5.4-6.3 7.1" />
      <path d="M20.2 8.2c-.4-1.6-1.8-2.7-3.6-2.7-1.1 0-2.1.4-2.9 1.1" />
      <path d="M4.5 4.5 19.5 19.5" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5.2v13.6" />
      <path d="M5.2 12h13.6" />
    </>
  ),
  trash: (
    <>
      <path d="M4.8 7.2h14.4" />
      <path d="M9.6 4.5h4.8" />
      <path d="M7.8 7.2v11.3a1.4 1.4 0 0 0 1.4 1.4h5.6a1.4 1.4 0 0 0 1.4-1.4V7.2" />
      <path d="M10.2 11v5" />
      <path d="M13.8 11v5" />
    </>
  ),
  lock: (
    <>
      <path d="M7.5 10.6V8.2a4.5 4.5 0 0 1 9 0v2.4" />
      <rect x="5.2" y="10.6" width="13.6" height="9.2" rx="2.2" />
      <circle cx="12" cy="15.2" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  unlock: (
    <>
      <path d="M7.5 10.6V8.2a4.5 4.5 0 0 1 8.6-1.8" />
      <rect x="5.2" y="10.6" width="13.6" height="9.2" rx="2.2" />
      <circle cx="12" cy="15.2" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2.8" y="6.2" width="18.4" height="11.6" rx="2.4" />
      <path d="M6.4 10.2h1.2M10 10.2h1.2M13.6 10.2h1.2M17.2 10.2h.6" />
      <path d="M7.2 14h9.6" />
    </>
  ),
  folder: (
    <path d="M3.5 7.4a2 2 0 0 1 2-2h4.1l1.7 1.9h7.2a2 2 0 0 1 2 2v7.3a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7.4Z" />
  ),
  folderPlus: (
    <>
      <path d="M3.5 7.4a2 2 0 0 1 2-2h4.1l1.7 1.9h7.2a2 2 0 0 1 2 2v7.3a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7.4Z" />
      <path d="M12 10.8v4.6" />
      <path d="M9.7 13.1h4.6" />
    </>
  ),
  update: (
    <>
      <path d="M12 4.2v10.2" />
      <path d="m8.2 10.8 3.8 3.8 3.8-3.8" />
      <path d="M5 15.8v2.2a1.8 1.8 0 0 0 1.8 1.8h10.4a1.8 1.8 0 0 0 1.8-1.8v-2.2" />
    </>
  ),
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="m8.8 12.2 2.2 2.2 4.4-4.6" />
    </>
  ),
  collection: (
    <>
      <rect x="4" y="6.8" width="16" height="12.4" rx="2.6" />
      <path d="M7.2 4.2h9.6" />
      <path d="M9.6 11.2h5.2" />
      <path d="M9.6 14.8h3.6" />
    </>
  ),
  sliders: (
    <>
      <path d="M5 7h14" />
      <circle cx="9" cy="7" r="1.9" fill="var(--nr-night-0, #0E1624)" />
      <path d="M5 12h14" />
      <circle cx="15" cy="12" r="1.9" fill="var(--nr-night-0, #0E1624)" />
      <path d="M5 17h14" />
      <circle cx="11" cy="17" r="1.9" fill="var(--nr-night-0, #0E1624)" />
    </>
  ),
  download: (
    <>
      <path d="M12 4.5v10" />
      <path d="m8.5 11.2 3.5 3.6 3.5-3.6" />
      <path d="M5.2 16.5v2a1.6 1.6 0 0 0 1.6 1.6h10.4a1.6 1.6 0 0 0 1.6-1.6v-2" />
    </>
  ),
  upload: (
    <>
      <path d="M12 14.5v-10" />
      <path d="m8.5 7.8 3.5-3.6 3.5 3.6" />
      <path d="M5.2 16.5v2a1.6 1.6 0 0 0 1.6 1.6h10.4a1.6 1.6 0 0 0 1.6-1.6v-2" />
    </>
  ),
  edit: (
    <>
      <path d="M4.8 19.2h3.4l9.7-9.7a2.1 2.1 0 0 0-3-3L5.2 16.2v3Z" />
      <path d="m13.3 8.1 2.8 2.8" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3.5a8.5 8.5 0 0 0 0 17 2.1 2.1 0 0 0 2.1-2.1c0-.5-.2-1-.5-1.3a2 2 0 0 1 1.5-3.3h2.1A3.8 3.8 0 0 0 21 10c0-3.7-4-6.5-9-6.5Z" />
      <circle cx="8" cy="10.2" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="11.2" cy="7.6" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15.2" cy="8.4" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <polygon points="14.8,9.2 13.4,13.4 9.2,14.8 10.6,10.6" fill="currentColor" fillOpacity="0.24" />
    </>
  ),
  radio: (
    <>
      <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
      <path d="M8.1 15.9a5.5 5.5 0 0 1 0-7.8" />
      <path d="M15.9 8.1a5.5 5.5 0 0 1 0 7.8" />
      <path d="M5.4 18.6a9.3 9.3 0 0 1 0-13.2" />
      <path d="M18.6 5.4a9.3 9.3 0 0 1 0 13.2" />
    </>
  ),
  history: (
    <>
      <path d="M4.6 12a7.4 7.4 0 1 0 2.1-5.2L4.6 8.8" />
      <path d="M4.6 4.8v4h4" />
      <path d="M12 8.2v4.1l2.8 1.6" />
    </>
  ),
  chevronDown: (
    <path d="m7.2 9.8 4.8 4.8 4.8-4.8" />
  ),
  arrowLeft: (
    <>
      <path d="M18.4 12H5.6" />
      <path d="m10.8 6.8-5.2 5.2 5.2 5.2" />
    </>
  ),
  timer: (
    <>
      <circle cx="12" cy="13" r="7.4" />
      <path d="M12 9.4v3.8l2.5 1.5" />
      <path d="M9.5 3.8h5" />
    </>
  ),
  winMin: (
    <path d="M6.5 12h11" />
  ),
  winMax: (
    <rect x="6.5" y="6.5" width="11" height="11" rx="1.8" />
  ),
  winRestore: (
    <>
      <rect x="6" y="8.5" width="9.5" height="9.5" rx="1.6" />
      <path d="M9 6h7.2A1.8 1.8 0 0 1 18 7.8V15" />
    </>
  ),
  winClose: (
    <>
      <path d="m7.2 7.2 9.6 9.6" />
      <path d="m16.8 7.2-9.6 9.6" />
    </>
  ),
  grip: (
    <>
      <circle cx="9" cy="6.5" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="15" cy="6.5" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="9" cy="17.5" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="15" cy="17.5" r="1.25" fill="currentColor" stroke="none" />
    </>
  ),
  playNext: (
    <>
      <path d="M5.5 7.5h7.5" />
      <path d="M5.5 12h11" />
      <path d="M5.5 16.5h7.5" />
      <path d="M17.5 4.8v6" />
      <path d="M14.8 7.4 17.5 4.7l2.7 2.7" />
    </>
  ),
};

export function Icon({ name, className = 'nr-icon' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {ICONS[name] || null}
    </svg>
  );
}
