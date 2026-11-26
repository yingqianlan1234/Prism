import React, { useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Icon } from './Icons.jsx';

function isTauriRuntime() {
  return Boolean(
    typeof window !== 'undefined' &&
      window.__TAURI_INTERNALS__?.metadata?.currentWindow
  );
}

const PROVIDER_LABELS = {
  netease: '网易云',
  qqmusic: 'QQ 音乐',
  local: '本地',
};

export function AppHeader({
  capabilities,
  platformFlavor,
  canLocalLibrary,
  isListLoading,
  view,
  setView,
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
  updateAttention = false,
  updateHint = '',
}) {
  const accountName = identityUnknown ? '身份未知' : profile?.nickname || '';
  const refreshText = identityUnknown ? '刷新账号' : (accountName || '账号') + ' · 刷新';
  const signedIn = !!(profile || identityUnknown);

  const [tunerOpen, setTunerOpen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const tunerRef = useRef(null);
  const tauriMode = isTauriRuntime();

  const currentProviderLabel =
    activeProvider === 'qqmusic' && platformFlavor.qqmusic === 'mock'
      ? 'QQ 模拟'
      : PROVIDER_LABELS[activeProvider] || '网易云';

  const providerOptions = [
    { id: 'netease', label: '网易云' },
    { id: 'qqmusic', label: platformFlavor.qqmusic === 'mock' ? 'QQ 模拟' : 'QQ 音乐' },
    ...(canLocalLibrary ? [{ id: 'local', label: '本地' }] : []),
  ];

  // 点击外部或按 Esc 自动收起波段扩张胶囊
  useEffect(() => {
    if (!tunerOpen) return undefined;
    const onPointerDown = e => {
      if (tunerRef.current && !tunerRef.current.contains(e.target)) {
        setTunerOpen(false);
      }
    };
    const onKeyDown = e => {
      if (e.key === 'Escape') setTunerOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [tunerOpen]);

  // 同步窗口最大化状态（仅 Tauri 桌面运行时）
  useEffect(() => {
    if (!tauriMode) return undefined;
    let disposed = false;
    let unlisten = null;
    try {
      const win = getCurrentWindow();
      const syncMaximized = () => {
        win
          ?.isMaximized?.()
          .then(max => {
            if (!disposed) setIsMaximized(Boolean(max));
          })
          .catch(() => {});
      };
      syncMaximized();
      win
        ?.onResized?.(() => {
          syncMaximized();
        })
        .then(fn => {
          if (disposed) fn?.();
          else unlisten = fn;
        })
        .catch(() => {});
    } catch {}
    return () => {
      disposed = true;
      if (typeof unlisten === 'function') unlisten();
    };
  }, [tauriMode]);

  const handleDragStart = e => {
    if (!tauriMode || e.button !== 0) return;
    if (e.target.closest('button,input,form,a,[role="button"],.nr-brand-tuner,.nr-top-search,.nr-account-cluster,.nr-win-controls')) {
      return;
    }
    try {
      void getCurrentWindow().startDragging();
    } catch {}
  };

  const handleHeaderDoubleClick = e => {
    if (!tauriMode) return;
    if (e.target.closest('button,input,form,a,[role="button"],.nr-brand-tuner,.nr-top-search,.nr-account-cluster,.nr-win-controls')) {
      return;
    }
    try {
      void getCurrentWindow().toggleMaximize();
    } catch {}
  };

  const handleSelectProvider = nextId => {
    setTunerOpen(false);
    switchProvider(nextId);
    if (view !== 'library') {
      setView('library');
    }
  };

  return (
    <header
      className="topbar"
      data-tauri-drag-region={tauriMode ? '' : undefined}
      onMouseDown={handleDragStart}
      onDoubleClick={handleHeaderDoubleClick}
    >
      <div className="nr-top-left">
        <div
          ref={tunerRef}
          className="nr-brand-tuner"
          data-expanded={tunerOpen ? 'true' : 'false'}
        >
          <button
            type="button"
            className="brand nr-tuner-trigger"
            aria-expanded={tunerOpen}
            aria-label={`Vesper，当前来源 ${currentProviderLabel}，点击切换来源`}
            title="点击展开切换音乐来源"
            onClick={() => setTunerOpen(v => !v)}
          >
            <span className="nr-lamp-dot" aria-hidden="true" />
            <span className="nr-tuner-brand">Vesper</span>
            <span className="nr-tuner-sep" aria-hidden="true">·</span>
            <span className="nr-tuner-current">{currentProviderLabel}</span>
            <Icon name="chevronDown" className="nr-icon is-xs nr-tuner-chev" />
          </button>

          <div
            className="nr-tuner-drawer provider-switch"
            role="group"
            aria-label="浏览平台"
          >
            <div className="nr-tuner-drawer-inner">
              {providerOptions.map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  className="nr-tuner-opt"
                  aria-pressed={activeProvider === opt.id}
                  onClick={() => handleSelectProvider(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {view !== 'library' && (
          <button
            type="button"
            className="nr-top-back"
            onClick={() => setView('library')}
            aria-label="返回音乐库"
            title="返回音乐库 (Esc)"
          >
            <Icon name="arrowLeft" className="nr-icon is-xs" />
            <span>返回曲库</span>
          </button>
        )}
      </div>

      <div className="nr-top-center">
        {view === 'library' &&
          (songs.length > 0 || recommendLists !== null || isListLoading || (activeProvider === 'local' && query)) && (
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
      </div>

      <div className="nr-top-right">
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
                        : 'QQ 登录'
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

        <button
          type="button"
          className={'nr-top-settings-btn' + (view === 'settings' ? ' is-active' : '')}
          aria-label={updateHint ? `设置（${updateHint}）` : '设置'}
          title={updateHint ? `设置（${updateHint}）` : '设置'}
          aria-pressed={view === 'settings'}
          onClick={() => setView(view === 'settings' ? 'library' : 'settings')}
        >
          <Icon name="settings" className="nr-icon is-sm" />
          <span className="lw-dot" data-on={updateAttention ? 'true' : 'false'} aria-hidden="true" />
        </button>

        {tauriMode && (
          <div className="nr-win-controls" role="group" aria-label="窗口控制">
            <button
              type="button"
              className="nr-win-btn"
              aria-label="最小化窗口"
              title="最小化"
              onClick={() => {
                try {
                  void getCurrentWindow().minimize();
                } catch {}
              }}
            >
              <Icon name="winMin" className="nr-icon is-xs" />
            </button>
            <button
              type="button"
              className="nr-win-btn"
              aria-label={isMaximized ? '还原窗口' : '最大化窗口'}
              title={isMaximized ? '向下还原' : '最大化'}
              onClick={() => {
                try {
                  void getCurrentWindow().toggleMaximize();
                } catch {}
              }}
            >
              <Icon name={isMaximized ? 'winRestore' : 'winMax'} className="nr-icon is-xs" />
            </button>
            <button
              type="button"
              className="nr-win-btn is-close"
              aria-label="关闭窗口"
              title="关闭"
              onClick={() => {
                try {
                  void getCurrentWindow().close();
                } catch {}
              }}
            >
              <Icon name="winClose" className="nr-icon is-xs" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
