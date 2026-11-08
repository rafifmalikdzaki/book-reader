import { useRef, useState } from 'react';

import {
  Button,
  Dialog,
  DialogActions,
  DialogSection,
  EmptyState,
  Field,
  IconButton,
  Input,
  LinkButton,
  PanelProvider,
  ProgressBar,
  Rail,
  RailBody,
  RailResizeHandle,
  Segmented,
  Select,
  Textarea,
  ToastProvider,
  VisuallyHidden,
  usePanel,
  useRailResize,
  useToast,
} from '../../ui';
import styles from './DesignPage.module.css';

const GEAR = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
    <path d="M1 14h6M9 8h6M17 16h6" />
  </svg>
);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function ButtonsDemo() {
  const [pressed, setPressed] = useState(false);
  return (
    <Section title="Button, IconButton, LinkButton">
      <div className={styles.row}>
        <Button>Primary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
        <Button size="sm">Small</Button>
        <Button size="lg">Large</Button>
        <Button disabled>Disabled</Button>
        <Button aria-expanded="true">Expanded</Button>
      </div>
      <p className={styles.caption}>Hover and Tab to see hover and focus-visible states.</p>
      <div className={styles.bar}>
        <Button variant="onDark" aria-pressed={pressed} onClick={() => setPressed(!pressed)}>
          Lamp
        </Button>
        <Button variant="onDark" disabled>
          Disabled
        </Button>
        <IconButton tone="onDark" label="Options" icon={GEAR} />
        <IconButton tone="onDark" label="Options (disabled)" icon={GEAR} disabled />
      </div>
      <div className={styles.row}>
        <IconButton tone="outline" label="Open chat list" icon="☰" />
        <IconButton tone="plain" label="Close notes" icon="×" />
        <LinkButton>Brass link</LinkButton>
        <LinkButton tone="danger">Remove</LinkButton>
        <LinkButton tone="muted">Cancel</LinkButton>
      </div>
    </Section>
  );
}

function FormsDemo() {
  const [view, setView] = useState<'tiles' | 'list'>('tiles');
  return (
    <Section title="Segmented, Select, Field, Input">
      <div className={styles.stack}>
        <Segmented
          label="Library view"
          value={view}
          onChange={setView}
          options={[
            { value: 'tiles', label: 'Tiles' },
            { value: 'list', label: 'List' },
          ]}
        />
        <Field label="Category">
          {(control) => (
            <Select {...control} defaultValue="all">
              <option value="all">All books</option>
              <option value="ml">Machine learning</option>
            </Select>
          )}
        </Field>
        <Field label="New group name" hint="Up to 120 characters">
          {(control) => <Input {...control} placeholder="New group…" maxLength={120} />}
        </Field>
        <Field label="Group name (error)" error="Name is required" required>
          {(control) => <Input {...control} />}
        </Field>
        <Field label="Comment">{(control) => <Textarea {...control} rows={2} placeholder="Why does this matter?" />}</Field>
        <Field label="Disabled">{(control) => <Input {...control} disabled defaultValue="Locked" />}</Field>
      </div>
    </Section>
  );
}

function DisplayDemo() {
  return (
    <Section title="ProgressBar, EmptyState, VisuallyHidden">
      <div className={styles.stack}>
        <ProgressBar label="Reading progress" value={0} />
        <ProgressBar label="Reading progress" value={38} valueText="Page 38 of 100" />
        <ProgressBar label="Reading progress" value={100} />
        <ProgressBar label="Tile progress" value={64} size="thin" />
        <EmptyState>No books match this filter.</EmptyState>
        <EmptyState
          variant="hero"
          title="Ask your library"
          actions={<Button variant="ghost" size="sm">Summarise this book</Button>}
        >
          Answers cite the book, page, and section they used.
        </EmptyState>
        <p>
          Next sentence has a screen-reader-only part:
          <VisuallyHidden> (you cannot see this)</VisuallyHidden>
        </p>
      </div>
    </Section>
  );
}

function ToastDemo() {
  const { toast } = useToast();
  return (
    <Section title="Toast">
      <Button variant="ghost" onClick={() => toast('Reindex complete.')}>
        Show toast
      </Button>
    </Section>
  );
}

function DialogDemo() {
  const [open, setOpen] = useState(false);
  return (
    <Section title="Dialog">
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Open dialog
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="Which mind answers?" description="Applies to Ask. Auto walks the provider chain.">
        <form
          className={styles.dialogForm}
          onSubmit={(event) => {
            event.preventDefault();
            setOpen(false);
          }}
        >
          <Field label="Chat model" hideLabel>
            {(control) => (
              <Select {...control} controlSize="lg">
                <option>Auto — follow the provider chain</option>
              </Select>
            )}
          </Field>
          <DialogActions>
            <Button type="submit">Save</Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </DialogActions>
        </form>
        <DialogSection title="Library">
          <Button variant="ghost">Reindex library</Button>
        </DialogSection>
      </Dialog>
    </Section>
  );
}

function RailsDemo() {
  const notes = usePanel('demo-notes');
  const chat = usePanel('demo-chat');
  const resize = useRailResize({ storageKey: 'br-design-rail-width' });
  const chatInput = useRef<HTMLTextAreaElement>(null);
  return (
    <Section title="Rail, usePanel, ResizableRail">
      <div className={styles.row}>
        <Button variant="ghost" {...notes.toggleProps}>
          Notes
        </Button>
        <Button variant="ghost" {...chat.toggleProps}>
          Ask
        </Button>
      </div>
      <p className={styles.caption}>
        One rail opens at a time; Esc closes and returns focus. Below 901px rails become sheets with Tab
        wrapping. The Ask rail resizes with its separator (drag, arrows, Home, End).
      </p>
      <div className={styles.stage}>
        <div className={styles.stageMain}>Stage content beside the rails.</div>
        <Rail {...notes.railProps} label="Researcher notepad" title="Notes">
          <RailBody className={styles.railBody}>
            <Input aria-label="New group name" placeholder="New group…" />
            <Button variant="ghost">Add</Button>
          </RailBody>
        </Rail>
        <Rail
          {...chat.railProps}
          label="Ask the library"
          title="Ask"
          width={resize.width}
          initialFocusRef={chatInput}
          handle={<RailResizeHandle resize={resize} />}
        >
          <RailBody className={styles.railBody}>
            <Textarea ref={chatInput} aria-label="Question" rows={3} placeholder="Ask about your books…" />
            <Button>Send</Button>
          </RailBody>
        </Rail>
      </div>
    </Section>
  );
}

/** Kitchen sink for ui/ primitives. Add each new primitive here. */
export default function DesignPage() {
  return (
    <PanelProvider>
      <ToastProvider>
        <div className={styles.page}>
          <h1>Design</h1>
          <p className={styles.lede}>Every ui/ primitive and state. Legacy look, tokens only.</p>
          <ButtonsDemo />
          <FormsDemo />
          <DisplayDemo />
          <DialogDemo />
          <ToastDemo />
          <RailsDemo />
        </div>
      </ToastProvider>
    </PanelProvider>
  );
}
