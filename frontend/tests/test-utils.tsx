import type { RenderOptions } from '@testing-library/react';
import { render as rtlRender } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import type { ComponentType, ReactElement, ReactNode } from 'react';
import { theme } from '../src/theme';

/** 追加で包む Provider（既存テストの CompareProvider 等で使用）。 */
type ExtraWrapper = ComponentType<{ children?: ReactNode }>;

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  wrapper?: ExtraWrapper;
}

function MantineWrapper({ children }: { children?: ReactNode }) {
  return (
    <MantineProvider theme={theme} forceColorScheme="light">
      {children}
    </MantineProvider>
  );
}

/** MantineProvider で包んで描画する（Mantine コンポーネントは Provider が必須のため）。 */
export function render(ui: ReactElement, { wrapper: Extra, ...options }: CustomRenderOptions = {}) {
  if (!Extra) {
    return rtlRender(ui, { ...options, wrapper: MantineWrapper });
  }
  const Composed = ({ children }: { children?: ReactNode }) => (
    <MantineWrapper>
      <Extra>{children}</Extra>
    </MantineWrapper>
  );
  return rtlRender(ui, { ...options, wrapper: Composed });
}
