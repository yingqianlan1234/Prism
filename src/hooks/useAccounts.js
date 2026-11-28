import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

/**
 * 封装网易云与 QQ 音乐账号认证、启动会话恢复、扫码轮询、网页授权、退出清理与 QQ 诊断。
 */
export function useAccounts({
  getProvider,
  capabilities,
  platformFlavor,
  canUseQq,
  activeRef,
  workRef,
  update,
  account,
  identity,
  browse,
  qrRequest,
  fm,
  fmAutoStartRef,
  recommendationPending,
  listening,
  saved,
  playback,
  errorText,
  clearProviderSavedState,
  stopProviderPlayback,
  restoreSaved,
  restoreQq,
  loadLikedIds,
  resetNeteaseBrowseState,
  clearPicker,
}) {
  const [qqWebOpen, setQqWebOpen] = useState(false);
  const [qr, setQr] = useState(null);
  const [qqDiagnostic, setQqDiagnostic] = useState(null);
  const [qqDiagnosticEnabled, setQqDiagnosticEnabled] = useState(false);
  const qqDiagnosticOn = useRef(false);
  const bootProvider = useRef('netease');

  const refreshQqDiagnostic = async () => {
    if (!qqDiagnosticOn.current) return;
    try {
      const result = await invoke('qq_playback_diagnostic');
      if (qqDiagnosticOn.current) setQqDiagnostic(result.diagnostic);
    } catch {
      if (qqDiagnosticOn.current) setQqDiagnostic(null);
    }
  };

  const toggleQqDiagnostic = async () => {
    const enabled = !qqDiagnosticOn.current;
    try {
      const result = await invoke('qq_playback_diagnostic', { enabled });
      qqDiagnosticOn.current = enabled;
      setQqDiagnosticEnabled(enabled);
      setQqDiagnostic(result.diagnostic);
    } catch {
      update('qqmusic', { message: 'QQ 诊断开关不可用' });
    }
  };

  const clearAccountContent = id => {
    clearProviderSavedState(id);
    if (id === 'netease') {
      recommendationPending.current = false;
      fmAutoStartRef.current = null;
      fm.current = {
        accountId: null,
        tracks: [],
        seen: new Set(),
        pending: null,
        error: '',
        generation: fm.current.generation + 1,
      };
      resetNeteaseBrowseState();
      clearPicker();
    }
    identity.current[id].next();
    browse.current[id].next();
    stopProviderPlayback(id);
    update(id, {
      songs: [],
      lists: [],
      recommendLists: null,
      queue: null,
      listPage: 0,
      listsBusy: false,
      qqPlaylist: null,
      qqTrackPage: 0,
      qqHasMore: null,
      searchType: 1,
      searchTotal: null,
      searchItems: [],
      storageStatus: '',
      title: '发现音乐',
    });
  };

  const loadLists = async (id, token, page = 1, append = false) => {
    update(id, { ...(append ? {} : { lists: [] }), listsBusy: true, listStatus: '正在加载歌单…' });
    try {
      const p = await getProvider(id);
      const d = await p.getPlaylists({ page });
      if (!account.current[id].isCurrent(token)) return;
      if (!Array.isArray(d.playlist)) throw Error('歌单列表数据不完整');
      const items = append
        ? [
            ...workRef.current[id].lists,
            ...d.playlist.filter(
              x => !workRef.current[id].lists.some(old => String(old.id) === String(x.id))
            ),
          ]
        : d.playlist;
      update(id, {
        lists: items,
        listPage: page,
        listsBusy: false,
        listStatus:
          id === 'qqmusic'
            ? d.playlist.length
              ? ''
              : '本页没有更多歌单'
            : d.more
              ? '仅显示部分歌单（最多 100 个）'
              : d.more === false
                ? items.length
                  ? ''
                  : '暂无歌单'
                : '歌单列表分页状态未知（最多 100 个）',
      });
    } catch (e) {
      if (account.current[id].isCurrent(token)) {
        update(id, { listsBusy: false, listStatus: '歌单加载失败：' + errorText(e) });
      }
    }
  };

  const restore = async (id = activeRef.current) => {
    const token = account.current[id].next();
    update(id, { accountBusy: true });
    try {
      const p = await getProvider(id);
      if (!p.capabilities.restoreSession) {
        clearAccountContent(id);
        update(id, { profile: null, identityUnknown: false, lists: [], listStatus: '' });
        return;
      }
      const d = await p.restoreSession();
      if (!account.current[id].isCurrent(token)) return;
      const next = d?.profile;
      if (!d || !Object.hasOwn(d, 'profile') || (next != null && !next.userId)) {
        clearAccountContent(id);
        update(id, {
          profile: null,
          identityUnknown: true,
          listStatus: '账号资料不完整，请刷新账号',
        });
        return;
      }
      const old = workRef.current[id];
      if ((old.profile?.userId || null) !== (next?.userId || null) || old.identityUnknown) {
        clearAccountContent(id);
      }
      update(id, { profile: next || null, identityUnknown: false });
      if (id === 'netease' && next?.userId) {
        void restoreSaved(
          next.userId,
          identity.current.netease.current(),
          playback.current.current()
        );
        void loadLikedIds(token, next.userId);
      }
      if (id === 'qqmusic' && next?.userId) {
        await restoreQq(next.userId, identity.current.qqmusic.current());
      }
      if (next?.userId && capabilities[id].getPlaylists) await loadLists(id, token);
      else update(id, { lists: [], listStatus: '' });
    } catch (e) {
      if (account.current[id].isCurrent(token)) {
        update(id, { listStatus: '账号刷新失败：' + errorText(e) });
      }
    } finally {
      if (account.current[id].isCurrent(token)) update(id, { accountBusy: false });
    }
  };

  const closeQr = () => {
    const id = qr?.provider || 'netease';
    qrRequest.current.next();
    setQr(null);
    getProvider(id)
      .then(p => p.qrCancel())
      .catch(e => update(id, { message: errorText(e) }));
  };

  const login = async () => {
    const id = activeRef.current;
    const token = account.current[id].next();
    browse.current[id].next();
    update(id, { accountBusy: true });
    try {
      const p = await getProvider(id);
      if (id === 'netease') {
        const qrToken = qrRequest.current.next();
        const d = await p.login();
        if (!qrRequest.current.isCurrent(qrToken) || !account.current[id].isCurrent(token)) return;
        if (!d.image) throw Error('未取得登录二维码');
        setQr({ ...d, provider: id });
      } else if (id === 'qqmusic' && platformFlavor.qqmusic !== 'mock') {
        const d = await p.login();
        if (!account.current[id].isCurrent(token)) return;
        if (d?.opened !== true) throw Error('无法打开 QQ 授权窗口');
        setQqWebOpen(true);
      } else {
        const d = await p.login();
        if (!account.current[id].isCurrent(token)) return;
        clearAccountContent(id);
        update(id, {
          profile: d.profile,
          identityUnknown: false,
          message: '已进入 QQ 模拟账号',
        });
        await loadLists(id, token);
      }
    } catch (e) {
      if (account.current[id].isCurrent(token)) update(id, { message: errorText(e) });
    } finally {
      if (account.current[id].isCurrent(token)) update(id, { accountBusy: false });
    }
  };

  const cancelQqWeb = async () => {
    account.current.qqmusic.next();
    setQqWebOpen(false);
    try {
      const p = await getProvider('qqmusic');
      await p.loginCancel();
    } catch (e) {
      update('qqmusic', { message: '无法关闭 QQ 授权：' + errorText(e) });
    }
  };

  const completeQqWeb = async () => {
    const id = 'qqmusic';
    const token = account.current[id].next();
    update(id, { accountBusy: true });
    try {
      const p = await getProvider(id);
      const d = await p.loginComplete();
      if (!account.current[id].isCurrent(token)) return;
      const user = d?.profile;
      if (!user?.userId) throw Error('QQ 账号资料不完整');
      clearAccountContent(id);
      update(id, { profile: user, identityUnknown: false, message: 'QQ 账号已验证' });
      setQqWebOpen(false);
      await restoreQq(user.userId, identity.current.qqmusic.current());
      if (p.capabilities.getPlaylists) await loadLists(id, token);
    } catch (e) {
      if (account.current[id].isCurrent(token)) {
        update(id, { message: 'QQ 登录未完成：' + errorText(e) });
      }
    } finally {
      if (account.current[id].isCurrent(token)) update(id, { accountBusy: false });
    }
  };

  const logout = async () => {
    const id = activeRef.current;
    const token = account.current[id].next();
    browse.current[id].next();
    update(id, { accountBusy: true });
    try {
      const p = await getProvider(id);
      const result = await p.logout();
      if (!account.current[id].isCurrent(token)) return;
      if (result?.localCleared !== true) throw Error('无法确认本机退出状态');
      clearAccountContent(id);
      update(id, {
        profile: null,
        identityUnknown: false,
        listStatus: '',
        message:
          id === 'qqmusic' && platformFlavor.qqmusic === 'mock'
            ? '已退出模拟账号'
            : result.remoteRevoked
              ? '已退出登录'
              : '本机已退出，远端状态未确认',
      });
    } catch (e) {
      if (account.current[id].isCurrent(token)) update(id, { message: '退出失败：' + errorText(e) });
    } finally {
      if (account.current[id].isCurrent(token)) update(id, { accountBusy: false });
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const last = await invoke('playback_state_load', { provider: 'last' });
        if (!active) return;
        bootProvider.current =
          canUseQq && last?.status === 'ok' && last.provider === 'qqmusic' ? 'qqmusic' : 'netease';
      } catch {}
      if (!active) return;
      if (bootProvider.current === 'qqmusic') {
        await restore('qqmusic');
        if (!active) return;
      }
      await restore('netease');
    })();
    return () => {
      active = false;
      for (const id of ['netease', 'qqmusic']) {
        account.current[id].next();
        identity.current[id].next();
        browse.current[id].next();
      }
      qrRequest.current.next();
      playback.current.next();
      listening.current.clear();
      if (saved.current.timer) clearTimeout(saved.current.timer);
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    let unlisten;
    import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen('qq-auth-cleanup-failed', () =>
          update('qqmusic', { message: 'QQ 授权临时数据未能清理，请检查本机应用数据' })
        )
      )
      .then(fn => {
        if (stopped) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      stopped = true;
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    if (!qr) return;
    const id = qr.provider;
    const token = qrRequest.current.current();
    let timer;
    let active = true;
    const poll = async () => {
      try {
        const p = await getProvider(id);
        const d = await p.qrCheck();
        if (!active || !qrRequest.current.isCurrent(token)) return;
        if (d.code === 803) {
          setQr(null);
          const accountToken = account.current[id].next();
          const userId = d.profile?.userId || null;
          const old = workRef.current[id];
          if ((old.profile?.userId || null) !== userId || !userId) clearAccountContent(id);
          update(id, {
            profile: userId ? d.profile : null,
            identityUnknown: !userId,
            message: userId ? '登录成功' : '账号身份待确认',
            listStatus: userId ? '' : '账号资料不完整，请刷新账号',
          });
          if (id === 'netease' && userId) {
            void restoreSaved(
              userId,
              identity.current.netease.current(),
              playback.current.current()
            );
            void loadLikedIds(accountToken, userId);
          }
          if (userId && capabilities[id].getPlaylists) loadLists(id, accountToken);
          return;
        }
        if (d.code === 800) {
          setQr(null);
          update(id, { message: '二维码已过期或被拒绝，请重新登录' });
          return;
        }
      } catch (e) {
        if (active && qrRequest.current.isCurrent(token)) {
          update(id, { message: errorText(e) });
          setQr(null);
          getProvider(id)
            .then(p => p.qrCancel())
            .catch(() => {});
        }
        return;
      }
      if (active) timer = setTimeout(poll, 2500);
    };
    timer = setTimeout(poll, 2500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [qr]);

  return {
    qr,
    qqWebOpen,
    qqDiagnostic,
    qqDiagnosticEnabled,
    refreshQqDiagnostic,
    toggleQqDiagnostic,
    loadLists,
    restore,
    closeQr,
    login,
    cancelQqWeb,
    completeQqWeb,
    logout,
  };
}
