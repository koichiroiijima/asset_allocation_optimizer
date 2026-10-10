import { Badge, Button, Group } from '@mantine/core';
import { useHealth } from '../hooks/useHealth';

/** バックエンド接続状態を表示する小さなウィジェット（旧 HealthCheck の Mantine 版）。 */
export function HealthBadge() {
  const { health, error, loading, refresh } = useHealth();

  if (loading) {
    return (
      <Badge variant="light" color="gray" data-testid="health">
        接続確認中…
      </Badge>
    );
  }

  if (error) {
    return (
      <Group gap="xs" wrap="nowrap">
        <Badge color="red" data-testid="health">
          API 接続エラー: {error}
        </Badge>
        <Button size="compact-xs" variant="default" onClick={() => void refresh()}>
          再試行
        </Button>
      </Group>
    );
  }

  const ok = health?.status === 'ok';
  return (
    <Badge variant="light" color={ok ? 'green' : 'red'} data-testid="health">
      API: {ok ? '正常' : '異常'}（v{health?.version} / {health?.app_env}）
    </Badge>
  );
}
