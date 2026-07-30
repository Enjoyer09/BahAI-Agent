// ==========================================
// AuthModal Component Tests
// ==========================================

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AuthModal from './AuthModal';

// Mock useAuth
const mockLogin = vi.fn();
const mockRegister = vi.fn();

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    login: mockLogin,
    register: mockRegister,
    signOut: vi.fn(),
    getAuthHeader: () => ({}),
  }),
}));

// Mock constants
vi.mock('../../lib/constants', () => ({
  API_BASE_URL: 'http://localhost:3001',
}));

// Mock fetch for Google client ID — returns a fresh Response Promise each call
const createResponse = () =>
  new Response(JSON.stringify({ googleClientId: null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
globalThis.fetch = vi.fn().mockImplementation(() => Promise.resolve(createResponse()));

describe('AuthModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    productMode: 'desktop_code' as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<AuthModal {...defaultProps} isOpen={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders login form by default', () => {
    render(<AuthModal {...defaultProps} />);
    expect(screen.getByText('Daxil ol')).toBeInTheDocument();
    expect(screen.getByLabelText('E-poçt ünvanı')).toBeInTheDocument();
    expect(screen.getByLabelText('Şifrə')).toBeInTheDocument();
  });

  it('renders register form when toggled', () => {
    render(<AuthModal {...defaultProps} />);

    // Click the toggle button
    const toggleButton = screen.getByTestId('auth-mode-toggle');
    fireEvent.click(toggleButton);

    expect(screen.getByText('Hesab yarat')).toBeInTheDocument();
    expect(screen.getByLabelText('Ad Soyad')).toBeInTheDocument();
  });

  it('does not expose demo credentials in login mode', () => {
    render(<AuthModal {...defaultProps} />);
    expect(screen.queryByTestId('auth-demo-fill')).not.toBeInTheDocument();
    expect(screen.queryByText('Demo desktop girişini doldur')).not.toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<AuthModal {...defaultProps} onClose={onClose} />);

    const closeButton = screen.getByLabelText('Bağla');
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('has proper role and aria attributes', () => {
    render(<AuthModal {...defaultProps} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'auth-title');
  });

  it('switches between login and register text', () => {
    render(<AuthModal {...defaultProps} />);

    // Initially shows login text
    expect(screen.getByText(/hesab yaradın/i)).toBeInTheDocument();

    // Toggle to register
    fireEvent.click(screen.getByTestId('auth-mode-toggle'));
    expect(screen.getByText(/daxil olun/i)).toBeInTheDocument();
  });

  it('renders with web_chat product mode', () => {
    render(<AuthModal {...defaultProps} productMode="web_chat" />);
    expect(screen.getByText('BahAI Cloud-a xoş gəlmisiniz')).toBeInTheDocument();
  });

  it('renders with desktop_code product mode', () => {
    render(<AuthModal {...defaultProps} productMode="desktop_code" />);
    expect(screen.getByText('BahAI Desktop-a xoş gəlmisiniz')).toBeInTheDocument();
  });

  it('shows footer terms text', () => {
    render(<AuthModal {...defaultProps} />);
    expect(screen.getByText(/İstifadə Şərtlərimizə razılaşırsınız/)).toBeInTheDocument();
  });

  it('renders email input with correct type', () => {
    render(<AuthModal {...defaultProps} />);
    const emailInput = screen.getByLabelText('E-poçt ünvanı');
    expect(emailInput).toHaveAttribute('type', 'email');
  });

  it('renders password input with correct type', () => {
    render(<AuthModal {...defaultProps} />);
    const passwordInput = screen.getByLabelText('Şifrə');
    expect(passwordInput).toHaveAttribute('type', 'password');
  });
});
