import React from 'react';
import { artist } from '../utils/format.js';
import { Icon } from './Icons.jsx';

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
  reportAllowed,
  onToggleReport,
  showDiagnostics,
  onToggleDiagnostics,
  diagnostic,
  diagnosticText,
  showNowDetails,
  setShowNowDetails,
  closeMode,
  onOpenCloseSettings,
}) {
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

      <div className="nr-more-divider" />

      <button
        type="button"
        className="lw-more-item"
        aria-pressed={reportAllowed}
        onClick={onToggleReport}
        title="目前仅本地统计，不发送记录"
      >
        听歌上报：{reportAllowed ? '开启偏好' : '关闭'}（未开放）
      </button>

      <button
        type="button"
        className="lw-more-item"
        aria-pressed={showDiagnostics}
        onClick={onToggleDiagnostics}
      >
        本地计时诊断{showDiagnostics ? '：开' : '：关'}
      </button>

      {showDiagnostics && (
        <p className="lw-more-note" role="status" aria-label="本地计时诊断结果">
          {diagnostic ? diagnosticText(diagnostic) : '尚无播放会话'}
        </p>
      )}

      <button
        type="button"
        className="lw-more-item"
        aria-pressed={showNowDetails}
        onClick={() => setShowNowDetails(!showNowDetails)}
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
            {activeProvider === 'netease' ? '网易云' : 'QQ 音乐'}播放队列 · {tracks.length} 首
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
            正在播放的歌曲来自{song.provider === 'netease' ? '网易云' : 'QQ 音乐'}，这里显示的是
            {activeProvider === 'netease' ? '网易云' : 'QQ 音乐'}的队列。
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
