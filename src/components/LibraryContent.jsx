import React from 'react';
import { artist, album, time } from '../utils/format.js';
import { PlaylistCover, SongArtwork, SourceTag, InlineNotice } from './Artwork.jsx';
import { Icon } from './Icons.jsx';

const SEARCH_TYPES = [
  { id: 1, label: '单曲' },
  { id: 10, label: '专辑' },
  { id: 100, label: '歌手' },
  { id: 1000, label: '歌单' },
];

export function SearchCategoryBar({ searchType, disabled, onSelectType }) {
  return (
    <div className="nr-search-tabs" role="group" aria-label="搜索分类">
      {SEARCH_TYPES.map(cat => (
        <button
          key={cat.id}
          type="button"
          className={'nr-search-tab' + (searchType === cat.id ? ' is-active' : '')}
          aria-pressed={searchType === cat.id}
          disabled={disabled}
          onClick={() => onSelectType(cat.id)}
        >
          {cat.label}
        </button>
      ))}
    </div>
  );
}

export function SearchCategoryResults({ searchType, items, onOpenPlaylist, onSearchKeyword }) {
  if (searchType === 1000) {
    return (
      <div className="lw-card-grid nr-search-grid">
        {items.map(pl => (
          <button
            key={pl.id}
            type="button"
            className="lw-card"
            title={pl.name}
            aria-label={`打开歌单：${pl.name}`}
            onClick={() => onOpenPlaylist(pl)}
          >
            <span className="lw-card-cover">
              <PlaylistCover className="lw-card-img" url={pl.coverImgUrl} />
              <span className="lw-card-play" aria-hidden="true">
                <Icon name="next" />
              </span>
            </span>
            <b className="lw-card-name">{pl.name}</b>
            <small className="lw-card-meta">
              {[pl.creator?.nickname || '未知创建者', pl.trackCount != null ? `${pl.trackCount} 首` : '']
                .filter(Boolean)
                .join(' · ')}
            </small>
          </button>
        ))}
      </div>
    );
  }

  if (searchType === 10) {
    return (
      <div className="lw-card-grid nr-search-grid">
        {items.map(al => {
          const who = al.artist?.name || (al.artists || []).map(a => a.name).join(' / ');
          return (
            <button
              key={al.id}
              type="button"
              className="lw-card"
              title={al.name}
              aria-label={`搜索专辑：${al.name}`}
              onClick={() => onSearchKeyword(al.name)}
            >
              <span className="lw-card-cover">
                <PlaylistCover className="lw-card-img" url={al.picUrl} />
              </span>
              <b className="lw-card-name">{al.name}</b>
              <small className="lw-card-meta">
                {[who || '未知歌手', al.size != null ? `${al.size} 首` : ''].filter(Boolean).join(' · ')}
              </small>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="lw-card-grid nr-artist-grid">
      {items.map(ar => (
        <button
          key={ar.id}
          type="button"
          className="lw-card nr-artist-card"
          title={ar.name}
          aria-label={`搜索歌手：${ar.name}`}
          onClick={() => onSearchKeyword(ar.name)}
        >
          <span className="lw-card-cover nr-artist-cover">
            <PlaylistCover className="lw-card-img" url={ar.img1v1Url || ar.picUrl} />
          </span>
          <b className="lw-card-name">{ar.name}</b>
          <small className="lw-card-meta">
            {ar.albumSize != null ? `${ar.albumSize} 张专辑` : '网易云歌手'}
          </small>
        </button>
      ))}
    </div>
  );
}

export function SongList({
  songs,
  ws,
  activeProvider,
  song,
  selectedTrack,
  playing,
  buffering,
  play,
  setSelectedTrack,
  neteaseSignedIn,
  canLike,
  canCollect,
  canRemoveFromPlaylist,
  likedIds,
  likedBusyIds,
  removingTrackKey,
  onToggleLike,
  onOpenPlaylistPicker,
  onRemoveFromPlaylist,
}) {
  const visibleSongs = activeProvider === 'netease' && ws.fmView ? songs.slice(-200) : songs;
  const showRowActions =
    activeProvider === 'netease' && neteaseSignedIn && (canLike || canCollect || canRemoveFromPlaylist);
  return (
    <div className="table">
      <div className="row table-head" aria-hidden="true">
        <span>#</span>
        <span>歌曲</span>
        <span>歌手</span>
        <span>专辑</span>
        <span>时长</span>
      </div>
      {visibleSongs.map((s, i) => {
        const isPlayingRow =
          song?.id === s.id && song?.provider === s.provider && song?.accountId === s.accountId;
        const isPickedRow =
          selectedTrack?.provider === s.provider &&
          selectedTrack?.id === s.id &&
          selectedTrack?.accountId === s.accountId;
        const numericId = Number(s.id);
        const isLiked = s.provider === 'netease' && likedIds?.has(numericId);
        const likeBusy = s.provider === 'netease' && likedBusyIds?.has(numericId);
        const removeKey = ws.qqPlaylist ? `${ws.qqPlaylist.id}:${s.id}` : '';
        const isRemoving = !!removingTrackKey && removingTrackKey === removeKey;
        return (
          <div
            className={
              'nr-song-row-wrap' +
              (isPlayingRow ? ' is-selected' : isPickedRow ? ' is-picked' : '') +
              (showRowActions ? ' has-actions' : '')
            }
            key={`${s.id}-${i}`}
          >
            <button
              type="button"
              className={'row song ' + (isPlayingRow ? 'selected' : isPickedRow ? 'picked' : '')}
              aria-current={isPlayingRow ? 'true' : undefined}
              onClick={() =>
                s.provider === 'netease'
                  ? setSelectedTrack({ provider: s.provider, id: s.id, accountId: s.accountId })
                  : play(s)
              }
              onDoubleClick={() => {
                if (s.provider === 'netease') play(s);
              }}
              onKeyDown={e => {
                if (s.provider === 'netease' && e.key === 'Enter') {
                  e.preventDefault();
                  play(s);
                }
              }}
            >
              <span className="number">
                {isPlayingRow ? (
                  buffering ? (
                    '…'
                  ) : (
                    <span className={'nr-eq-bars' + (playing ? ' is-playing' : '')} aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                  )
                ) : (
                  String(i + 1).padStart(2, '0')
                )}
              </span>
              <span className="song-name">
                <SongArtwork song={s} size={80} className="song-placeholder" />
                <span className="lw-track-copy">
                  <span className="lw-track-title-row">
                    <b title={s.name}>{s.name}</b>
                    {s.vip && (
                      <span className="nr-vip-chip" title="需要平台会员或绿钻完整播放">
                        VIP
                      </span>
                    )}
                  </span>
                  <small title={artist(s)}>{artist(s)}</small>
                </span>
              </span>
              <span className="nr-col-artist" title={artist(s)}>
                {artist(s)}
              </span>
              <span className="nr-col-album" title={album(s).name}>
                {album(s).name}
              </span>
              <span className="nr-col-dur">
                {s.duration || s.dt ? time((s.duration || s.dt) / 1000) : '—'}
              </span>
            </button>
            {showRowActions && s.provider === 'netease' && (
              <div className="nr-row-actions">
                {canLike && (
                  <button
                    type="button"
                    className={'nr-row-act nr-heart-btn' + (isLiked ? ' is-liked' : '')}
                    aria-label={isLiked ? `取消喜欢 ${s.name}` : `喜欢 ${s.name}`}
                    aria-pressed={isLiked}
                    title={isLiked ? '取消喜欢' : '喜欢'}
                    disabled={likeBusy}
                    onClick={() => onToggleLike(s)}
                  >
                    <Icon name={isLiked ? 'heartFill' : 'heart'} className="nr-icon is-xs" />
                  </button>
                )}
                {canCollect && (
                  <button
                    type="button"
                    className="nr-row-act"
                    aria-label={`收藏 ${s.name} 到歌单`}
                    title="收藏到歌单"
                    onClick={() => onOpenPlaylistPicker(s)}
                  >
                    <Icon name="plus" className="nr-icon is-xs" />
                  </button>
                )}
                {canRemoveFromPlaylist && (
                  <button
                    type="button"
                    className="nr-row-act is-danger"
                    aria-label={`从歌单移出 ${s.name}`}
                    title="从当前歌单移出"
                    disabled={isRemoving}
                    onClick={() => onRemoveFromPlaylist(s)}
                  >
                    <Icon name="trash" className="nr-icon is-xs" />
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const SKELETON_ROWS = [
  { titleW: '44%', artistW: '26%' },
  { titleW: '58%', artistW: '32%' },
  { titleW: '38%', artistW: '22%' },
  { titleW: '52%', artistW: '28%' },
  { titleW: '46%', artistW: '24%' },
  { titleW: '62%', artistW: '30%' },
  { titleW: '40%', artistW: '25%' },
];

export function TrackListSkeleton({ message }) {
  return (
    <div className="nr-skeleton-wrap" aria-busy="true">
      <div className="nr-skeleton-bar" role="status">
        <span className="nr-skeleton-dot" aria-hidden="true" />
        <span>{message || '正在加载曲目…'}</span>
      </div>
      <div className="table nr-skeleton-table" aria-hidden="true">
        {SKELETON_ROWS.map((row, idx) => (
          <div className="nr-skeleton-row" key={idx} style={{ '--sk-i': idx }}>
            <span className="nr-sk-num" />
            <span className="nr-sk-cover" />
            <span className="nr-sk-main">
              <i className="nr-sk-line" style={{ width: row.titleW }} />
              <i className="nr-sk-line is-sub" style={{ width: row.artistW }} />
            </span>
            <span className="nr-sk-dur" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function LocalEmptyState({
  foldersCount,
  hasQuery,
  query,
  busy,
  message,
  messageRole,
  onPickFolder,
  onScan,
  onClearQuery,
}) {
  return (
    <div className="empty">
      <div className="empty-intro nr-local-empty">
        <span className="nr-empty-kicker">本地音乐工作区</span>
        <h2>
          {hasQuery
            ? `没有匹配“${query}”的本地歌曲`
            : foldersCount > 0
              ? '所选目录暂无可播音频'
              : '把本机音乐放进深夜电台'}
        </h2>
        <p>
          {hasQuery
            ? '试试更换歌名、歌手或专辑关键词，或切回「全部本地歌曲」。'
            : '支持 MP3、FLAC、WAV、M4A、OGG 与同名 .lrc 歌词，全程离线播放，不上传任何本机路径。'}
        </p>

        <div className="nr-local-formats" aria-label="支持格式">
          <span>MP3</span>
          <span>FLAC</span>
          <span>WAV</span>
          <span>M4A</span>
          <span>OGG</span>
          <span>.LRC</span>
        </div>

        <div className="nr-local-empty-actions">
          {hasQuery ? (
            <button type="button" className="nr-primary-btn" onClick={onClearQuery}>
              清空筛选
            </button>
          ) : (
            <button
              type="button"
              className="nr-primary-btn"
              disabled={busy}
              onClick={onPickFolder}
            >
              <Icon name="folderPlus" className="nr-icon is-sm" />
              添加本地音乐文件夹
            </button>
          )}
          {foldersCount > 0 && !hasQuery && (
            <button type="button" className="nr-soft-btn" disabled={busy} onClick={onScan}>
              <Icon name="refresh" className="nr-icon is-sm" />
              {busy ? '扫描中…' : '重新扫描'}
            </button>
          )}
        </div>

        {message && (
          <InlineNotice tone={messageRole === 'alert' ? 'err' : 'ok'} role={messageRole}>
            {message}
          </InlineNotice>
        )}
      </div>
    </div>
  );
}

export function EmptyState({
  platformFlavor,
  noSearchResults,
  ws,
  message,
  messageRole,
  activeProvider,
  search,
  searchInput,
  query,
  setQuery,
  profile,
  lists,
  openList,
  searchHistory,
  onPickHistory,
  onClearHistory,
}) {
  const cards = Array.isArray(lists) ? lists : [];
  const metaOf = l => {
    const who = l.creator?.nickname || l.creator?.name || '';
    const n = Number.isFinite(Number(l.trackCount)) ? Number(l.trackCount) : null;
    return [who || '未知创建者', n == null ? '——' : `${n} 首`].join(' · ');
  };

  return (
    <div className="empty">
      <div className="empty-intro">
        <span className="nr-empty-kicker">
          {activeProvider === 'netease' ? '网易云音乐工作区' : 'QQ 音乐工作区'}
        </span>
        <h2>
          {noSearchResults
            ? `没有找到“${ws.searchQuery}”`
            : ws.trackOrigin === 'recent'
              ? '暂无本地播放记录'
              : message === '歌单为空'
                ? '歌单为空'
                : '找到想听的音乐'}
        </h2>
        <p>
          {noSearchResults
            ? '换个关键词，或切换浏览平台再搜。'
            : ws.trackOrigin === 'recent'
              ? '播放网易云歌曲后，这里会显示本机记录。'
              : message === '歌单为空'
                ? '可以选择其他歌单或搜索歌曲。'
                : activeProvider === 'qqmusic'
                  ? '搜索歌曲或歌手，浏览社区匿名结果。'
                  : '搜索歌曲或歌手，选一首开始今晚的波段。'}
        </p>

        <form className="empty-search" onSubmit={search}>
          <Icon name="search" className="nr-icon nr-search-ico" />
          <input
            ref={searchInput}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索歌曲、歌手"
            aria-label="搜索歌曲、歌手"
          />
          <button type="submit" aria-label="搜索">
            搜索
          </button>
        </form>

        {Array.isArray(searchHistory) && searchHistory.length > 0 && (
          <div className="nr-history-row" aria-label="最近搜索">
            <span className="nr-history-label">搜过</span>
            <div className="nr-history-chips">
              {searchHistory.map(term => (
                <button
                  key={term}
                  type="button"
                  className="nr-history-chip"
                  onClick={() => onPickHistory(term)}
                >
                  {term}
                </button>
              ))}
              <button
                type="button"
                className="nr-history-clear"
                onClick={onClearHistory}
                aria-label="清空搜索历史"
              >
                清空
              </button>
            </div>
          </div>
        )}

        {message !== '搜索歌曲，开始聆听' && (
          <InlineNotice tone={messageRole === 'alert' ? 'err' : 'ok'} role={messageRole}>
            {message}
          </InlineNotice>
        )}
      </div>

      <div className="empty-hint">
        <div className="nr-hint-head">
          <span>我的歌单</span>
          <p>
            {profile
              ? '从左侧选择歌单，或直接点下面的封面。'
              : activeProvider === 'qqmusic'
                ? platformFlavor.qqmusic === 'mock'
                  ? '进入模拟账号后浏览模拟歌单。'
                  : '登录后可查看 QQ 歌单。'
                : '登录后可在上方同步你的网易云歌单。'}
          </p>
        </div>
        {cards.length > 0 && (
          <div className="lw-card-grid">
            {cards.map(l => (
              <button
                key={l.id}
                type="button"
                className="lw-card"
                title={l.name}
                aria-label={`打开歌单：${l.name}`}
                onClick={() => openList(l)}
              >
                <span className="lw-card-cover">
                  <PlaylistCover className="lw-card-img" url={l.coverImgUrl} />
                  <span className="lw-card-play" aria-hidden="true">
                    <Icon name="next" />
                  </span>
                </span>
                <b className="lw-card-name">{l.name}</b>
                <small className="lw-card-meta">{metaOf(l)}</small>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function NowPanel({
  platformFlavor,
  song,
  playing,
  buffering,
  activeProvider,
  ws,
  lwPreview,
  lyricStatus,
  showLyrics,
  setShowLyrics,
  setShowNowDetails,
  setView,
  setShowQueue,
  setConfirmClear,
  qqDiagnosticEnabled,
  qqDiagnostic,
  toggleQqDiagnostic,
}) {
  return (
    <section id="now-details" className="now-panel" aria-label="正在播放">
      <button
        type="button"
        className="lw-close-details"
        onClick={() => setShowNowDetails(false)}
      >
        关闭播放详情
      </button>

      <div className="section-label">
        <span>正在播放</span>
        <span className="lw-status-pill" data-playing={playing ? 'true' : 'false'}>
          {buffering ? '缓冲中' : playing ? '播放中' : song ? '已暂停' : '待播放'}
        </span>
      </div>

      <div className={'cover-frame' + (!song ? ' is-empty' : '')}>
        <button
          type="button"
          className="lw-cover-link"
          aria-label="打开正在播放"
          onClick={() => {
            setView('stage');
            setShowLyrics(false);
          }}
        >
          <SongArtwork song={song} size={500} className="now-cover" variant="panel" />
        </button>
      </div>

      <div className="now-meta">
        <h2>
          <button
            type="button"
            className="lw-now-title"
            onClick={() => {
              setView('stage');
              setShowLyrics(false);
            }}
          >
            {song?.name || '从一首歌开始'}
          </button>
        </h2>
        {song && (
          <p>
            <SourceTag provider={song.provider} browsing={activeProvider} /> · {artist(song)}
          </p>
        )}
      </div>

      <div className="lyric-title">
        <button
          type="button"
          onClick={() => {
            setShowQueue(true);
            setConfirmClear(false);
          }}
        >
          播放队列 · {ws.queue?.tracks?.length || 0} 首
        </button>
      </div>

      {activeProvider === 'qqmusic' && platformFlavor.qqmusic === 'community' && (
        <>
          <div className="lyric-title">
            <button type="button" onClick={toggleQqDiagnostic} aria-pressed={qqDiagnosticEnabled}>
              QQ 播放诊断{qqDiagnosticEnabled ? '：开' : '：关'}
            </button>
          </div>
          {qqDiagnosticEnabled && (
            <div className="lyric-preview nr-diag-box" role="status" aria-label="QQ 播放诊断结果">
              {qqDiagnostic ? (
                <>
                  <p>
                    阶段：{qqDiagnostic.stage} · 会话字段：
                    {qqDiagnostic.session_fields ? '存在' : '未确认'} · 登录态：
                    {qqDiagnostic.uses_login ? '已附加请求' : '尚未附加请求'}
                  </p>
                  <p>
                    会话：{qqDiagnostic.session_validity} · 过期：{qqDiagnostic.session_expiry} ·
                    上游身份：{qqDiagnostic.upstream_identity_match}
                  </p>
                  <p>
                    参数结构：{qqDiagnostic.request_complete ? '完整' : '未确认'} ·
                    响应码（顶层/模块/曲目）：{qqDiagnostic.top_code ?? '未知'}/
                    {qqDiagnostic.module_code ?? '未知'}/{qqDiagnostic.business_code ?? '未知'} ·
                    地址结构和来源：{qqDiagnostic.valid_url ? '校验通过' : '未通过或未获得'}
                  </p>
                  <p>
                    账号代次：
                    {qqDiagnostic.generation_match == null
                      ? '未知'
                      : qqDiagnostic.generation_match
                        ? '匹配'
                        : '冲突'}{' '}
                    · 文件标识：{qqDiagnostic.media_mid_present ? '存在' : '缺失'} ·
                    与歌曲标识相同：
                    {qqDiagnostic.media_mid_matches_song_mid == null
                      ? '未知'
                      : qqDiagnostic.media_mid_matches_song_mid
                        ? '是'
                        : '否'}
                    {qqDiagnostic.failure ? ' · ' + qqDiagnostic.failure : ''}
                  </p>
                </>
              ) : (
                <p>尚无诊断结果</p>
              )}
            </div>
          )}
        </>
      )}

      <div className="lyric-title">
        <span>歌词片段</span>
        <button type="button" onClick={() => setShowLyrics(!showLyrics)}>
          {showLyrics ? '收起' : '查看歌词'}
        </button>
      </div>

      <div className="lyric-preview">
        {lwPreview.length ? (
          lwPreview.map((l, i) => (
            <p key={i} className={i === 0 ? 'highlight' : ''}>
              {l.text}
            </p>
          ))
        ) : (
          <p>
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
    </section>
  );
}
