import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '../../ui';
import { PromptBar } from '../chat-render/agent/PromptBar';
import styles from './Home.module.css';

function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export interface HomeHelloProps {
  bookCount: number;
  /** "Zotero · 9 matched", or "" when Zotero is off. */
  zoteroText: string;
  onAddPaper: () => void;
}

/** Top of the home page: greeting, what the library holds, and a question box into Ask. */
export function HomeHello({ bookCount, zoteroText, onAddPaper }: HomeHelloProps) {
  const navigate = useNavigate();
  const input = useRef<HTMLTextAreaElement>(null);
  const [question, setQuestion] = useState('');
  const [now] = useState(() => new Date());

  const ask = () => {
    const text = question.trim();
    // Handed over as navigation state, not in the URL: a link must never be able to ask for you.
    if (text) void navigate('/ask', { state: { ask: text } });
  };

  return (
    <header className={styles.hello}>
      <div className={styles.helloRow}>
        <div>
          <h1 className={styles.greeting}>{greeting(now.getHours())}</h1>
          <p className={styles.today}>
            <time dateTime={now.toISOString().slice(0, 10)}>
              {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
            </time>
            <span>{bookCount} books · local library</span>
            {zoteroText ? <span>{zoteroText}</span> : null}
          </p>
        </div>
        <Button variant="ghost" onClick={onAddPaper}>
          Add paper
        </Button>
      </div>
      <div className={styles.ask}>
        <PromptBar
          value={question}
          inputRef={input}
          placeholder="Ask your library a question…"
          ariaLabel="Ask your library"
          actionLabel="Ask"
          onChange={setQuestion}
          onSubmit={ask}
        />
      </div>
    </header>
  );
}
