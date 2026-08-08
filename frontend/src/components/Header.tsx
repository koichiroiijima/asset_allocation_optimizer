import type { ScreenKey } from '../App';

interface ScreenDef {
  key: ScreenKey;
  label: string;
}

interface HeaderProps {
  active: ScreenKey;
  onNavigate: (key: ScreenKey) => void;
  screens: ScreenDef[];
}

/** 画面切替用のヘッダーナビゲーション。 */
export function Header({ active, onNavigate, screens }: HeaderProps) {
  return (
    <header className="app-header">
      <h1>アセット配分最適化</h1>
      <nav>
        {screens.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => onNavigate(s.key)}
            className={active === s.key ? 'active' : undefined}
          >
            {s.label}
          </button>
        ))}
      </nav>
    </header>
  );
}
