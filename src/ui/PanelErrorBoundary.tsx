import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** The tab this boundary wraps is hidden: hide the fallback too. */
  hidden?: boolean;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class PanelErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Panel error:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  override render() {
    if (this.state.hasError) {
      return (
        <div className="panel-error-fallback" hidden={this.props.hidden} style={{ padding: '24px', textAlign: 'center', display: this.props.hidden ? 'none' : undefined }}>
          <p>Something went wrong in this view</p>
          <button
            type="button"
            className="btn-secondary"
            onClick={this.handleReload}
            style={{ marginTop: '12px' }}
          >
            Reload panel
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
