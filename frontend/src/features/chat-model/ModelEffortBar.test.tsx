import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import * as endpoints from '../../api/endpoints';
import { ModelEffortBar } from './ModelEffortBar';

vi.mock('../../api/endpoints');

describe('ModelEffortBar', () => {
  it('renders models, active model, and changes effort on click', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    vi.mocked(endpoints.getChatOptions).mockResolvedValue({
      available: true,
      models: [
        { id: 'inception:mercury-3', provider: 'inception', model: 'mercury-3' },
        { id: 'mistral:mistral-small-latest', provider: 'mistral', model: 'mistral-small-latest' },
      ],
      selected: 'inception:mercury-3',
      effort: 'medium',
    });
    vi.mocked(endpoints.setChatOptions).mockResolvedValue({
      ok: true,
      selected: 'inception:mercury-3',
      effort: 'high',
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ModelEffortBar />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('region', { name: 'Chat model and effort settings' })).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: 'mercury-3 (inception)' })).toBeInTheDocument();

    const select = screen.getByRole('combobox', { name: 'Model:' });
    expect(select).toHaveValue('inception:mercury-3');

    const highBtn = screen.getByRole('button', { name: 'High' });
    expect(highBtn).toHaveAttribute('aria-pressed', 'false');
    const medBtn = screen.getByRole('button', { name: 'Medium' });
    expect(medBtn).toHaveAttribute('aria-pressed', 'true');

    await user.click(highBtn);
    expect(endpoints.setChatOptions).toHaveBeenCalledWith({ effort: 'high' });
  });

  it('changes model on select in compact mode', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    vi.mocked(endpoints.getChatOptions).mockResolvedValue({
      available: true,
      models: [{ id: 'inception:mercury-3', provider: 'inception', model: 'mercury-3' }],
      selected: 'auto',
      effort: 'low',
    });
    vi.mocked(endpoints.setChatOptions).mockResolvedValue({
      ok: true,
      selected: 'inception:mercury-3',
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ModelEffortBar variant="compact" />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('region', { name: 'Chat model and effort settings' })).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: 'mercury-3 (inception)' })).toBeInTheDocument();

    const modelSelect = screen.getByRole('combobox', { name: 'Model:' });
    expect(modelSelect).toHaveValue('auto');

    await user.selectOptions(modelSelect, 'inception:mercury-3');
    expect(endpoints.setChatOptions).toHaveBeenCalledWith({ model: 'inception:mercury-3' });
  });

  it('treats an unset effort as Default and only sends a level once picked', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    vi.mocked(endpoints.getChatOptions).mockResolvedValue({
      available: true,
      models: [],
      selected: 'auto',
      effort: 'default',
    });
    vi.mocked(endpoints.setChatOptions).mockResolvedValue({ ok: true, selected: 'auto' });

    render(
      <QueryClientProvider client={queryClient}>
        <ModelEffortBar />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('button', { name: 'Default' })).toHaveAttribute('aria-pressed', 'true');
    for (const name of ['Low', 'Medium', 'High']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
    }
    await user.click(screen.getByRole('button', { name: 'Medium' }));
    expect(endpoints.setChatOptions).toHaveBeenCalledWith({ effort: 'medium' });
  });
});
