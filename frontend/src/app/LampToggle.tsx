import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Button } from '../ui';
import styles from './LampToggle.module.css';
import { readStorage, writeStorage } from './storage';

export const LAMP_KEY = 'br-lamp';

export type Atmosphere = 'daylight' | 'amber' | 'midnight';

export interface AtmosphereOption {
  id: Atmosphere;
  name: string;
  desc: string;
  icon: string;
}

export const ATMOSPHERES: readonly AtmosphereOption[] = [
  { id: 'daylight', name: 'Daylit Paper', desc: 'Crisp daytime parchment', icon: '☀️' },
  { id: 'amber', name: 'Amber Study', desc: 'Warm incandescent desk glow', icon: '🕯️' },
  { id: 'midnight', name: 'Midnight Baize', desc: 'Nocturnal dark reading mode', icon: '🌙' },
];

function resolveInitialAtmosphere(): Atmosphere {
  const stored = readStorage(LAMP_KEY);
  if (stored === 'midnight') return 'midnight';
  if (stored === 'on') return 'amber';
  return 'daylight';
}

function atmosphereToStorage(atm: Atmosphere): string {
  if (atm === 'midnight') return 'midnight';
  if (atm === 'amber') return 'on';
  return 'off';
}

/**
 * 3-Stop Reading Atmosphere Controller:
 * - Daylit Paper: neutral daylight parchment
 * - Amber Study: warm incandescent desk lamp vignette
 * - Midnight Baize: nocturnal scholar dark mode
 */
export function LampToggle() {
  const [atmosphere, setAtmosphere] = useState<Atmosphere>(resolveInitialAtmosphere);
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close menu on click outside or Escape
  useEffect(() => {
    if (!menuOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMenuOpen(false);
      }
    }
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [menuOpen]);

  useLayoutEffect(() => {
    const isLit = atmosphere !== 'daylight';
    document.body.classList.toggle('lamp-off', isLit);
    document.body.classList.toggle('atmosphere-midnight', atmosphere === 'midnight');
    document.body.setAttribute('data-atmosphere', atmosphere);

    return () => {
      document.body.classList.remove('lamp-off', 'atmosphere-midnight');
      document.body.removeAttribute('data-atmosphere');
    };
  }, [atmosphere]);

  const selectAtmosphere = (atm: Atmosphere) => {
    writeStorage(LAMP_KEY, atmosphereToStorage(atm));
    setAtmosphere(atm);
    setMenuOpen(false);
  };

  const toggleLamp = () => {
    if (atmosphere === 'daylight') {
      selectAtmosphere('amber');
    } else {
      selectAtmosphere('daylight');
    }
  };

  const isLit = atmosphere !== 'daylight';
  const currentAtm = ATMOSPHERES.find((a) => a.id === atmosphere) ?? ATMOSPHERES[0]!;

  return (
    <div ref={containerRef} className={styles.container}>
      <div className={styles.group}>
        <Button
          id="lamp-toggle"
          variant="onDark"
          aria-pressed={isLit}
          title={`Atmosphere: ${currentAtm.name} (click to toggle)`}
          onClick={toggleLamp}
          className={styles.lampBtn}
        >
          <span
            aria-hidden="true"
            className={`${styles.dot} ${atmosphere === 'amber' ? styles.dotAmber : atmosphere === 'midnight' ? styles.dotMidnight : ''}`}
          />
          Lamp
        </Button>
        <button
          id="atmosphere-menu-trigger"
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={`Select atmosphere (current: ${currentAtm.name})`}
          title="Select reading atmosphere"
          className={styles.chevronBtn}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          ▾
        </button>
      </div>

      {menuOpen ? (
        <ul role="menu" className={styles.menu} aria-label="Reading atmosphere">
          {ATMOSPHERES.map((atm) => {
            const isSelected = atmosphere === atm.id;
            return (
              <li key={atm.id} role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={isSelected}
                  className={styles.menuItem}
                  onClick={() => selectAtmosphere(atm.id)}
                >
                  <span className={styles.icon} aria-hidden="true">
                    {atm.icon}
                  </span>
                  <span className={styles.textGroup}>
                    <span className={styles.title}>{atm.name}</span>
                    <span className={styles.desc}>{atm.desc}</span>
                  </span>
                  {isSelected ? (
                    <span className={styles.check} aria-hidden="true">
                      ✓
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
