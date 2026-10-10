import { Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';

interface ResultCardProps {
  /** 結果見出し（h3）。 */
  title: string;
  /** 基準通貨（見出しに併記。例: USD）。 */
  baseCurrency?: string;
  /** 「比較に追加」のハンドラ。未指定なら非表示。 */
  onAddToCompare?: () => void;
  /** 「比較に追加」直後の一時表示。 */
  added?: boolean;
  /** 結果に付随する日本語警告。 */
  warnings?: string[];
  children: ReactNode;
}

/** 最適化・バックテスト結果の共通枠（見出し＋基準通貨＋比較追加＋警告）。 */
export function ResultCard({
  title,
  baseCurrency,
  onAddToCompare,
  added,
  warnings,
  children,
}: ResultCardProps) {
  return (
    <Card padding="lg" mb="md">
      <Stack gap="sm">
        <Group gap="xs" wrap="nowrap">
          <Title order={3}>{title}</Title>
          {baseCurrency ? (
            <Text size="sm" c="dimmed">
              （基準通貨: {baseCurrency}）
            </Text>
          ) : null}
        </Group>
        {onAddToCompare && (
          <Group gap="sm">
            <Button size="xs" variant="default" onClick={onAddToCompare}>
              比較に追加
            </Button>
            {added && (
              <Text size="sm" c="dimmed">
                追加しました
              </Text>
            )}
          </Group>
        )}
        {(warnings ?? []).map((w, i) => (
          <Text key={i} size="sm" c="yellow.8">
            {w}
          </Text>
        ))}
        {children}
      </Stack>
    </Card>
  );
}
