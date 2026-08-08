import { useHealth } from '../hooks/useHealth';

/** バックエンド接続状態を表示する小さなウィジェット。 */
export function HealthCheck() {
  const { health, error, loading, refresh } = useHealth();

  if (loading) {
    return <p data-testid="health">接続確認中…</p>;
  }

  if (error) {
    return (
      <p data-testid="health" className="health-error">
        API 接続エラー: {error}
        <button type="button" onClick={() => void refresh()}>
          再試行
        </button>
      </p>
    );
  }

  return (
    <p data-testid="health">
      API: {health?.status === 'ok' ? '正常' : '異常'}（v{health?.version} / {health?.app_env}）
    </p>
  );
}
