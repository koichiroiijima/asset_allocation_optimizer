import { NavLink, ScrollArea, Stack } from '@mantine/core';
import {
  IconBulb,
  IconChartLine,
  IconChartPie,
  IconDatabase,
  IconGitCompare,
  IconHistory,
} from '@tabler/icons-react';
import type { ComponentType } from 'react';
import type { ScreenKey } from '../App';

/** アイコンコンポーネントの共通 props 型。 */
type IconComponent = ComponentType<{ size?: number | string; stroke?: number | string }>;

interface ScreenDef {
  key: ScreenKey;
  label: string;
}

interface NavMenuProps {
  active: ScreenKey;
  onNavigate: (key: ScreenKey) => void;
  screens: ScreenDef[];
}

/** 画面キー → サイドバーのアイコン。 */
const SCREEN_ICONS: Record<ScreenKey, IconComponent> = {
  data: IconDatabase,
  analysis: IconChartLine,
  optimization: IconChartPie,
  optimization_bl: IconBulb,
  backtest: IconHistory,
  compare: IconGitCompare,
};

/** サイドバーナビゲーション。ボタンとして描画しタブ切替テストの契約（button role）を維持する。 */
export function NavMenu({ active, onNavigate, screens }: NavMenuProps) {
  return (
    <ScrollArea>
      <Stack gap={2} p="xs">
        {screens.map((s) => {
          const Icon = SCREEN_ICONS[s.key];
          return (
            <NavLink
              key={s.key}
              component="button"
              type="button"
              label={s.label}
              leftSection={<Icon size={18} stroke={1.5} />}
              active={active === s.key}
              onClick={() => onNavigate(s.key)}
            />
          );
        })}
      </Stack>
    </ScrollArea>
  );
}
