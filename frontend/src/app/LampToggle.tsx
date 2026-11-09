import { Menu } from '@base-ui/react/menu';
import { useLayoutEffect, useState, type ReactNode } from 'react';

import { Button } from '../ui';
import styles from './LampToggle.module.css';
import { readStorage, writeStorage } from './storage';

export const LAMP_KEY = 'br-lamp';

export type Atmosphere = 'daylight' | 'amber' | 'midnight';

export interface AtmosphereOption {
  id: Atmosphere;
  name: string;
  desc: string;
  icon: ReactNode;
}

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function LampIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-4 10.5c.8.7 1.3 1.5 1.5 2.5h5c.2-1 .7-1.8 1.5-2.5A6 6 0 0 0 12 3z" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

export const ATMOSPHERES: readonly AtmosphereOption[] = [
  { id: 'daylight', name: 'Daylit Paper', desc: 'Crisp daytime parchment', icon: <SunIcon /> },
  { id: 'amber', name: 'Amber Study', desc: 'Warm incandescent desk glow', icon: <LampIcon /> },
  { id: 'midnight', name: 'Midnight Baize', desc: 'Nocturnal dark reading mode', icon: <MoonIcon /> },
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
 *
 * The atmosphere menu is a Base UI Menu: arrow-key navigation, Esc/outside-click
 * dismissal and focus restore are handled by the primitive.
 */
export function LampToggle() {
  const [atmosphere, setAtmosphere] = useState<Atmosphere>(resolveInitialAtmosphere);

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
  };

  const toggleLamp = () => {
    selectAtmosphere(atmosphere === 'daylight' ? 'amber' : 'daylight');
  };

  const isLit = atmosphere !== 'daylight';
  const currentAtm = ATMOSPHERES.find((a) => a.id === atmosphere) ?? ATMOSPHERES[0]!;

  return (
    <div className={styles.container}>
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
        <Menu.Root>
          <Menu.Trigger
            id="atmosphere-menu-trigger"
            aria-label={`Select atmosphere (current: ${currentAtm.name})`}
            title="Select reading atmosphere"
            className={styles.chevronBtn}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner sideOffset={6} className={styles.positioner}>
              <Menu.Popup className={styles.menu} aria-label="Reading atmosphere">
                <Menu.RadioGroup
                  value={atmosphere}
                  onValueChange={(value: Atmosphere) => selectAtmosphere(value)}
                >
                  {ATMOSPHERES.map((atm) => (
                    <Menu.RadioItem key={atm.id} value={atm.id} className={styles.menuItem}>
                      <span className={styles.icon} aria-hidden="true">
                        {atm.icon}
                      </span>
                      <span className={styles.textGroup}>
                        <span className={styles.title}>{atm.name}</span>
                        <span className={styles.desc}>{atm.desc}</span>
                      </span>
                      <Menu.RadioItemIndicator className={styles.check} aria-hidden="true">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      </Menu.RadioItemIndicator>
                    </Menu.RadioItem>
                  ))}
                </Menu.RadioGroup>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>
    </div>
  );
}
