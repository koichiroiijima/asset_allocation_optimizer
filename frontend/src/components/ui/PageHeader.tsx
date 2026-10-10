import { Box, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';

interface PageHeaderProps {
  /** 画面見出し（h2）。各タブのラベルと一致させること。 */
  title: string;
  /** 見出し直下の概要文。 */
  intro?: ReactNode;
}

/** 各画面の先頭に置く見出し＋概要。h2 はタブ切替テストの契約（heading role）のため維持する。 */
export function PageHeader({ title, intro }: PageHeaderProps) {
  return (
    <Box mb="md">
      <Title order={2}>{title}</Title>
      {intro && (
        <Text c="dimmed" size="sm" mt={4}>
          {intro}
        </Text>
      )}
    </Box>
  );
}
