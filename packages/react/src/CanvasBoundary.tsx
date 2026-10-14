'use client';

import { Component } from 'react';
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** When this value changes (a new scene arrived) a crashed canvas gets another chance. */
  resetKey: unknown;
  message: string;
  retryLabel: string;
  onError?: (error: Error) => void;
}

interface BoundaryState {
  error: Error | null;
  key: unknown;
}

/** A rendering bug in the canvas must never take down the host IDE: show a small notice instead. */
export class CanvasBoundary extends Component<Props, BoundaryState> {
  override state: BoundaryState ={ error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: BoundaryState): Partial<BoundaryState> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  override componentDidCatch(error: Error): void {
    this.props.onError?.(error);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="cb-crash" role="alert" data-testid="blocks-crash">
        <span>{this.props.message}</span>
        <button type="button" onClick={() => this.setState({ error: null })}>{this.props.retryLabel}</button>
      </div>
    );
  }
}
