import { Badge, Box, Burger, Group, SegmentedControl, Text, Title } from '@mantine/core';
import { HealthBadge } from './HealthBadge';
import type { AssetSet } from '../api/types';
import {
  ASSET_SET_CURRENCIES,
  ASSET_SET_DESCRIPTIONS,
  ASSET_SET_LABELS,
  useAssetSet,
} from '../state/AssetSetContext';

const ASSET_SETS: AssetSet[] = ['us', 'jp'];

interface HeaderBarProps {
  /** モバイル用サイドバーの開閉状態（AppShellLayout から受け取る）。 */
  burgerOpened: boolean;
  onBurgerToggle: () => void;
}

/** アプリヘッダー: タイトル・モード切替（セグメント型スイッチ）・基準通貨・接続状態。 */
export function HeaderBar({ burgerOpened, onBurgerToggle }: HeaderBarProps) {
  const { assetSet, setAssetSet } = useAssetSet();

  return (
    <Group h="100%" px="md" justify="space-between" wrap="nowrap">
      <Group gap="sm" wrap="nowrap">
        <Burger opened={burgerOpened} onClick={onBurgerToggle} hiddenFrom="sm" size="sm" />
        <Title order={1} fz="lg">
          アセット配分最適化
        </Title>
      </Group>
      <Group gap="sm" wrap="nowrap">
        <Box>
          <Group gap="xs" wrap="nowrap">
            <SegmentedControl
              size="xs"
              aria-label="資産セット（モード）切替"
              value={assetSet}
              onChange={(value) => setAssetSet(value as AssetSet)}
              data={ASSET_SETS.map((key) => ({ value: key, label: ASSET_SET_LABELS[key] }))}
            />
            <Badge variant="light" color="gray" aria-label="基準通貨">
              {ASSET_SET_CURRENCIES[assetSet]}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed" lineClamp={1}>
            {ASSET_SET_DESCRIPTIONS[assetSet]}
          </Text>
        </Box>
        <HealthBadge />
      </Group>
    </Group>
  );
}
