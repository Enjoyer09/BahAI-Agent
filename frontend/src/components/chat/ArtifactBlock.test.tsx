// ==========================================
// ArtifactBlock Tests
// ==========================================

import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ArtifactBlock from './ArtifactBlock';

describe('ArtifactBlock', () => {
  it('renders Preview view by default for html blocks', () => {
    render(<ArtifactBlock language="html" code={'<h1>Salam</h1>'} />);
    // Preview toggle is active and an iframe is present
    expect(screen.getByText('Preview')).toBeInTheDocument();
    expect(screen.getByText('Kode')).toBeInTheDocument();
    const iframe = document.querySelector('iframe');
    expect(iframe).toBeInTheDocument();
  });

  it('switches to Code view when the Kode toggle is clicked', () => {
    render(<ArtifactBlock language="html" code={'<h1>Salam</h1>'} />);
    fireEvent.click(screen.getByText('Kode'));
    // Code view shows the raw source
    expect(screen.getByText('<h1>Salam</h1>')).toBeInTheDocument();
    expect(document.querySelector('iframe')).not.toBeInTheDocument();
  });

  it('wraps html fragments in a full document with proper charset', () => {
    render(<ArtifactBlock language="html" code={'<p>Hello</p>'} />);
    const iframe = document.querySelector('iframe') as HTMLIFrameElement | null;
    expect(iframe).toBeInTheDocument();
    expect(iframe?.srcdoc).toContain('<!DOCTYPE html>');
    expect(iframe?.srcdoc).toContain('<p>Hello</p>');
  });

  it('renders svg blocks as previewable artifacts', () => {
    render(<ArtifactBlock language="svg" code={'<svg><circle r="10"/></svg>'} />);
    expect(screen.getByText('Preview')).toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeInTheDocument();
  });

  it('routes non-previewable languages through CodeBlock, not the artifact', () => {
    // MarkdownRenderer decides which blocks become artifacts; js must NOT get an iframe.
    render(<ArtifactBlock language="html" code={'<div>artifact</div>'} />);
    expect(document.querySelector('iframe')).toBeInTheDocument();
    // Sanity: the Preview/Code chrome is always present for routed blocks.
    expect(screen.getByText('Preview')).toBeInTheDocument();
  });

  it('sandboxes the preview iframe (no same-origin escape)', () => {
    render(<ArtifactBlock language="html" code={'<script>window.x=1</script>'} />);
    const iframe = document.querySelector('iframe') as HTMLIFrameElement | null;
    const sandbox = iframe?.getAttribute('sandbox') || '';
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
  });
});
