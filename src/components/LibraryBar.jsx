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
  qqRecommendationCapabilities = null,
  lists,
  openList,
  listStatus,
  ws,
  onMore,
  localFolders = [],
  localActiveFolderId = null,
  localTotal = 0,
  localBusy = false,
  localUnavailableIds = [],
  onSelectLocalFolder,
  onPickLocalFolder,
  onRemoveLocalFolder,
  onScanLocalLibrary,
}) {
  const unavailableSet = new Set(localUnavailableIds);
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
        {activeProvider === 'local' ? (
          <>
            <div className="nr-side-section">
              <span className="nr-side-kicker">本地曲库</span>
              <div className="nr-local-side-actions">
                <button
                  type="button"
                  className="nr-primary-btn nr-local-pick-btn"
                  disabled={localBusy}
                  onClick={onPickLocalFolder}
                >
                  <Icon name="folderPlus" className="nr-icon is-sm" />
                  添加文件夹
                </button>
                <button
                  type="button"
                  className="nr-soft-btn nr-local-scan-btn"
                  disabled={localBusy || !localFolders.length}
                  onClick={onScanLocalLibrary}
                >
                  <Icon name="refresh" className="nr-icon is-sm" />
                  {localBusy ? '扫描中…' : '重新扫描'}
                </button>
              </div>
            </div>

            <div className="nr-side-section nr-side-playlists">
              <span className="library-label">
                本地文件夹 <i>{localFolders.length || ''}</i>
              </span>
              <div className="lists">
                <button
                  type="button"
                  className={'playlist' + (localActiveFolderId === null ? ' is-active' : '')}
                  onClick={() => onSelectLocalFolder(null)}
                >
                  <Icon name="folder" className="nr-icon is-sm nr-folder-ico" />
                  <span className="nr-pl-name">全部本地歌曲</span>
                  <small className="playlist-kind">{localTotal}</small>
                </button>
                {localFolders.map(folder => {
                  const active = localActiveFolderId === folder.id;
                  const unavailable = unavailableSet.has(folder.id);
                  return (
                    <div key={folder.id} className="nr-folder-row">
                      <button
                        type="button"
                        className={'playlist' + (active ? ' is-active' : '')}
                        title={folder.name}
                        onClick={() => onSelectLocalFolder(folder.id)}
                      >
                        <Icon name="folder" className="nr-icon is-sm nr-folder-ico" />
                        <span className="nr-pl-name">{folder.name}</span>
                        {unavailable && <small className="playlist-kind is-warn">暂不可用</small>}
                      </button>
                      <button
                        type="button"
                        className="nr-folder-remove"
                        aria-label={`移除文件夹 ${folder.name}`}
                        title={`移除文件夹 ${folder.name}`}
                        disabled={localBusy}
                        onClick={() => onRemoveLocalFolder(folder.id)}
                      >
                        <Icon name="trash" className="nr-icon is-xs" />
                      </button>
                    </div>
                  );
                })}
                {!localFolders.length && (
                  <span className="side-note">
                    添加本机音乐目录，离线收听 MP3 / FLAC / WAV / M4A / OGG
                  </span>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
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

            {activeProvider === 'qqmusic' &&
              profile &&
              !identityUnknown &&
              platformFlavor.qqmusic !== 'mock' &&
              (qqRecommendationCapabilities?.newsong ||
                qqRecommendationCapabilities?.playlists) && (
                <div className="nr-side-section">
                  <span className="nr-side-kicker">发现与推荐</span>
                  <nav className="recommend-nav" aria-label="QQ 推荐">
                    {qqRecommendationCapabilities.newsong && (
                      <button
                        type="button"
                        className={ws?.title === '推荐新歌' ? 'is-active' : ''}
                        onClick={() => recommend('newsong')}
                      >
                        推荐新歌
                      </button>
                    )}
                    {qqRecommendationCapabilities.playlists && (
                      <button
                        type="button"
                        className={ws?.title === '推荐歌单' ? 'is-active' : ''}
                        onClick={() => recommend('playlists')}
                      >
                        推荐歌单
                      </button>
                    )}
                  </nav>
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
          </>
        )}
      </div>
    </aside>
  );
}
