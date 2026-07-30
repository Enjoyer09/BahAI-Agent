import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../common/Toast';
import { Composer } from './Composer';

function renderComposer(onSendMessage = vi.fn()) {
  render(
    <ToastProvider>
      <Composer onSendMessage={onSendMessage} />
    </ToastProvider>,
  );
  return onSendMessage;
}

describe('Composer', () => {
  it('sends text as a trimmed message', () => {
    const onSendMessage = renderComposer();

    fireEvent.change(screen.getByLabelText('Message input'), {
      target: { value: '  Salam BahAI  ' },
    });
    fireEvent.click(screen.getByLabelText('Send message'));

    expect(onSendMessage).toHaveBeenCalledWith('Salam BahAI', []);
  });

  it('converts an uploaded file to an Attachment before sending', async () => {
    const onSendMessage = renderComposer();
    const file = new File(['BAHAI_ATTACHMENT_TEST'], 'audit.txt', { type: 'text/plain' });

    fireEvent.change(screen.getByLabelText('Choose attachment'), {
      target: { files: [file] },
    });

    await waitFor(() => expect(screen.getByText('audit.txt')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Send message'));

    expect(onSendMessage).toHaveBeenCalledTimes(1);
    const [text, attachments] = onSendMessage.mock.calls[0];
    expect(text).toBe('');
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      name: 'audit.txt',
      type: 'file',
      mimeType: 'text/plain',
    });
    expect(attachments[0].url).toMatch(/^data:text\/plain;base64,/);
  });

  it('removes an attachment before sending', async () => {
    renderComposer();
    const file = new File(['temporary'], 'remove.txt', { type: 'text/plain' });

    fireEvent.change(screen.getByLabelText('Choose attachment'), {
      target: { files: [file] },
    });

    const removeButton = await screen.findByLabelText('remove.txt faylını sil');
    fireEvent.click(removeButton);

    expect(screen.queryByText('remove.txt')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Send message')).toBeDisabled();
  });
});
