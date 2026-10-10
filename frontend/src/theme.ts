import { createTheme, type MantineColorsTuple } from '@mantine/core';

/** アプリの主色（旧 #2a6e9b 相当の落ち着いた青・10 段）。 */
const brand: MantineColorsTuple = [
  '#eaf2f8',
  '#d8e7f2',
  '#b3cfe4',
  '#8ab5d4',
  '#659cc3',
  '#3f7fae',
  '#2a6e9b',
  '#235b81',
  '#1d4a69',
  '#16374f',
];

/** Mantine テーマ。ライト固定で利用する（MantineProvider の forceColorScheme="light"）。 */
export const theme = createTheme({
  colors: {
    brand,
  },
  primaryColor: 'brand',
  fontFamily:
    "system-ui, -apple-system, 'Segoe UI', Roboto, 'Hiragino Sans', 'Noto Sans JP', sans-serif",
  defaultRadius: 'md',
  headings: {
    fontWeight: '600',
  },
  components: {
    Card: {
      defaultProps: {
        withBorder: true,
        shadow: 'xs',
      },
    },
    Table: {
      defaultProps: {
        verticalSpacing: 'xs',
        horizontalSpacing: 'sm',
      },
    },
  },
});
