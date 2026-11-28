import React, { memo, useState } from 'react';
import { PlaylistCover } from './Artwork.jsx';
import { Icon } from './Icons.jsx';

const DISCOVER_TITLES = new Set(['每日推荐', '推荐新歌', '为你推荐的歌单', '推荐歌单', '发现音乐']);

export const RecommendationNav = memo(function RecommendationNav({ openFm, openRecent, recommend, ws, isFmPlaying }) {
  const isDiscoverActive =
    ws?.trackOrigin === 'recommendation' ||
    (ws?.trackOrigin !== 'recent' && ws?.trackOrigin !== 'playlist' && DISCOVER_TITLES.has(ws?.title));

  return (
    <nav className="nr-side-quick" aria-label="网易推荐">
      <button
        type="button"
        className={'playlist nr-quick-btn' + (isDiscoverActive ? ' is-active' : '')}
        onClick={() => recommend('daily')}
      >
        <span className="nr-quick-ico" aria-hidden="true">
          <Icon name="compass" className="nr-icon is-sm" />
        </span>
        <span className="nr-pl-name">发现音乐</span>
      </button>
      <button
        type="button"
        className={'playlist nr-quick-btn' + (isFmPlaying ? ' is-active' : '')}
        onClick={openFm}
      >
        <span className="nr-quick-ico" aria-hidden="true">
          <Icon name="radio" className="nr-icon is-sm" />
        </span>
        <span className="nr-pl-name">私人 FM</span>
      </button>
      <button
        type="button"
        className={'playlist nr-quick-btn' + (ws?.trackOrigin === 'recent' ? ' is-active' : '')}
        onClick={openRecent}
      >
        <span className="nr-quick-ico" aria-hidden="true">
          <Icon name="history" className="nr-icon is-sm" />
        </span>
        <span className="nr-pl-name">本地最近播放</span>
      </button>
    </nav>
  );
});

export const LibraryBar = memo(function LibraryBar({
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
  isFmPlaying = false,
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
  customPlaylists = [],
  activeCustomPlaylistId = null,
  onOpenCustomPlaylist,
  onCreateCustomPlaylist,
}) {
  const unavailableSet = new Set(localUnavailableIds);
  const [creatingCustom, setCreatingCustom] = useState(false);
  const [customDraft, setCustomDraft] = useState('');
  const [customError, setCustomError] = useState('');

  const submitCustomCreate = e => {
    e.preventDefault();
    const res = onCreateCustomPlaylist?.(customDraft);
    if (res?.error) {
      setCustomError(res.error);
      return;
    }
    setCustomDraft('');
    setCustomError('');
    setCreatingCustom(false);
  };

  const qqDefaultDiscoverKind = qqRecommendationCapabilities?.newsong ? 'newsong' : 'playlists';
  const qqDiscoverActive =
    ws?.trackOrigin === 'recommendation' ||
    (ws?.trackOrigin !== 'playlist' && (ws?.title === '推荐新歌' || ws?.title === '推荐歌单'));

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
          if (e.target.closest('button') && !e.target.closest('.nr-custom-side-head,.nr-custom-side-form')) {
            setSideExpanded(false);
          }
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
                <span className="nr-side-kicker">电台与发现</span>
                <RecommendationNav
                  openFm={openFm}
                  openRecent={openRecent}
                  recommend={recommend}
                  ws={ws}
                  isFmPlaying={isFmPlaying}
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
                  <nav className="nr-side-quick" aria-label="QQ 推荐">
                    <button
                      type="button"
                      className={'playlist nr-quick-btn' + (qqDiscoverActive ? ' is-active' : '')}
                      onClick={() => recommend(qqDefaultDiscoverKind)}
                    >
                      <span className="nr-quick-ico" aria-hidden="true">
                        <Icon name="compass" className="nr-icon is-sm" />
                      </span>
                      <span className="nr-pl-name">发现音乐</span>
                    </button>
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

        <div className="nr-side-section nr-custom-side">
          <div className="nr-custom-side-head">
            <span className="library-label">
              本机歌单 <i>{customPlaylists.length || ''}</i>
            </span>
            <button
              type="button"
              className="nr-custom-add-btn"
              aria-label={creatingCustom ? '取消新建本机歌单' : '新建本机歌单'}
              title={creatingCustom ? '取消新建' : '新建本机歌单'}
              onClick={() => {
                setCreatingCustom(v => !v);
                setCustomError('');
              }}
            >
              <Icon name={creatingCustom ? 'close' : 'plus'} className="nr-icon is-xs" />
            </button>
          </div>

          {creatingCustom && (
            <form className="nr-custom-side-form" onSubmit={submitCustomCreate}>
              <input
                type="text"
                className="nr-custom-side-input"
                maxLength={40}
                value={customDraft}
                placeholder="输入本机歌单名…"
                aria-label="新建本机歌单名称"
                autoFocus
                onChange={e => {
                  setCustomDraft(e.target.value);
                  if (customError) setCustomError('');
                }}
              />
              <button type="submit" className="nr-primary-btn nr-custom-side-submit">
                创建
              </button>
              {customError && (
                <span className="nr-custom-side-err" role="alert">
                  {customError}
                </span>
              )}
            </form>
          )}

          {customPlaylists.length > 0 ? (
            <div className="lists nr-custom-side-list">
              {customPlaylists.map(pl => {
                const active = activeCustomPlaylistId === pl.id;
                return (
                  <button
                    key={pl.id}
                    type="button"
                    className={'playlist nr-custom-playlist-btn' + (active ? ' is-active' : '')}
                    title={pl.name}
                    onClick={() => {
                      setSideExpanded(false);
                      onOpenCustomPlaylist?.(pl.id);
                    }}
                  >
                    <span className="nr-custom-badge-ico" aria-hidden="true">
                      <Icon name="collection" className="nr-icon is-xs" />
                    </span>
                    <span className="nr-pl-name">{pl.name}</span>
                    <small className="playlist-kind">{pl.tracks.length}</small>
                  </button>
                );
              })}
            </div>
          ) : (
            !creatingCustom && (
              <span className="side-note">
                跨平台自建歌单保存在本机，可混搭网易云、QQ 与本地歌曲。
              </span>
            )
          )}
        </div>
      </div>
    </aside>
  );
});
