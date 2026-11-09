import { useRef, useState } from 'react';

import type { ChatMode } from '../../api/types';
import { useStage } from '../../app';
import { AskHeader } from './AskHeader';
import styles from './AskPage.module.css';
import { Composer } from './Composer';
import { ConfirmDelete, type DeleteTarget } from './ConfirmDelete';
import { statusText } from './format';
import { ScopePicker } from './ScopePicker';
import { SessionsSidebar } from './SessionsSidebar';
import { Transcript } from './Transcript';
import { useAskData } from './useAskData';
import { useAskUrl } from './useAskUrl';
import { useDrawer } from './useDrawer';
import { useSendMessage } from './useSendMessage';
import { useSessionActions } from './useSessionActions';

/** Library-wide Ask workspace: sessions sidebar, category scope, transcript, composer. */
export default function AskPage() {
  useStage('ask');
  const url = useAskUrl();
  const data = useAskData(url.chatId, url.expired, url.select);
  const { session } = data;
  const drawer = useDrawer();
  const input = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<ChatMode>('teacher');
  const [error, setError] = useState('');
  const [draftCategories, setDraftCategories] = useState<string[]>([]);
  const [target, setTarget] = useState<DeleteTarget | null>(null);

  const actions = useSessionActions({ session, onError: setError });
  const sender = useSendMessage({
    session,
    draft: { book: url.book, page: url.page, categories: draftCategories },
    canSend: data.status?.available ?? true,
    setText,
    onError: setError,
    select: url.select,
  });
  const isAgentThinking = sender.busy || data.sessionStatus === 'thinking';
  const locked = isAgentThinking || actions.scopeBusy;
  const shownError = error || data.listError;

  function newChat() {
    if (actions.scopeBusy) return;
    setDraftCategories([]);
    data.clearNotice();
    url.select(null);
    drawer.hide();
    input.current?.focus();
  }

  async function confirmDelete() {
    if (!target) return;
    try {
      if (target.kind === 'project') await actions.removeProject(target.id);
      else await actions.removeChat(target.id, newChat);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The request failed.');
    }
    setTarget(null);
  }

  return (
    <div className={styles.shell}>
      <SessionsSidebar
        drawer={drawer}
        sessions={data.sessions}
        projects={data.projects}
        currentId={session?.id ?? null}
        loaded={data.listLoaded}
        locked={actions.scopeBusy}
        retentionDays={data.retentionDays}
        onNewChat={newChat}
        onSelect={(id) => {
          url.select(id);
          drawer.hide();
        }}
        onCreateProject={actions.addProject}
        onRemoveProject={(project) => setTarget({ kind: 'project', id: project.id, name: project.name })}
      />
      <button
        type="button"
        className={styles.backdrop}
        aria-label="Close chat list"
        hidden={!drawer.open}
        onClick={drawer.hide}
      />
      <section className={styles.main} inert={drawer.open}>
        <AskHeader
          drawer={drawer}
          session={session}
          draftBook={url.book}
          draftPage={url.page}
          projects={data.projects}
          locked={locked}
          onTogglePin={actions.togglePin}
          onProject={actions.setProject}
          onDelete={() => session && setTarget({ kind: 'chat', id: session.id })}
        />
        <ScopePicker
          categories={data.categories}
          selected={session ? session.categories : draftCategories}
          locked={locked}
          activeBook={session?.book ?? url.book}
          activePage={session?.page ?? url.page}
          onChange={session ? actions.setCategories : setDraftCategories}
        />
        <Transcript
          messages={session?.messages ?? []}
          pending={sender.pending}
          loading={data.loadingSession}
          aboutBook={Boolean(session?.book ?? url.book)}
          notice={data.notice}
          thoughtStep={data.thoughtStep}
          streamingText={data.streamingText}
          sessionStatus={data.sessionStatus}
          onPrompt={(prompt) => {
            if (/tutor|socratic|quiz me/i.test(prompt)) {
              setMode('tutor');
            }
            setText(prompt);
            input.current?.focus();
          }}
          onActionPrompt={(prompt) => {
            const nextMode: ChatMode =
              /tutor|socratic|quiz me|subskill|show progress|easier|harder|just tell me|save state/i.test(
                prompt,
              )
                ? 'tutor'
                : mode;
            if (nextMode !== mode) {
              setMode(nextMode);
            }
            if (!locked && (data.status?.available ?? true)) {
              void sender.send(prompt, actions.scopeBusy, nextMode);
            } else {
              setText(prompt);
              input.current?.focus();
            }
          }}
        />
        <p className={styles.error} role="alert" hidden={!shownError}>
          {shownError}
        </p>
        <Composer
          value={text}
          inputRef={input}
          busy={isAgentThinking}
          disabled={locked || !(data.status?.available ?? true)}
          mode={mode}
          onModeChange={setMode}
          onCancel={session ? () => void data.cancelGeneration() : undefined}
          onChange={setText}
          onSubmit={() => void sender.send(text, actions.scopeBusy, mode)}
        />
        <p className={styles.status}>{statusText(data.status, data.statusFailed)}</p>
      </section>
      <ConfirmDelete target={target} onCancel={() => setTarget(null)} onConfirm={() => void confirmDelete()} />
    </div>
  );
}
