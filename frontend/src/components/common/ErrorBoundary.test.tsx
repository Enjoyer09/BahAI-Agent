// ==========================================
// ErrorBoundary Component Tests
// ==========================================

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

// A component that throws an error
function ErrorThrowingComponent({ shouldThrow = false }: { shouldThrow?: boolean }) {
  if (shouldThrow) {
    throw new Error('Test error message');
  }
  return <div>Normal content</div>;
}

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>Hello world</div>
      </ErrorBoundary>
    );

    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders default fallback when child throws', () => {
    // Suppress console.error for expected error
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ErrorThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    // Should show the fallback UI
    expect(screen.getByText('Bir xəta baş verdi')).toBeInTheDocument();
    expect(screen.getByText('Test error message')).toBeInTheDocument();
    expect(screen.getByText('Yenidən cəhd et')).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('renders custom fallback when provided', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary fallback={<div>Custom Error UI</div>}>
        <ErrorThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Custom Error UI')).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('recovers from error state when retry button is clicked', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { rerender } = render(
      <ErrorBoundary>
        <ErrorThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    // Should show error state
    expect(screen.getByText('Bir xəta baş verdi')).toBeInTheDocument();

    // Click retry button
    const retryButton = screen.getByText('Yenidən cəhd et');
    retryButton.click();

    // Rerender with non-throwing component
    rerender(
      <ErrorBoundary>
        <ErrorThrowingComponent shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Normal content')).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('calls console.error when error is caught', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ErrorThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(consoleSpy).toHaveBeenCalled();
    // Find the ErrorBoundary call in any console.error invocation
    const boundaryCall = consoleSpy.mock.calls.find(
      (call) => String(call[0] || '').includes('ErrorBoundary')
    );
    expect(boundaryCall).toBeDefined();

    consoleSpy.mockRestore();
  });
});
