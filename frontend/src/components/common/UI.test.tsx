// ==========================================
// UI Components Tests
// ==========================================

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button, Badge, Tooltip, Spinner, Kbd } from './UI';

describe('Button', () => {
  it('renders with default props', () => {
    render(<Button>Click me</Button>);
    const btn = screen.getByRole('button', { name: /click me/i });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  it('renders with children', () => {
    render(<Button>Submit</Button>);
    expect(screen.getByText('Submit')).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click</Button>);
    fireEvent.click(screen.getByText('Click'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled when disabled prop is true', () => {
    render(<Button disabled>Disabled</Button>);
    const btn = screen.getByText('Disabled');
    expect(btn.closest('button')).toBeDisabled();
  });

  it('shows spinner when loading', () => {
    render(<Button loading>Loading</Button>);
    const btn = screen.getByRole('button');
    // Spinner should be present
    const spinner = btn.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('applies variant styles correctly', () => {
    const { rerender } = render(<Button variant="primary">Primary</Button>);
    let btn = screen.getByText('Primary').closest('button');
    expect(btn).toBeInTheDocument();

    rerender(<Button variant="danger">Danger</Button>);
    btn = screen.getByText('Danger').closest('button');
    expect(btn).toBeInTheDocument();

    rerender(<Button variant="ghost">Ghost</Button>);
    btn = screen.getByText('Ghost').closest('button');
    expect(btn).toBeInTheDocument();
  });

  it('applies size styles correctly', () => {
    const { rerender } = render(<Button size="sm">Small</Button>);
    expect(screen.getByText('Small')).toBeInTheDocument();

    rerender(<Button size="lg">Large</Button>);
    expect(screen.getByText('Large')).toBeInTheDocument();
  });
});

describe('Badge', () => {
  it('renders with default variant', () => {
    render(<Badge>Default</Badge>);
    expect(screen.getByText('Default')).toBeInTheDocument();
  });

  it('renders with success variant', () => {
    render(<Badge variant="success">Success</Badge>);
    expect(screen.getByText('Success')).toBeInTheDocument();
  });

  it('renders with warning variant', () => {
    render(<Badge variant="warning">Warning</Badge>);
    expect(screen.getByText('Warning')).toBeInTheDocument();
  });

  it('renders with danger variant', () => {
    render(<Badge variant="danger">Danger</Badge>);
    expect(screen.getByText('Danger')).toBeInTheDocument();
  });

  it('renders with info variant', () => {
    render(<Badge variant="info">Info</Badge>);
    expect(screen.getByText('Info')).toBeInTheDocument();
  });

  it('renders with size md', () => {
    render(<Badge size="md">Medium</Badge>);
    expect(screen.getByText('Medium')).toBeInTheDocument();
  });
});

describe('Spinner', () => {
  it('renders with default size', () => {
    render(<Spinner />);
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('has role status', () => {
    render(<Spinner />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders with custom size', () => {
    render(<Spinner size={32} />);
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });
});

describe('Kbd', () => {
  it('renders children', () => {
    render(<Kbd>Ctrl+B</Kbd>);
    expect(screen.getByText('Ctrl+B')).toBeInTheDocument();
  });
});

describe('Tooltip', () => {
  it('renders children', () => {
    render(
      <Tooltip content="Tooltip content">
        <button>Hover me</button>
      </Tooltip>
    );
    expect(screen.getByText('Hover me')).toBeInTheDocument();
  });

  it('renders tooltip content text', () => {
    render(
      <Tooltip content="Helpful info">
        <button>Hover</button>
      </Tooltip>
    );
    // Content should exist in document (hidden via CSS initially)
    expect(screen.getByText('Helpful info')).toBeInTheDocument();
  });

  it('renders with different positions', () => {
    render(
      <Tooltip content="Bottom tooltip" side="bottom">
        <button>Bottom</button>
      </Tooltip>
    );
    expect(screen.getByText('Bottom tooltip')).toBeInTheDocument();
  });
});
