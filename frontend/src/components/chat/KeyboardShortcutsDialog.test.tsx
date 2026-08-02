// ==========================================
// KeyboardShortcutsDialog Tests
// ==========================================

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import KeyboardShortcutsDialog from './KeyboardShortcutsDialog';

describe('KeyboardShortcutsDialog', () => {
  it('renders nothing when closed', () => {
    render(<KeyboardShortcutsDialog isOpen={false} onClose={() => {}} />);
    expect(screen.queryByText('Klaviatura qısayolları')).not.toBeInTheDocument();
  });

  it('renders the shortcut list when open', () => {
    render(<KeyboardShortcutsDialog isOpen onClose={() => {}} />);
    expect(screen.getByText('Klaviatura qısayolları')).toBeInTheDocument();
    expect(screen.getByText('Yan paneli aç/bağla')).toBeInTheDocument();
    // Ctrl+B kbd appears (multiple shortcuts share the Ctrl key)
    expect(screen.getAllByText('Ctrl').length).toBeGreaterThan(0);
    expect(screen.getAllByText('B').length).toBeGreaterThan(0);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsDialog isOpen onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsDialog isOpen onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close shortcuts'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
