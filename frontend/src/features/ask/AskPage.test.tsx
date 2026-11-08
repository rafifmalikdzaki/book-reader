import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../api/client';
import * as endpoints from '../../api/endpoints';
import { installServer, makeSession, renderAsk } from './ask.harness';

vi.mock('../../api/endpoints');
vi.mock('../../app', () => ({
  useStage: vi.fn(),
  CHAT_STATUS_KEY: ['chat', 'status'],
}));

const location = () => screen.getByTestId('location');
const box = () => screen.getByRole('textbox', { name: 'Ask about your books' });

beforeEach(() => {
  window.renderMathInElement = vi.fn();
});
afterEach(() => {
  delete window.renderMathInElement;
  vi.clearAllMocks();
});

describe('Ask: sending', () => {
  it('creates a session on first send, shows the pending turn, then the answer with sources', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    installServer({
      answer: async () => {
        await gate;
        return { text: 'A tensor is an array.', book: 'shelf/ML.pdf', page: 3 };
      },
    });
    const user = renderAsk();
    expect(await screen.findByText('Ask the library')).toBeInTheDocument();
    expect(await screen.findByText('Ready · RAG · Auto model')).toBeInTheDocument();

    await user.type(box(), 'What is a tensor?{Enter}');
    expect(await screen.findByText('Searching the library…')).toBeInTheDocument();
    expect(screen.getByText('What is a tensor?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thinking…' })).toBeDisabled();
    expect(box()).toHaveValue('');

    release();
    expect(await screen.findByText('A tensor is an array.')).toBeInTheDocument();
    expect(screen.queryByText('Searching the library…')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ML.pdf · p.3' })).toHaveAttribute('href', '/book/shelf/ML.pdf#p3');
    expect(endpoints.createChatSession).toHaveBeenCalledWith({ categories: [] });
    expect(endpoints.postMessage).toHaveBeenCalledWith('s1', 'What is a tensor?');
    expect(location()).toHaveTextContent('/ask?chat=s1');
    expect(await screen.findByRole('heading', { level: 1, name: 'What is a tensor?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^What is a tensor\?/ })).toHaveAttribute('aria-current', 'true');
  });

  it('keeps Shift+Enter as a newline and does not send', async () => {
    installServer();
    const user = renderAsk();
    await user.type(box(), 'one{Shift>}{Enter}{/Shift}two');
    expect(box()).toHaveValue('one\ntwo');
    expect(endpoints.postMessage).not.toHaveBeenCalled();
  });

  it('restores the question and shows the error when the provider fails', async () => {
    installServer({ answer: () => Promise.reject(new ApiError(502, 'Provider failed')) });
    const user = renderAsk();
    await user.type(box(), 'Why?{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Provider failed');
    expect(box()).toHaveValue('Why?');
    expect(screen.queryByText('Searching the library…')).not.toBeInTheDocument();
  });

  it('disables Send and explains why when chat is not configured', async () => {
    installServer({ status: { available: false, providers: [], selected: 'auto', reason: 'No provider key' } });
    renderAsk();
    expect(await screen.findByText('No provider key')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('shows the retention window from the API', async () => {
    installServer();
    renderAsk();
    expect(
      await screen.findByText('Chats are deleted after 7 days unless pinned or in a project.'),
    ).toBeInTheDocument();
  });
});

describe('Ask: URL contract', () => {
  it('starts a session about the book and page from ?book=&page=', async () => {
    installServer();
    const user = renderAsk('/ask?book=shelf%2FML.pdf&page=12');
    expect(await screen.findByText('ML.pdf · p.12 · RAG')).toBeInTheDocument();
    expect(screen.getByText('Questions use this book and cite the pages they draw from.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Summarize this page' }));
    expect(box()).toHaveValue('Summarize this page');
    await user.type(box(), '{Enter}');
    await waitFor(() =>
      expect(endpoints.createChatSession).toHaveBeenCalledWith({
        categories: [],
        book: 'shelf/ML.pdf',
        page: 12,
      }),
    );
  });

  it('opens ?chat=<id> and replaces the URL when switching chats', async () => {
    const server = installServer();
    server.sessions.push(makeSession({ id: 'a', title: 'Alpha' }), makeSession({ id: 'b', title: 'Beta' }));
    const user = renderAsk('/ask?chat=a');
    expect(await screen.findByRole('heading', { level: 1, name: 'Alpha' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Beta/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Beta' })).toBeInTheDocument();
    expect(location()).toHaveTextContent('/ask?chat=b');
  });

  it('shows the expired notice for ?expired=1 and for a 404 chat, and clears ?chat=', async () => {
    installServer();
    renderAsk('/ask?chat=gone');
    expect(await screen.findByText('This chat expired or was deleted.')).toBeInTheDocument();
    await waitFor(() => expect(location()).toHaveTextContent(/^\/ask$/));
    expect(screen.getByText('This chat expired or was deleted.')).toBeInTheDocument();
  });

  it('shows the notice for ?expired=1', async () => {
    installServer();
    renderAsk('/ask?expired=1');
    expect(await screen.findByText('This chat expired or was deleted.')).toBeInTheDocument();
  });
});
