import React from 'react';

const iconPaths = {
  prev: 'M6.5 6.5v11M17.5 6.8l-8.8 5.2 8.8 5.2V6.8Z',
  next: 'M17.5 6.5v11M6.5 6.8l8.8 5.2-8.8 5.2V6.8Z',
  queue: 'M4.5 6.5h10M4.5 12h10M4.5 17.5h7M17 13.5l3 3-3 3',
  lyrics: 'M5 7h10M5 12h14M5 17h8',
  volume: 'M4.5 9.8v4.4h3l4.2 3.5V6.3L7.5 9.8h-3ZM15.5 9.2a4 4 0 0 1 0 5.6',
  mute: 'M4.5 9.8v4.4h3l4.2 3.5V6.3L7.5 9.8h-3ZM16 9.5l4 5M20 9.5l-4 5',
  mode: 'M4.5 8.5h11.5l-2.6-2.6M19.5 15.5H8l2.6 2.6',
  refresh: 'M20 12a8 8 0 1 1-2.4-5.7M20 4v5.5h-5.5',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  moon: 'M18.5 14.5A7.2 7.2 0 0 1 9.5 5.5a7.2 7.2 0 1 0 9 9Z',
  menu: 'M4.5 7h15M4.5 12h15M4.5 17h15',
  close: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a7.6 7.6 0 0 0 .1-1 7.6 7.6 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-1.7-1L15 5h-4l-.3 2.6a7.5 7.5 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0-.1 1 7.6 7.6 0 0 0 .1 1l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 1.7 1L11 21h4l.3-2.6a7.5 7.5 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6Z',
};

export function Icon({ name, className = 'nr-icon' }) {
  const d = iconPaths[name] || '';
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}
