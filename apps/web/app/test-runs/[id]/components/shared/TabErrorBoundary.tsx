'use client';

import React from 'react';
import { Alert, Button } from '@mui/material';

/**
 * Contains a render error to the test-run tab it happened in. Visited tabs stay mounted while
 * hidden, and a card there can still re-render (a fetch landing, a poll, a context change); with
 * no boundary, one failing card replaced the whole page with Next's "Application error", on a
 * tab the user was not even looking at.
 */
export class TabErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('A card on this tab failed to render', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Alert
        severity="error"
        action={<Button color="inherit" size="small" onClick={() => this.setState({ error: null })}>Try again</Button>}
      >
        Something on this tab failed to render. The other tabs are unaffected.
      </Alert>
    );
  }
}
