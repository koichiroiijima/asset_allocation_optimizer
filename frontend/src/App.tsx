import React from 'react';
import { Header } from './components/Header';
import { HealthCheck } from './components/HealthCheck';
import { CompareProvider } from './compare/CompareContext';
import { DataScreen } from './pages/DataScreen';
import { AnalysisScreen } from './pages/AnalysisScreen';
import { OptimizationScreen } from './pages/OptimizationScreen';
import { BacktestScreen } from './pages/BacktestScreen';
import { CompareScreen } from './pages/CompareScreen';

export type ScreenKey = 'data' | 'analysis' | 'optimization' | 'backtest' | 'compare';

const SCREENS: { key: ScreenKey; label: string; Component: () => React.JSX.Element }[] = [
  { key: 'data', label: 'データ', Component: DataScreen },
  { key: 'analysis', label: '分析', Component: AnalysisScreen },
  { key: 'optimization', label: '最適化', Component: OptimizationScreen },
  { key: 'backtest', label: 'バックテスト', Component: BacktestScreen },
  { key: 'compare', label: '比較・保存', Component: CompareScreen },
];

export function App() {
  const [active, setActive] = React.useState<ScreenKey>('data');
  const activeScreen = SCREENS.find((s) => s.key === active) ?? SCREENS[0];

  return (
    <CompareProvider>
      <div className="app-shell">
        <Header active={active} onNavigate={setActive} screens={SCREENS} />
        <main>
          <HealthCheck />
          <activeScreen.Component />
        </main>
      </div>
    </CompareProvider>
  );
}
