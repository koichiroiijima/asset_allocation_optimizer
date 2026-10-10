import { Alert, Button } from '@mantine/core';

interface ErrorNoticeProps {
  /** ユーザー向け日本語メッセージ（例: 資産一覧の取得に失敗しました: …）。 */
  message: string;
  /** 再試行ハンドラ。未指定なら「再試行」ボタンを表示しない。 */
  onRetry?: () => void;
}

/** 画面内のエラー表示（メッセージ＋再試行）。文言は既存 UI から不変。 */
export function ErrorNotice({ message, onRetry }: ErrorNoticeProps) {
  return (
    <Alert color="red" variant="light" my="sm">
      {message}
      {onRetry && (
        <Button size="xs" variant="default" mt="xs" onClick={onRetry}>
          再試行
        </Button>
      )}
    </Alert>
  );
}
