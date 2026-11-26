import React, { useLayoutEffect, useRef } from 'react';
import { Icon } from './Icons.jsx';

export function AppHeader({
  capabilities,
  platformFlavor,
  canLocalLibrary,
  isListLoading,
  view,
  showLyrics,
  setView,
  setShowLyrics,
  activeProvider,
  switchProvider,
  songs,
  recommendLists,
  search,
  searchInput,
  query,
  setQuery,
  profile,
  identityUnknown,
  accountBusy,
  restore,
  login,
  logout,
  onHome,
}) {
  const accountName = identityUnknown ? '身份未知' : profile?.nickname || '';
  const refreshText = identityUnknown ? '刷新账号' : (accountName || '账号') + ' · 刷新';
  const signedIn = !!(profile || identityUnknown);
  const canUseQq = capabilities?.qqmusic?.available !== false;

  const navRef = useRef(null);
  const animatedRef = useRef(false);
  const provRef = useRef(null);
  const provAnimatedRef = useRef(false);

  useLayoutEffect(() => {
    const prov = provRef.current;
    if (!prov) return undefined;
    const syncProvSlider = () => {
      const active = prov.querySelector('button[aria-pressed="true"]');
      if (!active || active.offsetWidth <= 0) return;
      prov.style.setProperty('--nr-prov-x', `${active.offsetLeft}px`);
      prov.style.setProperty('--nr-prov-w', `${active.offsetWidth}px`);
      prov.dataset.measured = 'true';
      if (!provAnimatedRef.current) {
        provAnimatedRef.current = true;
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => {
            if (provRef.current) provRef.current.dataset.animate = 'true';
          });
        }
      }
    };
    syncProvSlider();
    if (typeof ResizeObserver !== 'function') return undefined;
    const ro = new ResizeObserver(syncProvSlider);
    ro.observe(prov);
    return () => ro.disconnect();
  }, [activeProvider, platformFlavor.qqmusic, canLocalLibrary, canUseQq]);

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return undefined;
    const syncSlider = () => {
      const active = nav.querySelector('button[aria-current="page"]');
      if (!active || active.offsetWidth <= 0) return;
      nav.style.setProperty('--nr-nav-x', `${active.offsetLeft}px`);
      nav.style.setProperty('--nr-nav-w', `${active.offsetWidth}px`);
      nav.dataset.measured = 'true';
      if (!animatedRef.current) {
        animatedRef.current = true;
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => {
            if (navRef.current) navRef.current.dataset.animate = 'true';
          });
        }
      }
    };
    syncSlider();
    if (typeof ResizeObserver !== 'function') return undefined;
    const ro = new ResizeObserver(syncSlider);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [view, showLyrics]);

  return (
    <header className="topbar">
      <div className="nr-top-left">
        <button type="button" className="brand" onClick={onHome} aria-label="Vesper，返回音乐库">
          <span className="nr-lamp-dot" aria-hidden="true" />
          <span>
            <b>Vesper</b>
          </span>
        </button>

        <div ref={provRef} className="provider-switch" role="group" aria-label="浏览平台">
          <span className="lw-browse-label sr-only">浏览</span>
          <button
            type="button"
            aria-pressed={activeProvider === 'netease'}
            onClick={() => switchProvider('netease')}
          >
            网易云
          </button>
          {canUseQq && (
            <button
              type="button"
              aria-pressed={activeProvider === 'qqmusic'}
              onClick={() => switchProvider('qqmusic')}
            >
              {platformFlavor.qqmusic === 'mock' ? 'QQ 模拟' : 'QQ 音乐'}
            </button>
          )}
          {canLocalLibrary && (
            <button
              type="button"
              aria-pressed={activeProvider === 'local'}
              onClick={() => switchProvider('local')}
            >
              本地
            </button>
          )}
          <span className="nr-prov-slider" aria-hidden="true" />
        </div>
      </div>

      <nav ref={navRef} className="lw-nav" aria-label="主视图">
        <button
          type="button"
          aria-current={view === 'library' ? 'page' : undefined}
          onClick={() => {
            setView('library');
            setShowLyrics(false);
          }}
        >
          曲库
        </button>
        <button
          type="button"
          aria-current={view === 'stage' && !showLyrics ? 'page' : undefined}
          onClick={() => {
            setView('stage');
            setShowLyrics(false);
          }}
        >
          正在播放
        </button>
        <button
          type="button"
          aria-current={view === 'stage' && showLyrics ? 'page' : undefined}
          onClick={() => {
            setView('stage');
            setShowLyrics(true);
          }}
        >
          歌词
        </button>
        <span className="nr-nav-slider" aria-hidden="true" />
      </nav>

      <div className="nr-top-right">
        {(songs.length > 0 || recommendLists !== null || isListLoading || (activeProvider === 'local' && query)) && (
          <form className="nr-top-search" onSubmit={search}>
            <Icon name="search" className="nr-icon nr-search-ico" />
            <input
              ref={searchInput}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={activeProvider === 'local' ? '筛选本地歌曲、歌手、专辑' : '搜索歌曲、歌手'}
              aria-label={activeProvider === 'local' ? '筛选本地歌曲、歌手、专辑' : '搜索歌曲、歌手'}
            />
            <button type="submit" aria-label={activeProvider === 'local' ? '筛选' : '搜索'}>
              {activeProvider === 'local' ? '筛选' : '搜索'}
            </button>
          </form>
        )}

        {activeProvider !== 'local' && (
          <div className="nr-account-cluster">
          {(activeProvider === 'netease' || capabilities[activeProvider].login) &&
            (signedIn ? (
              <>
                <span className="account-name" title={accountName}>
                  {accountName}
                </span>
                <button
                  type="button"
                  className="account-refresh"
                  title="刷新账号信息"
                  aria-label="刷新账号信息"
                  data-loading={accountBusy ? 'true' : 'false'}
                  disabled={accountBusy}
                  onClick={() => restore()}
                >
                  <Icon name="refresh" />
                  <span className="sr-only">{refreshText}</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                className="account is-login"
                disabled={accountBusy}
                onClick={login}
              >
                {accountBusy
                  ? '账号处理中…'
                  : activeProvider === 'qqmusic'
                    ? platformFlavor.qqmusic === 'mock'
                      ? '进入模拟账号'
                      : 'QQ / 微信登录'
                    : '扫码登录'}
              </button>
            ))}

          {(activeProvider === 'netease' || capabilities[activeProvider].logout) && signedIn && (
            <button type="button" className="account" disabled={accountBusy} onClick={logout}>
              {identityUnknown ? '退出本机账号' : '退出'}
            </button>
          )}
          </div>
        )}
      </div>
    </header>
  );
}
