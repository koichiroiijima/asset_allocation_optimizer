import React from 'react';
import { AppShellLayout } from './components/layout/AppShellLayout';
import { CompareProvider } from './compare/CompareContext';
import { AssetSetProvider } from './state/AssetSetContext';
import { DataScreen } from './pages/DataScreen';
import { AnalysisScreen } from './pages/AnalysisScreen';
import { OptimizationScreen } from './pages/OptimizationScreen';
import { BlOptimizationScreen } from './pages/BlOptimizationScreen';
import { BacktestScreen } from './pages/BacktestScreen';
import { CompareScreen } from './pages/CompareScreen';

export type ScreenKey =
  'data' | 'analysis' | 'optimization' | 'optimization_bl' | 'backtest' | 'compare';

const SCREENS: { key: ScreenKey; label: string; Component: () => React.JSX.Element }[] = [
  { key: 'data', label: 'データ', Component: DataScreen },
  { key: 'analysis', label: '分析', Component: AnalysisScreen },
  { key: 'optimization', label: '最適化', Component: OptimizationScreen },
  { key: 'optimization_bl', label: '最適化（BL）', Component: BlOptimizationScreen },
  { key: 'backtest', label: 'バックテスト', Component: BacktestScreen },
  { key: 'compare', label: '比較・保存', Component: CompareScreen },
];

export function App() {
  const [active, setActive] = React.useState<ScreenKey>('data');
  const activeScreen = SCREENS.find((s) => s.key === active) ?? SCREENS[0];

  return (
    <AssetSetProvider>
      <CompareProvider>
        <AppShellLayout active={active} onNavigate={setActive} screens={SCREENS}>
          <activeScreen.Component />
        </AppShellLayout>
      </CompareProvider>
    </AssetSetProvider>
  );
}
