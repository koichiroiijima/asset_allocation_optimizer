import type { ScreenKey } from '../App';
import type { AssetSet } from '../api/types';
import {
  ASSET_SET_CURRENCIES,
  ASSET_SET_DESCRIPTIONS,
  ASSET_SET_LABELS,
  useAssetSet,
} from '../state/AssetSetContext';

interface ScreenDef {
  key: ScreenKey;
  label: string;
}

interface HeaderProps {
  active: ScreenKey;
  onNavigate: (key: ScreenKey) => void;
  screens: ScreenDef[];
}

const ASSET_SETS: AssetSet[] = ['us', 'jp'];

/** 画面切替用のヘッダーナビゲーションと資産セット（米国/日本モード）切替スイッチ。 */
export function Header({ active, onNavigate, screens }: HeaderProps) {
  const { assetSet, setAssetSet } = useAssetSet();
  return (
    <header className="app-header">
      <div className="app-header-top">
        <h1>アセット配分最適化</h1>
        <div className="asset-set-block">
          <div className="asset-set-switch" role="group" aria-label="資産セット（モード）切替">
            <span className="asset-set-switch-label">モード:</span>
            {ASSET_SETS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setAssetSet(key)}
                className={assetSet === key ? 'active' : undefined}
                aria-pressed={assetSet === key}
              >
                {ASSET_SET_LABELS[key]}
              </button>
            ))}
            <span className="asset-set-currency" aria-label="基準通貨">
              {ASSET_SET_CURRENCIES[assetSet]}
            </span>
          </div>
          <p className="asset-set-description">{ASSET_SET_DESCRIPTIONS[assetSet]}</p>
        </div>
      </div>
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