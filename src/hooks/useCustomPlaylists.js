import { useEffect, useRef, useState } from 'react';
import {
  loadCustomPlaylists,
  saveCustomPlaylists,
  sanitizeCustomPlaylistsList,
  createCustomPlaylist,
  renameCustomPlaylist,
  deleteCustomPlaylist,
  addTrackToCustomPlaylist,
  removeTrackFromCustomPlaylist,
  exportCustomPlaylistsJson,
  importCustomPlaylistsJson,
  customTrackKey,
} from '../custom-playlists.js';

export function useCustomPlaylists({
  canCustomPlaylistsStorage,
  desktop,
  activeRef,
  view,
  setView,
  update,
  mixedQueueRef,
  setMixedQueue,
}) {
  const [pickerTrack, setPickerTrack] = useState(null);
  const [pickerBusyId, setPickerBusyId] = useState(null);
  const [pickerError, setPickerError] = useState('');

  const [customPlaylists, setCustomPlaylists] = useState(() => loadCustomPlaylists());
  const customPlaylistsRef = useRef(customPlaylists);
  const customPlaylistsSaveSeqRef = useRef(0);
  const customPlaylistsSaveChainRef = useRef(Promise.resolve());
  const [activeCustomPlaylistId, setActiveCustomPlaylistId] = useState(null);
  const [customPlaylistFilter, setCustomPlaylistFilter] = useState('');
  const [customPlaylistNotice, setCustomPlaylistNotice] = useState('');
  const [renamingCustomPlaylist, setRenamingCustomPlaylist] = useState(false);
  const [renameCustomDraft, setRenameCustomDraft] = useState('');
  const [confirmDeleteCustom, setConfirmDeleteCustom] = useState(false);
  const [customImportStatus, setCustomImportStatus] = useState('');

  const persistCustomPlaylistsToDisk = (list, seq) => {
    if (!canCustomPlaylistsStorage) return;
    customPlaylistsSaveChainRef.current = customPlaylistsSaveChainRef.current
      .catch(() => {})
      .then(async () => {
        if (seq !== customPlaylistsSaveSeqRef.current) return;
        await desktop.customPlaylistsSave({
          version: 1,
          playlists: Array.isArray(list) ? list : [],
        });
      })
      .catch(() => {});
  };

  const commitCustomPlaylists = next => {
    customPlaylistsRef.current = next;
    setCustomPlaylists(next);
    saveCustomPlaylists(next);
    const seq = ++customPlaylistsSaveSeqRef.current;
    persistCustomPlaylistsToDisk(next, seq);
    return next;
  };

  const openPlaylistPicker = track => {
    if (!track || !['netease', 'qqmusic', 'local'].includes(track.provider)) return;
    setPickerError('');
    setPickerTrack(track);
  };

  const handleCreateCustomPlaylist = rawName => {
    const res = createCustomPlaylist(customPlaylistsRef.current, rawName);
    if (res.error) return res;
    commitCustomPlaylists(res.playlists);
    setActiveCustomPlaylistId(res.created.id);
    setCustomPlaylistFilter('');
    setCustomPlaylistNotice(`已创建本机歌单「${res.created.name}」`);
    setRenamingCustomPlaylist(false);
    setConfirmDeleteCustom(false);
    if (view !== 'library') setView('library');
    return res;
  };

  const handleOpenCustomPlaylist = playlistId => {
    setActiveCustomPlaylistId(playlistId);
    setCustomPlaylistFilter('');
    setCustomPlaylistNotice('');
    setRenamingCustomPlaylist(false);
    setConfirmDeleteCustom(false);
    if (view !== 'library') setView('library');
  };

  const handleRenameCustomPlaylist = rawName => {
    if (!activeCustomPlaylistId) return { error: '未选中本机歌单' };
    const res = renameCustomPlaylist(customPlaylistsRef.current, activeCustomPlaylistId, rawName);
    if (res.error) {
      setCustomPlaylistNotice(res.error);
      return res;
    }
    commitCustomPlaylists(res.playlists);
    if (mixedQueueRef.current?.playlistId === activeCustomPlaylistId) {
      const nextMq = { ...mixedQueueRef.current, playlistName: res.renamed.name };
      mixedQueueRef.current = nextMq;
      setMixedQueue(nextMq);
    }
    setRenamingCustomPlaylist(false);
    setCustomPlaylistNotice(`已重命名为「${res.renamed.name}」`);
    return res;
  };

  const handleDeleteCustomPlaylist = playlistId => {
    const target = customPlaylistsRef.current.find(p => p.id === playlistId);
    const res = deleteCustomPlaylist(customPlaylistsRef.current, playlistId);
    if (!res.deleted) return;
    commitCustomPlaylists(res.playlists);
    if (activeCustomPlaylistId === playlistId) {
      setActiveCustomPlaylistId(null);
      setConfirmDeleteCustom(false);
      setCustomPlaylistNotice('');
    } else if (target) {
      setCustomPlaylistNotice(`已删除本机歌单「${target.name}」`);
    }
  };

  const handleAddTrackToCustom = (playlistId, track) => {
    const res = addTrackToCustomPlaylist(customPlaylistsRef.current, playlistId, track);
    if (res.error) {
      setPickerError(res.error);
      return;
    }
    if (res.duplicate) {
      setPickerError('该歌曲已在这个本机歌单中');
      return;
    }
    commitCustomPlaylists(res.playlists);
    const target = res.playlists.find(p => p.id === playlistId);
    const note = target ? `已加入本机歌单「${target.name}」` : '已加入本机歌单';
    if (activeCustomPlaylistId === playlistId) setCustomPlaylistNotice(note);
    else update(activeRef.current, { message: note });
    setPickerTrack(null);
    setPickerError('');
  };

  const handleCreateAndAddCustom = (rawName, track) => {
    const created = createCustomPlaylist(customPlaylistsRef.current, rawName);
    if (created.error) return created;
    const added = addTrackToCustomPlaylist(created.playlists, created.created.id, track);
    if (added.error) return added;
    commitCustomPlaylists(added.playlists);
    const note = `已新建「${created.created.name}」并收入 1 首歌曲`;
    update(activeRef.current, { message: note });
    setPickerTrack(null);
    setPickerError('');
    return added;
  };

  const handleRemoveTrackFromCustom = (playlistId, track) => {
    const key = track.customKey || customTrackKey(track);
    if (!key) return;
    const res = removeTrackFromCustomPlaylist(customPlaylistsRef.current, playlistId, key);
    if (!res.removed) return;
    commitCustomPlaylists(res.playlists);
    setCustomPlaylistNotice(`已从本机歌单移出「${track.name}」`);
  };

  const handleExportCustomPlaylists = () => {
    const json = exportCustomPlaylistsJson(customPlaylistsRef.current);
    try {
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vesper-playlists-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setCustomImportStatus('已导出本机跨源歌单 JSON 备份');
      if (activeCustomPlaylistId) setCustomPlaylistNotice('已导出本机跨源歌单 JSON 备份');
    } catch {
      setCustomImportStatus('导出备份失败，请重试');
    }
  };

  const handleImportCustomPlaylists = async file => {
    if (!file) return;
    try {
      const text = await file.text();
      const res = importCustomPlaylistsJson(text, customPlaylistsRef.current);
      if (res.error) {
        setCustomImportStatus(res.error);
        if (activeCustomPlaylistId) setCustomPlaylistNotice(res.error);
        return;
      }
      commitCustomPlaylists(res.playlists);
      const summary =
        res.addedPlaylists || res.addedTracks
          ? `已导入 ${res.addedPlaylists} 个歌单、新增 ${res.addedTracks} 首曲目`
          : '备份内曲目已全部存在，未产生重复新增';
      setCustomImportStatus(summary);
      if (activeCustomPlaylistId) setCustomPlaylistNotice(summary);
    } catch {
      setCustomImportStatus('无法读取所选备份文件');
    }
  };

  // 启动同步本机跨源歌单持久化文件（app_data_dir()/custom-playlists.json）与旧缓存自动迁移
  useEffect(() => {
    if (!canCustomPlaylistsStorage) return undefined;
    let active = true;
    const seqAtLoad = customPlaylistsSaveSeqRef.current;
    desktop
      .customPlaylistsLoad()
      .then(res => {
        if (!active) return;
        const diskList =
          res?.status === 'ok' && Array.isArray(res?.data?.playlists)
            ? sanitizeCustomPlaylistsList(res.data.playlists)
            : [];
        if (diskList.length > 0) {
          if (customPlaylistsSaveSeqRef.current !== seqAtLoad) {
            const diskIds = new Set(diskList.map(pl => pl.id));
            const localChanges = customPlaylistsRef.current.filter(pl => !diskIds.has(pl.id));
            const merged = sanitizeCustomPlaylistsList([...localChanges, ...diskList]);
            customPlaylistsRef.current = merged;
            setCustomPlaylists(merged);
            saveCustomPlaylists(merged);
            const seq = ++customPlaylistsSaveSeqRef.current;
            persistCustomPlaylistsToDisk(merged, seq);
          } else {
            customPlaylistsRef.current = diskList;
            setCustomPlaylists(diskList);
            saveCustomPlaylists(diskList);
          }
        } else if (
          (res?.status === 'empty' || (res?.status === 'ok' && diskList.length === 0)) &&
          customPlaylistsRef.current.length > 0
        ) {
          const seq = ++customPlaylistsSaveSeqRef.current;
          persistCustomPlaylistsToDisk(customPlaylistsRef.current, seq);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [canCustomPlaylistsStorage]);

  const activeCustomPlaylist = activeCustomPlaylistId
    ? customPlaylists.find(p => p.id === activeCustomPlaylistId) || null
    : null;
  const customTotalTracks = customPlaylists.reduce((sum, pl) => sum + pl.tracks.length, 0);

  return {
    pickerTrack,
    setPickerTrack,
    pickerBusyId,
    setPickerBusyId,
    pickerError,
    setPickerError,
    customPlaylists,
    activeCustomPlaylistId,
    setActiveCustomPlaylistId,
    customPlaylistFilter,
    setCustomPlaylistFilter,
    customPlaylistNotice,
    setCustomPlaylistNotice,
    renamingCustomPlaylist,
    setRenamingCustomPlaylist,
    renameCustomDraft,
    setRenameCustomDraft,
    confirmDeleteCustom,
    setConfirmDeleteCustom,
    customImportStatus,
    activeCustomPlaylist,
    customTotalTracks,
    openPlaylistPicker,
    handleCreateCustomPlaylist,
    handleOpenCustomPlaylist,
    handleRenameCustomPlaylist,
    handleDeleteCustomPlaylist,
    handleAddTrackToCustom,
    handleCreateAndAddCustom,
    handleRemoveTrackFromCustom,
    handleExportCustomPlaylists,
    handleImportCustomPlaylists,
  };
}
