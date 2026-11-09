import { fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../api/client';
import { askStateless, getChatOptions, getChatStatus } from '../../api/endpoints';
import type { ChatAskResponse } from '../../api/types';
import { stubScrollGeometry, stubViewport } from '../../ui/test-utils';

import { AUTO, answer, openChat, setup } from './ChatRail.harness';

vi.mock('../../api/endpoints', () => ({
  askStateless: vi.fn(),
  getChatStatus: vi.fn(),
  getChatOptions: vi.fn(),
  setChatOptions: vi.fn(),
}));
vi.mock('./bookContext', () => ({
  useBookContext: () => ({ book: 'shelf/Deep Learning.pdf', page: 12 }),
}));

const ask = vi.mocked(askStateless);
const status = vi.mocked(getChatStatus);
beforeEach(() => {
  stubViewport(1280);
  window.localStorage.clear();
  window.renderMathInElement = vi.fn();
  status.mockResolvedValue(AUTO);
  vi.mocked(getChatOptions).mockResolvedValue({
    available: true,
    models: [{ id: 'inception:mercury-3', provider: 'inception', model: 'mercury-3' }],
    selected: 'auto',
    effort: 'medium',
  });
  ask.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.renderMathInElement;
});

describe('ChatRail', () => {
  it('shows the book context and the auto provider chain', async () => {
    const { user } = setup();
    const rail = await openChat(user);
    expect(within(rail).getByText('Deep Learning.pdf')).toBeInTheDocument();
    expect(within(rail).getByText('p.12')).toBeInTheDocument();
    expect(await within(rail).findByText(/^Auto: mistral · small → ollama/)).toBeInTheDocument();
    expect(within(rail).getByRole('textbox', { name: 'Your question' })).toHaveFocus();
  });

  it('explains why chat is unavailable', async () => {
    status.mockResolvedValue({ available: false, providers: [], selected: 'auto', reason: 'no agent' });
    const { user } = setup();
    const rail = await openChat(user);
    expect(await within(rail).findByText('no agent')).toBeInTheDocument();
  });

  it('sends on Enter with book context, renders the answer and sources, then keeps history', async () => {
    ask.mockResolvedValueOnce(answer('First **answer**')).mockResolvedValueOnce(answer('Second'));
    const { user } = setup();
    const rail = await openChat(user);
    const box = within(rail).getByRole('textbox', { name: 'Your question' });

    await user.type(box, 'What is a tensor?{Enter}');
    expect(await within(rail).findByText('answer')).toBeInTheDocument();
    expect(ask).toHaveBeenCalledWith(
      { messages: [{ role: 'user', content: 'What is a tensor?' }], book: 'shelf/Deep Learning.pdf', page: 12 },
    );
    expect(box).toHaveValue('');
    expect(within(rail).getByRole('link', { name: 'Deep Learning.pdf · p.12' })).toHaveAttribute(
      'href',
      '/book/shelf/Deep%20Learning.pdf#p12',
    );
    expect(within(rail).getByText('Answered by mistral · small')).toBeInTheDocument();

    await user.type(box, 'And a matrix?{Enter}');
    await within(rail).findByText('Second');
    expect(ask.mock.calls[1]?.[0].messages).toEqual([
      { role: 'user', content: 'What is a tensor?' },
      { role: 'assistant', content: 'First **answer**' },
      { role: 'user', content: 'And a matrix?' },
    ]);
  });

  it('keeps a scrolled-up reader in place, then follows once they send', async () => {
    const restore = stubScrollGeometry(1000);
    try {
      let finish: (value: ChatAskResponse) => void = () => {};
      ask.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
      const { user } = setup();
      const rail = await openChat(user);
      const log = within(rail).getByRole('log');
      log.scrollTop = 100;
      fireEvent.scroll(log);

      await user.type(within(rail).getByRole('textbox', { name: 'Your question' }), 'Hello{Enter}');
      expect(await within(rail).findByText('…thinking')).toBeInTheDocument();
      expect(log.scrollTop).toBe(1000);

      log.scrollTop = 100;
      fireEvent.scroll(log);
      finish(answer('Done'));
      await within(rail).findByText('Done');
      expect(log.scrollTop).toBe(100);
    } finally {
      restore();
    }
  });

  it('inserts a newline on Shift+Enter without sending', async () => {
    const { user } = setup();
    const rail = await openChat(user);
    const box = within(rail).getByRole('textbox', { name: 'Your question' });
    await user.type(box, 'line one{Shift>}{Enter}{/Shift}line two');
    expect(box).toHaveValue('line one\nline two');
    expect(ask).not.toHaveBeenCalled();
  });

  it('does not send Enter while an IME composition is active', async () => {
    const { user } = setup();
    const rail = await openChat(user);
    const box = within(rail).getByRole('textbox', { name: 'Your question' });
    await user.type(box, '日本語');
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
    expect(ask).not.toHaveBeenCalled();
    expect(box).toHaveValue('日本語');
  });

  it('disables Send while a request is pending and ignores empty questions', async () => {
    let finish: (value: ChatAskResponse) => void = () => {};
    ask.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const { user } = setup();
    const rail = await openChat(user);
    const box = within(rail).getByRole('textbox', { name: 'Your question' });
    await user.type(box, '   {Enter}');
    expect(ask).not.toHaveBeenCalled();

    await user.type(box, 'Hello{Enter}');
    expect(within(rail).getByText('…thinking')).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'Send' })).toBeDisabled();
    finish(answer('Done'));
    await within(rail).findByText('Done');
    expect(within(rail).queryByText('…thinking')).not.toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('shows the server detail on failure and drops the failed turn from history', async () => {
    ask.mockRejectedValueOnce(new ApiError(502, 'All providers failed: mistral timed out'));
    ask.mockResolvedValueOnce(answer('Recovered'));
    const { user } = setup();
    const rail = await openChat(user);
    const box = within(rail).getByRole('textbox', { name: 'Your question' });

    await user.type(box, 'Will fail{Enter}');
    expect(await within(rail).findByRole('alert')).toHaveTextContent('All providers failed: mistral timed out');
    expect(within(rail).getByText('Will fail')).toBeInTheDocument();

    await user.type(box, 'Retry{Enter}');
    await within(rail).findByText('Recovered');
    expect(ask.mock.calls[1]?.[0].messages).toEqual([{ role: 'user', content: 'Retry' }]);
    expect(within(rail).getByRole('alert')).toBeEmptyDOMElement();
  });

  it('falls back to a generic message when the request itself fails', async () => {
    ask.mockRejectedValueOnce(new TypeError('network down'));
    const { user } = setup();
    const rail = await openChat(user);
    await user.type(within(rail).getByRole('textbox', { name: 'Your question' }), 'Hi{Enter}');
    expect(await within(rail).findByRole('alert')).toHaveTextContent(/Check the provider key/);
  });

  it('re-reads the status after an options change', async () => {
    ask.mockResolvedValueOnce(answer('Hi'));
    const { user, client } = setup();
    const rail = await openChat(user);
    await user.type(within(rail).getByRole('textbox', { name: 'Your question' }), 'Hi{Enter}');
    await within(rail).findByText('Answered by mistral · small');

    status.mockResolvedValue({ ...AUTO, selected: 'ollama:llama' });
    await client.invalidateQueries({ queryKey: ['chat'] });
    await waitFor(() => expect(within(rail).getByText('Model: ollama:llama')).toBeInTheDocument());
  });

  it('resizes from the keyboard handle', async () => {
    const { user } = setup();
    const rail = await openChat(user);
    const handle = within(rail).getByRole('separator', { name: 'Resize chat panel' });
    expect(handle).toHaveAttribute('aria-valuenow', '360');
    handle.focus();
    await user.keyboard('{ArrowLeft}');
    expect(handle).toHaveAttribute('aria-valuenow', '376');
    await user.keyboard('{End}');
    expect(handle).toHaveAttribute('aria-valuenow', '640');
    expect(window.localStorage.getItem('br-chat-rail-width')).toBe('640');
  });

  it('toggles Socratic Tutor mode in the reader rail and sends mode="tutor"', async () => {
    ask.mockResolvedValueOnce(answer('Diagnostic question 1'));
    const { user } = setup();
    const rail = await openChat(user);
    await user.click(within(rail).getByRole('button', { name: 'Socratic Tutor' }));
    const box = within(rail).getByRole('textbox', { name: 'Your question' });
    await user.type(box, 'Quiz me on this chapter{Enter}');
    await within(rail).findByText('Diagnostic question 1');
    expect(ask).toHaveBeenCalledWith({
      messages: [{ role: 'user', content: 'Quiz me on this chapter' }],
      book: 'shelf/Deep Learning.pdf',
      page: 12,
      mode: 'tutor',
    });
  });
});
