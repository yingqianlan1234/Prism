import React, { useEffect, useState } from 'react';
import {
  artist,
  providerLabel,
  NETEASE_QUALITIES,
  QUALITY_LABELS,
  SHORTCUT_MODIFIERS,
  SHORTCUT_KEY_GROUPS,
  SHORTCUT_ACTIONS,
  DEFAULT_SHORTCUT_BINDINGS,
  parseShortcutBinding,
  formatShortcutBinding,
  findDuplicateShortcutActions,
  hasTextSelectionShortcutWarning,
} from '../utils/format.js';
import { Icon } from './Icons.jsx';
import { PlaylistCover } from './Artwork.jsx';

const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2];
const SLEEP_OPTIONS = [
  { id: 'off', label: '关' },
  { id: '15', label: '15分' },
  { id: '30', label: '30分' },
  { id: '60', label: '60分' },
  { id: 'track', label: '播完本首' },
];

export function MoreSettingsPanel({
  showMore,
  setShowMore,
  playbackRate,
  onChangeRate,
  sleepMode,
  onSelectSleep,
  canSelectQuality,
  neteaseQuality,
  onChangeQuality,
  song,
  trackQuality,
  onReloadWithQuality,
  isStageActive,
  onOpenNowPlaying,
  closeMode,
  onOpenCloseSettings,
  canDesktopLyric,
  desktopLyric,
  desktopLyricBusy,
  desktopLyricError,
  onToggleDesktopLyric,
  onToggleDesktopLyricLock,
  canGlobalShortcuts,
  globalShortcuts,
  onOpenShortcuts,
}) {
  const canReloadQuality =
    canSelectQuality &&
    song?.provider === 'netease' &&
    trackQuality?.level &&
    trackQuality.level !== neteaseQuality;
  return (
    <div id="lw-more-panel" className="lw-more" role="dialog" aria-label="更多设置" hidden={!showMore}>
      <div className="nr-more-group">
        <span className="nr-more-label">播放倍速</span>
        <div className="nr-seg-pills" role="group" aria-label="播放倍速">
          {PLAYBACK_RATES.map(r => (
            <button
              key={r}
              type="button"
              className={'nr-seg-btn' + (playbackRate === r ? ' is-on' : '')}
              aria-pressed={playbackRate === r}
              onClick={() => onChangeRate(r)}
            >
              {r}×
            </button>
          ))}
        </div>
      </div>

      <div className="nr-more-group">
        <span className="nr-more-label">睡眠定时</span>
        <div className="nr-seg-pills" role="group" aria-label="睡眠定时">
          {SLEEP_OPTIONS.map(opt => (
            <button
              key={opt.id}
              type="button"
              className={'nr-seg-btn' + (sleepMode === opt.id ? ' is-on' : '')}
              aria-pressed={sleepMode === opt.id}
              onClick={() => onSelectSleep(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {canSelectQuality && (
        <div className="nr-more-group">
          <div className="nr-more-label-row">
            <span className="nr-more-label">网易云音质</span>
            {song?.provider === 'netease' && trackQuality?.level && (
              <span className="nr-more-sub">
                当前：{QUALITY_LABELS[trackQuality.level] || trackQuality.level}
              </span>
            )}
          </div>
          <div className="nr-seg-pills" role="group" aria-label="网易云音质">
            {NETEASE_QUALITIES.map(q => (
              <button
                key={q.id}
                type="button"
                className={'nr-seg-btn' + (neteaseQuality === q.id ? ' is-on' : '')}
                aria-pressed={neteaseQuality === q.id}
                onClick={() => onChangeQuality(q.id)}
              >
                {q.label}
              </button>
            ))}
          </div>
          {canReloadQuality && (
            <button type="button" className="nr-more-reload" onClick={onReloadWithQuality}>
              按当前设置重载本首
            </button>
          )}
        </div>
      )}

      {canDesktopLyric && (
        <div className="nr-more-group">
          <div className="nr-more-label-row">
            <span className="nr-more-label">桌面歌词</span>
            {desktopLyric?.enabled && (
              <span className="nr-more-sub">{desktopLyric.locked ? '已锁定穿透' : '可拖拽位置'}</span>
            )}
          </div>
          <div className="nr-more-desktop-row" role="group" aria-label="桌面歌词控制">
            <button
              type="button"
              className={'nr-seg-btn' + (desktopLyric?.enabled ? ' is-on' : '')}
              aria-pressed={Boolean(desktopLyric?.enabled)}
              disabled={desktopLyricBusy}
              onClick={onToggleDesktopLyric}
            >
              桌面歌词：{desktopLyric?.enabled ? '已开启' : '未开启'}
            </button>
            <button
              type="button"
              className={'nr-seg-btn' + (desktopLyric?.locked ? ' is-on' : '')}
              aria-pressed={Boolean(desktopLyric?.locked)}
              disabled={desktopLyricBusy}
              onClick={onToggleDesktopLyricLock}
            >
              穿透锁定：{desktopLyric?.locked ? '已锁定' : '未锁定'}
            </button>
          </div>
          {desktopLyricError && (
            <p className="nr-dialog-error" role="alert">
              {desktopLyricError}
            </p>
          )}
        </div>
      )}

      <div className="nr-more-divider" />

      {canGlobalShortcuts && (
        <button type="button" className="lw-more-item" onClick={onOpenShortcuts}>
          全局快捷键：{globalShortcuts?.enabled ? '已开启' : '已关闭'}
          {globalShortcuts?.error ? '（有冲突）' : ''}
        </button>
      )}

      <button
        type="button"
        className="lw-more-item"
        aria-pressed={Boolean(isStageActive)}
        onClick={onOpenNowPlaying}
      >
        播放详情
      </button>

      <button type="button" className="lw-more-item" onClick={onOpenCloseSettings}>
        关闭窗口：{closeMode === 'background' ? '后台运行' : closeMode === 'exit' ? '完全退出' : '每次询问'}
      </button>

      <button type="button" className="lw-more-item is-close" onClick={() => setShowMore(false)}>
        关闭
      </button>
    </div>
  );
}

export function QueueDrawer({
  showQueue,
  setShowQueue,
  confirmClear,
  setConfirmClear,
  activeProvider,
  ws,
  song,
  pendingPlay,
  selectedTrack,
  setSelectedTrack,
  play,
  editQueue,
}) {
  if (!showQueue) return null;
  const tracks = ws.queue?.tracks || [];
  const isFm = ws.queue?.type === 'fm' || ws.queue?.source === 'fm';

  return (
    <div
      className="overlay queue-overlay"
      onClick={() => {
        setShowQueue(false);
        setConfirmClear(false);
      }}
    >
      <div
        className="dialog queue-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="播放队列"
        aria-labelledby="queue-heading"
        onClick={e => e.stopPropagation()}
      >
        <div className="queue-header">
          <h2 id="queue-heading">
            {providerLabel(activeProvider)}播放队列 · {tracks.length} 首
            {tracks.length ? ` · 接下来 ${Math.max(0, tracks.length - ws.queue.index - 1)} 首` : ''}
          </h2>
          <button
            type="button"
            className="nr-soft-btn"
            onClick={() => {
              setShowQueue(false);
              setConfirmClear(false);
            }}
            aria-label="关闭播放队列"
          >
            关闭
          </button>
        </div>

        {song && song.provider !== activeProvider && (
          <p className="nr-queue-note">
            正在播放的歌曲来自{providerLabel(song.provider)}，这里显示的是
            {providerLabel(activeProvider)}的队列。
          </p>
        )}

        {pendingPlay && (
          <p className="nr-queue-note" role="status">
            歌曲切换中，暂不可修改队列。
          </p>
        )}

        {tracks.length ? (
          <>
            <div className="queue-list">
              {tracks.map((track, index) => {
                const current =
                  song?.provider === activeProvider &&
                  song?.accountId === track.accountId &&
                  song?.id === track.id &&
                  ws.queue.index === index;
                const picked =
                  selectedTrack?.provider === track.provider &&
                  selectedTrack?.id === track.id &&
                  selectedTrack?.accountId === track.accountId;

                return (
                  <div
                    className={'queue-item' + (current ? ' selected' : picked ? ' picked' : '')}
                    key={`${track.id}-${index}`}
                  >
                    <button
                      type="button"
                      className="queue-song"
                      onClick={() =>
                        track.provider === 'netease'
                          ? setSelectedTrack({
                              provider: track.provider,
                              id: track.id,
                              accountId: track.accountId,
                            })
                          : play(track, { ...ws.queue, index })
                      }
                      onDoubleClick={() => {
                        if (track.provider === 'netease') play(track, { ...ws.queue, index });
                      }}
                      onKeyDown={e => {
                        if (track.provider === 'netease' && e.key === 'Enter') {
                          e.preventDefault();
                          play(track, { ...ws.queue, index });
                        }
                      }}
                      aria-current={current ? 'true' : undefined}
                    >
                      <span>
                        {index + 1}. {track.name}
                      </span>
                      <small>{artist(track)}</small>
                    </button>

                    {!isFm && (
                      <button
                        type="button"
                        className="nr-remove-btn"
                        disabled={pendingPlay}
                        aria-disabled={pendingPlay}
                        onClick={() => editQueue(index)}
                        aria-label={(current ? '移除并停止 ' : '移除 ') + track.name}
                      >
                        {current ? '移除并停止' : '移除'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {isFm ? (
              <p className="nr-queue-foot">私人 FM 队列不可编辑，由推荐流管理。</p>
            ) : confirmClear ? (
              <div
                className="lw-confirm"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="clear-queue-title"
              >
                <p id="clear-queue-title">确定清空此工作区队列？正在播放的本平台歌曲会停止。</p>
                <div className="nr-confirm-actions">
                  <button
                    type="button"
                    className="nr-danger-btn"
                    disabled={pendingPlay}
                    onClick={() => editQueue(null, true)}
                  >
                    确认清空
                  </button>
                  <button
                    type="button"
                    className="nr-soft-btn"
                    data-cancel=""
                    onClick={() => setConfirmClear(false)}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="lw-clear-queue nr-soft-btn"
                disabled={pendingPlay}
                aria-disabled={pendingPlay}
                onClick={() => setConfirmClear(true)}
              >
                清空队列
              </button>
            )}
          </>
        ) : (
          <p className="nr-queue-empty">队列为空，选择歌曲后会显示在这里。</p>
        )}
      </div>
    </div>
  );
}

export function QqAuthDialog({ open, busy, message, onComplete, onCancel }) {
  if (!open) return null;
  return (
    <div className="overlay">
      <div
        className="dialog qq-auth-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qq-auth-heading"
      >
        <h2 id="qq-auth-heading">QQ 音乐授权</h2>
        <p>请在腾讯授权窗口由你本人完成登录，再回到这里确认。</p>
        <div className="nr-dialog-actions">
          <button type="button" className="nr-primary-btn" disabled={busy} onClick={onComplete}>
            已完成 QQ 授权
          </button>
          <button type="button" className="nr-soft-btn" onClick={onCancel}>
            取消
          </button>
        </div>
        {message && (
          <p className="nr-dialog-status" role="status">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}

export function CloseBehaviorDialog({
  closeDialog,
  closeBusy,
  trayAvailable,
  closeError,
  onChoose,
  onCancel,
}) {
  if (!closeDialog) return null;
  return (
    <div className="overlay">
      <div
        className="dialog lw-close-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lw-close-heading"
      >
        <h2 id="lw-close-heading">关闭窗口时</h2>
        <p>选择以后点击关闭按钮的行为，可在“更多设置”中修改。</p>
        <div className="nr-close-options">
          <div className="nr-close-opt">
            <button
              type="button"
              className="nr-primary-btn"
              disabled={closeBusy || !trayAvailable}
              onClick={() => onChoose('background')}
            >
              后台运行
            </button>
            <small>
              {trayAvailable
                ? '音乐继续播放，可从系统托盘打开或退出。'
                : '系统托盘不可用，暂不能后台运行。'}
            </small>
          </div>
          <div className="nr-close-opt">
            <button
              type="button"
              className="nr-soft-btn"
              disabled={closeBusy}
              onClick={() => onChoose('exit')}
            >
              完全退出
            </button>
            <small>关闭应用并停止播放。</small>
          </div>
        </div>
        {closeError && (
          <p className="nr-dialog-error" role="alert">
            {closeError}
          </p>
        )}
        <button
          type="button"
          className="nr-ghost-btn"
          data-close-cancel=""
          disabled={closeBusy}
          onClick={onCancel}
        >
          取消
        </button>
      </div>
    </div>
  );
}

export function QrDialog({ qr, onClose }) {
  if (!qr) return null;
  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="dialog qr-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-heading"
        onClick={e => e.stopPropagation()}
      >
        <button type="button" className="close nr-close-btn" onClick={onClose} aria-label="关闭">
          <Icon name="close" />
        </button>
        <h2 id="qr-heading">登录{qr.provider === 'netease' ? '网易云音乐' : 'QQ 音乐'}</h2>
        <p>使用{qr.provider === 'netease' ? '网易云音乐' : 'QQ'} App 扫码并确认</p>
        {qr.image && (
          <div className="nr-qr-frame">
            <img src={qr.image} alt="登录二维码" />
          </div>
        )}
        <small>登录信息由本机安全保存</small>
      </div>
    </div>
  );
}

export function PlaylistPickerDialog({ track, playlists, busyId, error, onSelect, onClose }) {
  if (!track) return null;
  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="dialog nr-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="picker-heading"
        onClick={e => e.stopPropagation()}
      >
        <div className="queue-header">
          <h2 id="picker-heading">收藏到歌单</h2>
          <button
            type="button"
            className="nr-close-btn"
            aria-label="关闭收藏弹窗"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
        <p className="nr-picker-track">
          <b>{track.name}</b> · {artist(track) || '未知歌手'}
        </p>
        {error && (
          <p className="nr-dialog-error" role="alert">
            {error}
          </p>
        )}
        {playlists.length ? (
          <div className="nr-picker-list">
            {playlists.map(pl => {
              const busy = String(busyId ?? '') === String(pl.id);
              return (
                <button
                  key={pl.id}
                  type="button"
                  className="nr-picker-item"
                  disabled={busyId != null}
                  onClick={() => onSelect(pl)}
                >
                  <PlaylistCover className="nr-picker-thumb" url={pl.coverImgUrl} />
                  <span className="nr-picker-copy">
                    <b>{pl.name}</b>
                    <small>{pl.trackCount ?? '——'} 首</small>
                  </span>
                  <span className="nr-picker-state">{busy ? '收藏中…' : '加入'}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="nr-queue-empty">暂无可编辑的自建歌单。</p>
        )}
      </div>
    </div>
  );
}

export function GlobalShortcutsDialog({
  open,
  status,
  busy,
  error,
  onToggleEnabled,
  onSaveBindings,
  onClose,
}) {
  const activeBindings = { ...DEFAULT_SHORTCUT_BINDINGS, ...(status?.bindings || {}) };
  const [draftBindings, setDraftBindings] = useState(activeBindings);

  useEffect(() => {
    if (!open) return;
    setDraftBindings({ ...DEFAULT_SHORTCUT_BINDINGS, ...(status?.bindings || {}) });
  }, [open, status?.bindings]);

  if (!open) return null;

  const duplicateActions = findDuplicateShortcutActions(draftBindings);
  const textSelectionWarning = hasTextSelectionShortcutWarning(draftBindings);
  const dirty = SHORTCUT_ACTIONS.some(a => draftBindings[a.id] !== activeBindings[a.id]);
  const isDefault = SHORTCUT_ACTIONS.every(a => draftBindings[a.id] === a.defaultKey);

  const updateKeyPart = (actionId, part, value) => {
    setDraftBindings(prev => {
      const parsed = parseShortcutBinding(prev[actionId]);
      const nextModifier = part === 'modifier' ? value : parsed.modifier;
      const nextKey = part === 'key' ? value : parsed.key;
      return { ...prev, [actionId]: formatShortcutBinding(nextModifier, nextKey) };
    });
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="dialog nr-shortcuts-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-heading"
        onClick={e => e.stopPropagation()}
      >
        <div className="queue-header">
          <h2 id="shortcuts-heading" className="nr-shortcuts-title">
            <Icon name="keyboard" className="nr-icon" />
            全局快捷键
          </h2>
          <button
            type="button"
            className="nr-close-btn"
            aria-label="关闭全局快捷键设置"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>

        <div className="nr-shortcut-master">
          <div className="nr-shortcut-master-copy">
            <strong>系统级热键响应</strong>
            <small>
              开启后在后台或托盘也可使用；支持 Ctrl+Alt 或 Ctrl+Shift 加方向键、Space、A–Z 或 F1–F11。
            </small>
          </div>
          <button
            type="button"
            className={'nr-shortcut-toggle' + (status?.enabled ? ' is-on' : '')}
            aria-pressed={Boolean(status?.enabled)}
            disabled={busy || duplicateActions.size > 0}
            onClick={() => onToggleEnabled(!status?.enabled, draftBindings)}
          >
            {status?.enabled ? '已开启' : '已关闭'}
          </button>
        </div>

        {(error || duplicateActions.size > 0) && (
          <p className="nr-dialog-error" role="alert">
            {duplicateActions.size > 0
              ? '存在重复的快捷键组合，请调整后再保存或开启。'
              : `${error} · 请更换被占用的按键后重试。`}
          </p>
        )}

        {textSelectionWarning && (
          <p className="nr-shortcut-hint" role="status">
            提示：Ctrl+Shift+左右方向键在文本编辑软件中常用于选中文字，如影响日常打字建议改用 Ctrl+Alt。
          </p>
        )}

        <div className="nr-shortcut-rows">
          {SHORTCUT_ACTIONS.map(action => {
            const { modifier, key } = parseShortcutBinding(draftBindings[action.id]);
            const isDup = duplicateActions.has(action.id);
            return (
              <div
                key={action.id}
                className={'nr-shortcut-row' + (isDup ? ' is-conflict' : '')}
              >
                <span className="nr-shortcut-name">
                  {action.label}
                  {isDup && <em className="nr-shortcut-dup">重复</em>}
                </span>
                <div className="nr-shortcut-pickers">
                  <select
                    className="nr-shortcut-select"
                    aria-label={`${action.label} 修饰键`}
                    value={modifier}
                    disabled={busy}
                    onChange={e => updateKeyPart(action.id, 'modifier', e.target.value)}
                  >
                    {SHORTCUT_MODIFIERS.map(mod => (
                      <option key={mod} value={mod}>
                        {mod}
                      </option>
                    ))}
                  </select>
                  <span className="nr-shortcut-plus" aria-hidden="true">+</span>
                  <select
                    className="nr-shortcut-select is-key"
                    aria-label={`${action.label} 主键`}
                    value={key}
                    disabled={busy}
                    onChange={e => updateKeyPart(action.id, 'key', e.target.value)}
                  >
                    {SHORTCUT_KEY_GROUPS.map(group => (
                      <optgroup key={group.label} label={group.label}>
                        {group.items.map(item => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>

        <div className="nr-shortcuts-foot">
          <div className="nr-shortcuts-foot-left">
            <button
              type="button"
              className="nr-ghost-btn"
              disabled={busy || isDefault}
              onClick={() => setDraftBindings({ ...DEFAULT_SHORTCUT_BINDINGS })}
            >
              恢复默认
            </button>
          </div>
          <div className="nr-dialog-actions">
            <button type="button" className="nr-soft-btn" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="nr-primary-btn"
              disabled={busy || duplicateActions.size > 0 || !dirty}
              onClick={() => onSaveBindings(draftBindings)}
            >
              {busy ? '保存中…' : '保存快捷键'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
