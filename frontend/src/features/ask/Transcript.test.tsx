import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { stubScrollGeometry } from '../../ui/test-utils';
import { Transcript } from './Transcript';

function view(pending: { text: string; base: number } | null, liveSteps: string[] = []) {
  return (
    <MemoryRouter>
      <Transcript
        messages={[]}
        pending={pending}
        loading={false}
        aboutBook={false}
        notice=""
        liveSteps={liveSteps}
        onPrompt={() => undefined}
      />
    </MemoryRouter>
  );
}

describe('Transcript scrolling', () => {
  it('does not yank a reader who scrolled up when live steps arrive, but follows their own send', () => {
    stubScrollGeometry(1000);
    const { getByRole, rerender } = render(view({ text: 'q1', base: 0 }));
    const log = getByRole('log');
    log.scrollTop = 100;
    act(() => {
      log.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    rerender(view({ text: 'q1', base: 0 }, ['Searching library…']));
    expect(log.scrollTop).toBe(100);

    rerender(view(null));
    rerender(view({ text: 'q2', base: 0 }));
    expect(log.scrollTop).toBe(1000);
  });
});
