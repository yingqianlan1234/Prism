import React from 'react';
import { PlaylistCover } from './Artwork.jsx';
import { Icon } from './Icons.jsx';

export function RecommendationNav({ openFm, openRecent, recommend, ws }) {
  return (
    <nav className="recommend-nav" aria-label="网易推荐">
      <button
        type="button"
        className={ws?.fmView ? 'is-active' : ''}
        onClick={openFm}
      >
        私人 FM
      </button>
      <button
        type="button"
        className={ws?.trackOrigin === 'recent' ? 'is-active' : ''}
        onClick={openRecent}
      >
        本地最近播放
      </button>
      <button
        type="button"
        className={ws?.title === '每日推荐' ? 'is-active' : ''}
        onClick={() => recommend('daily')}
      >
        每日推荐
      </button>
      <button
        type="button"
        className={ws?.title === '推荐新歌' ? 'is-active' : ''}
        onClick={() => recommend('newsong')}
      >
        推荐新歌
      </button>
      <button
        type="button"
        className={ws?.title === '为你推荐的歌单' ? 'is-active' : ''}
        onClick={() => recommend('resources')}
      >
        为你推荐的歌单
      </button>
      <button
        type="button"
        className={ws?.title === '推荐歌单' ? 'is-active' : ''}
        onClick={() => recommend('playlists')}
      >
        推荐歌单
      </button>
    </nav>
  );
}

export function LibraryBar({
  platformFlavor,
  sideExpanded,
  setSideExpanded,
  activeProvider,
  profile,
  identityUnknown,
  openFm,
  openRecent,
  recommend,
  lists,
  openList,
  listStatus,
  ws,
  onMore,
}) {
  return (
    <aside className="library-bar" data-expanded={sideExpanded}>
      <button
        type="button"
        className="lw-side-toggle"
        aria-label={sideExpanded ? '收起侧栏' : '展开侧栏'}
        aria-expanded={sideExpanded}
        onClick={() => setSideExpanded(!sideExpanded)}
      >
        <Icon name="menu" />
      </button>

      <div
        className="lw-side-menu"
        onClickCapture={e => {
          if (e.target.closest('button')) setSideExpanded(false);
        }}
      >
        {activeProvider === 'netease' && profile && !identityUnknown && (
          <div className="nr-side-section">
            <span className="nr-side-kicker">电台与推荐</span>
            <RecommendationNav
              openFm={openFm}
              openRecent={openRecent}
              recommend={recommend}
              ws={ws}
            />
          </div>
        )}

        <div className="nr-side-section nr-side-playlists">
          <span className="library-label">
            我的歌单 <i>{lists.length || ''}</i>
          </span>
          <div className="lists">
            {lists.map(l => (
              <button
                key={l.id}
                type="button"
                onClick={() => openList(l)}
                className={
                  'playlist' +
                  (ws?.trackOrigin === 'playlist' && String(ws?.qqPlaylist?.id) === String(l.id)
                    ? ' is-active'
                    : '')
                }
                title={l.name}
              >
                <PlaylistCover className="playlist-thumb" url={l.coverImgUrl} />
                <span className="nr-pl-name">{l.name}</span>
                {activeProvider === 'netease' &&
                  l.creator?.userId != null &&
                  profile?.userId != null && (
                    <small className="playlist-kind">
                      {String(l.creator.userId) === String(profile.userId) ? '创建' : '收藏'}
                    </small>
                  )}
              </button>
            ))}

            {!profile && (
              <span className="side-note">
                {activeProvider === 'qqmusic'
                  ? platformFlavor.qqmusic === 'mock'
                    ? '模拟模式：未连接真实 QQ 账号'
                    : '登录后可查看 QQ 歌单并尝试播放授权歌曲'
                  : '登录后同步网易云歌单'}
              </span>
            )}
            {listStatus && (
              <span className="side-note" role="status">
                {listStatus}
              </span>
            )}
            {activeProvider === 'qqmusic' && profile && platformFlavor.qqmusic !== 'mock' && (
              <button
                type="button"
                className="nr-soft-btn"
                disabled={ws.listsBusy || ws.listPage >= 50}
                onClick={onMore}
              >
                请求下一页歌单
              </button>
            )}
            {ws.storageStatus && (
              <span className="side-note" role="status">
                {ws.storageStatus}
              </span>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
