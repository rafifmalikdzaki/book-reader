import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as endpoints from '../../api/endpoints';
import type { StoredMessage } from '../../api/types';
import { stubScrollGeometry, stubViewport } from '../../ui/test-utils';
import { installServer, makeSession, renderAsk } from './ask.harness';

/** Open a Base UI combobox and pick the option with the given name. */
async function pickOption(user: ReturnType<typeof userEvent.setup>, combobox: HTMLElement, optionName: RegExp | string) {
  await user.click(combobox);
  await user.click(await screen.findByRole('option', { name: optionName }));
}


vi.mock('../../api/endpoints');
vi.mock('../../app', () => ({
  useStage: vi.fn(),
  CHAT_STATUS_KEY: ['chat', 'status'],
}));

const location = () => screen.getByTestId('location');

beforeEach(() => {
  window.renderMathInElement = vi.fn();
  stubViewport(1280);
});
afterEach(() => {
  delete window.renderMathInElement;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Ask: session controls', () => {
  it('PATCHes categories when the scope changes, and sends the draft scope on first send', async () => {
    const server = installServer();
    server.sessions.push(makeSession({ id: 's9', title: 'Open' }));
    const user = renderAsk('/ask?chat=s9');
    await screen.findByRole('heading', { level: 1, name: 'Open' });
    await user.click(await screen.findByRole('checkbox', { name: 'Papers' }));
    expect(endpoints.updateChatSession).toHaveBeenCalledWith('s9', { categories: ['c1'] });
    expect(await screen.findByText('Papers', { selector: 'b' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'All books' })).not.toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'All books' }));
    expect(endpoints.updateChatSession).toHaveBeenLastCalledWith('s9', { categories: [] });
  });

  it('keeps the scope in the draft until the first message creates the chat', async () => {
    installServer();
    const user = renderAsk();
    await user.click(await screen.findByRole('checkbox', { name: 'Textbooks' }));
    expect(endpoints.updateChatSession).not.toHaveBeenCalled();
    await user.type(screen.getByRole('textbox', { name: 'Ask about your books' }), 'hi{Enter}');
    await screen.findByText('A tensor is an array.');
    expect(endpoints.createChatSession).toHaveBeenCalledWith({ categories: ['c2'] });
  });

  it('opens another chat at the bottom even if the previous one was scrolled up', async () => {
    stubScrollGeometry(1000);
    const turn = (id: string, content: string): StoredMessage => ({
      id,
      role: 'user',
      content,
      sources: [],
      provider: '',
      model: '',
      created: 1,
    });
    const server = installServer();
    server.sessions.push(
      makeSession({ id: 's1', title: 'First chat', messages: [turn('m1', 'one')] }),
      makeSession({ id: 's2', title: 'Second chat', messages: [turn('m2', 'two')] }),
    );
    const user = renderAsk('/ask?chat=s1');
    await screen.findByRole('heading', { level: 1, name: 'First chat' });
    const log = screen.getByRole('log');
    log.scrollTop = 100;
    fireEvent.scroll(log);

    await user.click(await screen.findByRole('button', { name: /^Second chat/ }));
    await screen.findByRole('heading', { level: 1, name: 'Second chat' });
    expect(screen.getByRole('log').scrollTop).toBe(1000);
  });

  it('renames any chat from the header; Escape and an empty title leave it alone', async () => {
    const server = installServer();
    server.sessions.push(
      makeSession({ id: 's1', title: 'First chat' }),
      makeSession({ id: 's2', title: 'Second chat' }),
    );
    const user = renderAsk('/ask?chat=s1');
    await screen.findByRole('heading', { level: 1, name: 'First chat' });

    await user.click(screen.getByRole('button', { name: 'Rename' }));
    await user.type(screen.getByRole('textbox', { name: 'Chat title' }), '{Escape}');
    expect(endpoints.updateChatSession).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1, name: 'First chat' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Rename' }));
    await user.clear(screen.getByRole('textbox', { name: 'Chat title' }));
    await user.type(screen.getByRole('textbox', { name: 'Chat title' }), '   {Enter}');
    expect(endpoints.updateChatSession).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const box = screen.getByRole('textbox', { name: 'Chat title' });
    expect(box).toHaveValue('First chat');
    await user.clear(box);
    await user.type(box, '  Tensor basics {Enter}');
    expect(endpoints.updateChatSession).toHaveBeenCalledWith('s1', { title: 'Tensor basics' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Tensor basics' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^Tensor basics/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Second chat/ }));
    await screen.findByRole('heading', { level: 1, name: 'Second chat' });
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    await user.clear(screen.getByRole('textbox', { name: 'Chat title' }));
    await user.type(screen.getByRole('textbox', { name: 'Chat title' }), 'Matrices');
    await user.tab();
    expect(endpoints.updateChatSession).toHaveBeenLastCalledWith('s2', { title: 'Matrices' });
  });

  it('pins and deletes a chat after confirmation', async () => {
    const server = installServer();
    server.sessions.push(makeSession({ id: 's9', title: 'Open' }));
    const user = renderAsk('/ask?chat=s9');
    const pin = await screen.findByRole('button', { name: 'Pin', pressed: false });
    await user.click(pin);
    expect(endpoints.updateChatSession).toHaveBeenCalledWith('s9', { pinned: true });
    expect(await screen.findByRole('button', { name: 'Pinned', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Pinned' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this chat?' });
    expect(within(dialog).getByText(/It cannot be undone\./)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(endpoints.deleteChatSession).toHaveBeenCalledWith('s9');
    expect(await screen.findByText('No chats yet. Ask a question to start one.')).toBeInTheDocument();
    await waitFor(() => expect(location()).toHaveTextContent(/^\/ask$/));
    expect(screen.queryByText('This chat expired or was deleted.')).not.toBeInTheDocument();
  });

  it('creates a project, files a chat in it, and unassigns chats when the project is deleted', async () => {
    const server = installServer();
    server.sessions.push(makeSession({ id: 's9', title: 'Open' }));
    const user = renderAsk('/ask?chat=s9');
    await screen.findByRole('heading', { level: 1, name: 'Open' });

    await user.click(screen.getByRole('button', { name: '+ Project' }));
    await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Thesis{Enter}');
    expect(endpoints.createChatProject).toHaveBeenCalledWith('Thesis');
    await pickOption(user, await screen.findByRole('combobox', { name: 'Chat project' }), 'Thesis');
    expect(endpoints.updateChatSession).toHaveBeenCalledWith('s9', { project_id: 'p1' });
    const group = (await screen.findByRole('heading', { level: 2, name: 'Thesis' })).closest('section');
    expect(within(group as HTMLElement).getByRole('button', { name: /^Open/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete project Thesis' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this project?' });
    expect(within(dialog).getByText('“Thesis” will be removed. Its chats stay in Recent.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(endpoints.deleteChatProject).toHaveBeenCalledWith('p1');
    const recent = (await screen.findByRole('heading', { level: 2, name: 'Recent' })).closest('section');
    expect(within(recent as HTMLElement).getByRole('button', { name: /^Open/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Thesis' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Chat project' })).toHaveTextContent('No project');
  });
});

describe('Ask: mobile drawer', () => {
  it('opens from the menu and closes on Esc, returning focus to the menu', async () => {
    stubViewport(390);
    const server = installServer();
    server.sessions.push(makeSession({ id: 's9', title: 'Gamma' }));
    const user = renderAsk();
    const menu = await screen.findByRole('button', { name: 'Open chat list' });
    const drawer = screen.getByLabelText('Chat sessions');
    expect(drawer).toHaveAttribute('inert');
    expect(menu).toHaveAttribute('aria-expanded', 'false');

    await user.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    expect(drawer).not.toHaveAttribute('inert');
    expect(screen.getAllByRole('button', { name: 'Close chat list' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Close chat list' })[0]).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(drawer).toHaveAttribute('inert');
    expect(menu).toHaveFocus();
    expect(screen.queryAllByRole('button', { name: 'Close chat list' })).toHaveLength(1);
  });

  it('closes on backdrop click and after choosing a chat', async () => {
    stubViewport(390);
    const server = installServer();
    server.sessions.push(makeSession({ id: 's9', title: 'Gamma' }));
    const user = renderAsk();
    const menu = await screen.findByRole('button', { name: 'Open chat list' });
    await user.click(menu);
    await user.click(screen.getAllByRole('button', { name: 'Close chat list' })[1] as HTMLElement);
    expect(menu).toHaveAttribute('aria-expanded', 'false');

    await user.click(menu);
    await user.click(await screen.findByRole('button', { name: /^Gamma/ }));
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(location()).toHaveTextContent('/ask?chat=s9');
  });
});
