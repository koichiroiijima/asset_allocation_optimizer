import { Badge } from '@mantine/core';

interface StatusBadgeProps {
  available: boolean;
}

/** データ取得状態のバッジ（取得済み / 未取得）。文言は既存 UI から不変。 */
export function StatusBadge({ available }: StatusBadgeProps) {
  return available ? (
    <Badge color="green" variant="light">
      取得済み
    </Badge>
  ) : (
    <Badge color="yellow" variant="light">
      未取得
    </Badge>
  );
}
