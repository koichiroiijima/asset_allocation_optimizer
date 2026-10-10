import { AppShell, Box } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import type { ReactNode } from 'react';
import type { ScreenKey } from '../../App';
import { HeaderBar } from '../HeaderBar';
import { NavMenu } from '../NavMenu';

interface ScreenDef {
  key: ScreenKey;
  label: string;
}

interface AppShellLayoutProps {
  active: ScreenKey;
  onNavigate: (key: ScreenKey) => void;
  screens: ScreenDef[];
  children: ReactNode;
}

/** サイドバー型レイアウト（ヘッダー＋ナビ＋本文）。 */
export function AppShellLayout({ active, onNavigate, screens, children }: AppShellLayoutProps) {
  const [opened, { toggle }] = useDisclosure();

  return (
    <AppShell
      padding="md"
      header={{ height: 64 }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !opened } }}
    >
      <AppShell.Header>
        <HeaderBar burgerOpened={opened} onBurgerToggle={toggle} />
      </AppShell.Header>
      <AppShell.Navbar>
        <NavMenu active={active} onNavigate={onNavigate} screens={screens} />
      </AppShell.Navbar>
      <AppShell.Main>
        <Box maw={1200}>{children}</Box>
      </AppShell.Main>
    </AppShell>
  );
}
