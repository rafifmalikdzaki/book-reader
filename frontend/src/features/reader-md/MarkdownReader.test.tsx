import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeDoc, openMarkdown, serveMarkdown, stubScroll } from './testKit';

vi.mock('../chat-rail', () => ({ ChatRail: () => null }));

const scrollIntoView = vi.fn();
const scrollTo = vi.fn();

beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
  window.scrollTo = scrollTo as typeof window.scrollTo;
});
afterEach(() => {
  vi.unstubAllGlobals();
  scrollIntoView.mockClear();
  scrollTo.mockClear();
});

const scrolledTo = (): string[] =>
  scrollIntoView.mock.contexts.map((element) => (element as HTMLElement).id);

describe('MarkdownReader document', () => {
  it('injects the server HTML, titles the toolbar and publishes the book context', async () => {
    serveMarkdown(makeDoc());
    await openMarkdown();
    expect(screen.getByRole('link', { name: 'an outside link' })).toHaveAttribute('href', 'https://example.com/x');
    expect(document.getElementById('L7')).toHaveTextContent('Second paragraph text.');
    expect(screen.getByText('n.md')).toBeInTheDocument();
    expect(screen.getByTestId('book-context')).toHaveTextContent('notes/n.md');
  });

  it('scrolls to the block at or before #L<n> on load', async () => {
    serveMarkdown(makeDoc());
    await openMarkdown('/book/notes/n.md#L6');
    expect(scrolledTo()).toEqual(['L5']);
  });

  it('follows router hash changes, which never fire hashchange', async () => {
    serveMarkdown(makeDoc());
    await openMarkdown();
    expect(scrollIntoView).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'go to line 9' }));
    expect(scrolledTo()).toEqual(['L9']);
    await userEvent.click(screen.getByRole('button', { name: 'go to line 9' }));
    expect(scrolledTo()).toEqual(['L9', 'L9']);
  });

  it('opens book links through the router and leaves outside, raw and modified clicks alone', async () => {
    serveMarkdown(makeDoc());
    await openMarkdown();
    const location = screen.getByTestId('location');
    const handled: boolean[] = [];
    const record = (event: Event) => {
      handled.push(event.defaultPrevented);
      event.preventDefault(); // keep jsdom from "navigating"
    };
    document.addEventListener('click', record);

    const bookLink = screen.getByRole('link', { name: 'a book link' });
    fireEvent.click(bookLink, { ctrlKey: true });
    fireEvent.click(screen.getByRole('link', { name: 'a raw link' }));
    fireEvent.click(screen.getByRole('link', { name: 'an outside link' }));
    expect(handled).toEqual([false, false, false]);
    expect(location).toHaveTextContent(/^\/book\/notes\/n\.md$/);

    fireEvent.click(bookLink);
    document.removeEventListener('click', record);
    await waitFor(() => expect(location).toHaveTextContent('/book/other.md#L9'));
  });
});

describe('MarkdownReader progress', () => {
  it('restores the saved ratio, then reports and saves scrolling after the debounce', async () => {
    const { posts } = serveMarkdown(makeDoc({ progress: { page: null, scroll: 0.25, updated: 1 } }));
    const page = stubScroll(2000);
    await openMarkdown();
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 250));

    act(() => {
      window.dispatchEvent(new Event('wheel'));
      page.scrollTo(500);
    });
    expect(screen.getAllByText('50% read')).toHaveLength(2);
    expect(posts).toEqual([]);
    await waitFor(() => expect(posts).toEqual([{ path: 'notes/n.md', scroll: 0.5 }]), { timeout: 2000 });
  });

  it('opens at the top when there is no saved position', async () => {
    serveMarkdown(makeDoc());
    stubScroll(2000);
    await openMarkdown();
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 0));
  });

  it('flushes a pending scroll save when the reader unmounts', async () => {
    const { posts } = serveMarkdown(makeDoc());
    const page = stubScroll(2000);
    const view = await openMarkdown();
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 0));

    act(() => {
      window.dispatchEvent(new Event('wheel'));
      page.scrollTo(500);
    });
    view.unmount();
    await waitFor(() => expect(posts).toEqual([{ path: 'notes/n.md', scroll: 0.5 }]));
  });

  it('lets a #L deep link beat the saved position', async () => {
    serveMarkdown(makeDoc({ progress: { page: null, scroll: 0.25, updated: 1 } }));
    stubScroll(2000);
    await openMarkdown('/book/notes/n.md#L7');
    await waitFor(() => expect(scrolledTo()).toEqual(['L7']));
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe('MarkdownReader outline', () => {
  it('marks the heading being read and jumps on click without touching the URL', async () => {
    serveMarkdown(makeDoc());
    await openMarkdown();
    const top = { Title: -300, Methods: 40, Results: 600 };
    for (const [name, y] of Object.entries(top)) {
      const heading = screen.getByRole('heading', { name });
      heading.getBoundingClientRect = () => ({ top: y }) as DOMRect;
    }
    fireEvent.click(screen.getAllByRole('button', { name: 'Outline' })[0] as HTMLElement);
    const rail = screen.getByRole('complementary', { name: 'Outline' });
    fireEvent.scroll(window);
    await waitFor(() => expect(within(rail).getByRole('link', { name: 'Methods' })).toHaveAttribute('aria-current', 'location'));
    expect(within(rail).getByRole('link', { name: 'Results' })).not.toHaveAttribute('aria-current');

    await userEvent.click(within(rail).getByRole('link', { name: 'Results' }));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(scrolledTo()).toEqual(['L9']);
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/book\/notes\/n\.md$/);
  });
});
