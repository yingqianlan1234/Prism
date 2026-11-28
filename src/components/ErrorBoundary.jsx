import React from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

function sanitizeErrorMessage(error) {
  const raw =
    typeof error?.message === 'string' && error.message.trim()
      ? error.message.trim()
      : '界面渲染出现未预期异常';
  return raw.replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, 220);
}

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      message: sanitizeErrorMessage(error),
    };
  }

  componentDidCatch(error) {
    if (typeof this.props.onError === 'function') {
      this.props.onError(error);
    }
  }

  handleReload = () => {
    if (typeof this.props.onReload === 'function') {
      this.props.onReload();
      return;
    }
    if (typeof window !== 'undefined' && typeof window.location?.reload === 'function') {
      window.location.reload();
    }
  };

  handleRecover = () => {
    this.setState({ hasError: false, message: '' });
  };

  handleWindowAction = action => {
    try {
      if (!isTauri()) return;
      const win = getCurrentWindow();
      if (action === 'minimize') void win.minimize();
      if (action === 'close') void win.close();
    } catch {}
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <div className="nr-crash-shell" role="alert" aria-live="assertive">
        <header className="nr-crash-bar" data-tauri-drag-region="">
          <span className="nr-crash-brand" data-tauri-drag-region="">
            Vesper
          </span>
          <div className="nr-crash-win-actions">
            <button
              type="button"
              className="nr-crash-win-btn"
              aria-label="最小化窗口"
              onClick={() => this.handleWindowAction('minimize')}
            >
              —
            </button>
            <button
              type="button"
              className="nr-crash-win-btn is-close"
              aria-label="关闭窗口"
              onClick={() => this.handleWindowAction('close')}
            >
              ×
            </button>
          </div>
        </header>
        <main className="nr-crash-stage">
          <div className="nr-crash-card">
            <span className="nr-crash-kicker">界面保护模式</span>
            <h1>界面遇到意外中断</h1>
            <p className="nr-crash-desc">
              你的账号会话、跨源歌单与本地播放记录均已安全保留。可以尝试重新加载界面，或直接关闭窗口。
            </p>
            <p className="nr-crash-detail">{this.state.message}</p>
            <div className="nr-crash-actions">
              <button type="button" className="nr-crash-btn is-primary" onClick={this.handleReload}>
                重新加载
              </button>
              <button type="button" className="nr-crash-btn" onClick={this.handleRecover}>
                尝试原地恢复
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }
}
