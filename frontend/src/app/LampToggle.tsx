import { useLayoutEffect, useState } from 'react';

import { Button } from '../ui';
import { readStorage, writeStorage } from './storage';

export const LAMP_KEY = 'br-lamp';

/**
 * Legacy naming kept so saved preferences carry over: "on" means the lamp is lit,
 * i.e. the room is dimmed to the page (`body.lamp-off`).
 */
export function LampToggle() {
  const [lit, setLit] = useState(() => readStorage(LAMP_KEY) === 'on');
  useLayoutEffect(() => {
    document.body.classList.toggle('lamp-off', lit);
    return () => document.body.classList.remove('lamp-off');
  }, [lit]);

  return (
    <Button
      id="lamp-toggle"
      variant="onDark"
      aria-pressed={lit}
      title="Lamp: dim the room to the page"
      onClick={() => {
        writeStorage(LAMP_KEY, lit ? 'off' : 'on');
        setLit(!lit);
      }}
    >
      Lamp
    </Button>
  );
}
