import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

import type { ChatAskResponse, ChatStatus } from '../../api/types';
import { PanelProvider, usePanel } from '../../ui';

import { ChatRail } from './ChatRail';

export const AUTO: ChatStatus = {
  available: true,
  selected: 'auto',
  providers: [
    { id: 'mistral:small', provider: 'mistral', model: 'small' },
    { id: 'ollama:llama', provider: 'ollama', model: 'llama' },
  ],
};

export function answer(text: string): ChatAskResponse {
  return {
    answer: text,
    sources: [{ book: 'shelf/Deep Learning.pdf', page: 12 }],
    provider: 'mistral',
    model: 'small',
  };
}

function Opener() {
  const chat = usePanel('chat');
  return (
    <button type="button" {...chat.toggleProps}>
      Open chat
    </button>
  );
}

export function setup(ui: ReactNode = <ChatRail />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PanelProvider>
          <Opener />
          {ui}
        </PanelProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, user: userEvent.setup() };
}

export async function openChat(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Open chat' }));
  return screen.getByRole('complementary', { name: 'Ask the library' });
}
