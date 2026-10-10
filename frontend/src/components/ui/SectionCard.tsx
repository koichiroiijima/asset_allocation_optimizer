import { Card, Stack, Title } from '@mantine/core';
import type { ReactNode } from 'react';

interface SectionCardProps {
  /** カード見出し（h3 または h4）。 */
  title: string;
  /** 見出しの見た目上のサイズ。省略時は h3。 */
  titleOrder?: 3 | 4;
  children: ReactNode;
}

/** 見出し付きカード。各画面のセクション（h3/h4 の塊）を統一する枠組み。 */
export function SectionCard({ title, titleOrder = 3, children }: SectionCardProps) {
  return (
    <Card padding="lg" mb="md">
      <Stack gap="sm">
        <Title order={titleOrder}>{title}</Title>
        {children}
      </Stack>
    </Card>
  );
}
