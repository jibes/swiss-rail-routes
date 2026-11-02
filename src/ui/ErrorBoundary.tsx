import { Component, type ReactNode } from 'react';
import { translate, type Lang } from '../i18n';
import { log } from '../io/log';
import { usePrefs } from '../store';

/**
 * The last line of defence: a screen that throws shows a way back instead of a blank page.
 * Class component (React has no hook for this); texts read from the store directly.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    log('screen.crash', { e: error, stack: info.componentStack?.slice(0, 1500) });
  }

  componentDidUpdate(prev: { resetKey: string }) {
    // Another screen: try again.
    if (prev.resetKey !== this.props.resetKey && this.state.failed)
      this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const lang: Lang = usePrefs.getState().lang;
    return (
      <main className="page">
        <p role="alert" className="notice red">
          {translate(lang, 'screenFailed')}
        </p>
        <a className="secondary" href="#/">
          {translate(lang, 'toStart')}
        </a>
      </main>
    );
  }
}
