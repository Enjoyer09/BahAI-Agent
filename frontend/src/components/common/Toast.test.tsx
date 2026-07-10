// ==========================================
// Toast Component Tests
// ==========================================

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { ToastProvider, useToast, useConfirm } from './Toast';

// Test component that triggers toasts
function ToastTrigger() {
  const toast = useToast();
  return (
    <div>
      <button onClick={() => toast.success('Success message')}>Success</button>
      <button onClick={() => toast.error('Error message')}>Error</button>
      <button onClick={() => toast.warning('Warning message')}>Warning</button>
      <button onClick={() => toast.info('Info message')}>Info</button>
      <button onClick={() => toast.toast('Custom toast', 'info', 5000)}>Custom</button>
    </div>
  );
}

describe('ToastProvider & useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders children', () => {
    render(
      <ToastProvider>
        <div>App content</div>
      </ToastProvider>
    );
    expect(screen.getByText('App content')).toBeInTheDocument();
  });

  it('shows success toast when triggered', () => {
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Success'));
    expect(screen.getByText('Success message')).toBeInTheDocument();
  });

  it('shows error toast when triggered', () => {
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Error'));
    expect(screen.getByText('Error message')).toBeInTheDocument();
  });

  it('shows warning toast when triggered', () => {
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Warning'));
    expect(screen.getByText('Warning message')).toBeInTheDocument();
  });

  it('shows info toast when triggered', () => {
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Info'));
    expect(screen.getByText('Info message')).toBeInTheDocument();
  });

  it('dismisses toast after duration', () => {
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Success'));
    expect(screen.getByText('Success message')).toBeInTheDocument();

    // Fast-forward past default duration (4s)
    act(() => {
      vi.advanceTimersByTime(4500);
    });

    expect(screen.queryByText('Success message')).not.toBeInTheDocument();
  });

  it('dismisses toast when close button is clicked', () => {
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Info'));
    expect(screen.getByText('Info message')).toBeInTheDocument();

    const dismissButton = screen.getByLabelText('Dismiss');
    fireEvent.click(dismissButton);
    expect(screen.queryByText('Info message')).not.toBeInTheDocument();
  });

  it('has aria-live polite on container', () => {
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Success'));
    const container = document.querySelector('[role="status"]');
    expect(container).toHaveAttribute('aria-live', 'polite');
  });

  it('throws error when useToast is used outside provider', () => {
    // Suppress console.error for expected error
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(<ToastTrigger />)).toThrow(
      'useToast must be used within ToastProvider'
    );

    consoleSpy.mockRestore();
  });
});

describe('useConfirm', () => {
  it('returns confirm and ConfirmDialog', () => {
    function TestComponent() {
      const { confirm, ConfirmDialog } = useConfirm();
      return (
        <div>
          <button onClick={async () => await confirm('Are you sure?')}>
            Show Confirm
          </button>
          {ConfirmDialog}
        </div>
      );
    }

    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Show Confirm'));
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
    expect(screen.getByText('Confirm')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('shows confirm with title', () => {
    function TestComponent() {
      const { confirm, ConfirmDialog } = useConfirm();
      return (
        <div>
          <button onClick={async () => await confirm('Delete?', 'Delete item', 'danger')}>
            Delete
          </button>
          {ConfirmDialog}
        </div>
      );
    }

    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Delete'));
    expect(screen.getByText('Delete item')).toBeInTheDocument();
    expect(screen.getByText('Delete?')).toBeInTheDocument();
  });
});
