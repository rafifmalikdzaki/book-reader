import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Field } from './Field';
import { Input, Textarea } from './Input';
import { Select } from './Select';

describe('Field', () => {
  it('labels the control and wires hint and error through aria-describedby', () => {
    render(
      <Field label="Group name" hint="Up to 120 characters" error="Name is required" required>
        {(control) => <Input {...control} />}
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Group name' });
    expect(input).toBeInvalid();
    expect(input).toBeRequired();
    expect(input).toHaveAccessibleDescription('Up to 120 characters Name is required');
    expect(screen.getByRole('alert')).toHaveTextContent('Name is required');
  });

  it('adds no description or invalid state when there is no hint or error', () => {
    render(<Field label="Note">{(control) => <Textarea {...control} />}</Field>);
    const area = screen.getByRole('textbox', { name: 'Note' });
    expect(area).not.toHaveAttribute('aria-describedby');
    expect(area).toBeValid();
  });

  it('keeps a hidden label available to assistive tech and focuses on label click', async () => {
    const user = userEvent.setup();
    render(
      <Field label="Chat model" hideLabel>
        {(control) => (
          <Select {...control}>
            <option value="auto">Auto</option>
            <option value="m1">Model one</option>
          </Select>
        )}
      </Field>,
    );
    const trigger = screen.getByRole('combobox', { name: 'Chat model' });
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: 'Model one' }));
    expect(trigger).toHaveTextContent('Model one');
  });
});
