"""データ取得・エクスポート用コマンドラインインターフェース。

使い方（backend ディレクトリで）:
    uv run python -m app.cli fetch
    uv run python -m app.cli fetch --asset us_equity --asset us_bond \
        --start 2024-01-01 --end 2024-06-30
    uv run python -m app.cli export-csv --out ../data/processed

表示テキストは日本語（CLAUDE.md 表示方針）。
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Callable
from datetime import date
from pathlib import Path
from typing import cast

from app.config.settings import get_settings
from app.data.export import export_csv_processed
from app.data.pipeline import PricePipeline
from app.domain.assets import (
    ASSET_IDS_BY_SET,
    ASSET_LABELS,
    AssetSet,
    asset_set_for_assets,
    is_valid_asset_id,
)

__version__ = "0.1.0"


def _date_arg(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            f"日付は YYYY-MM-DD 形式で指定してください: {value}"
        ) from exc


def _parse_assets(values: list[str] | None) -> list[str] | None:
    """--asset 指定の検証。未指定は None（= 全資産）。"""
    if not values:
        return None
    for value in values:
        if not is_valid_asset_id(value):
            raise argparse.ArgumentTypeError(
                f"未知の資産IDです: {value}（対応: {', '.join(sorted(ASSET_LABELS))}）"
            )
    return values


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="app.cli",
        description="アセット配分最適化アプリのデータ取得・エクスポート CLI",
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    fetch = sub.add_parser("fetch", help="資産セットの価格を取得し raw/processed に保存する")
    fetch.add_argument(
        "--set",
        dest="asset_set",
        choices=sorted(ASSET_IDS_BY_SET),
        default=None,
        help="資産セット（モード）。既定: settings.default_asset_set（通常 us）",
    )
    fetch.add_argument(
        "--asset",
        action="append",
        metavar="ASSET_ID",
        help=("対象資産ID（省略時は選んだ資産セットの全資産）。"),
    )
    fetch.add_argument("--start", type=_date_arg, help="取得開始日（YYYY-MM-DD）")
    fetch.add_argument("--end", type=_date_arg, help="取得終了日（YYYY-MM-DD）")
    fetch.set_defaults(handler=_cmd_fetch)

    export = sub.add_parser("export-csv", help="processed Parquet を CSV へエクスポートする")
    export.add_argument(
        "--asset",
        action="append",
        metavar="ASSET_ID",
        help="対象資産ID（省略時は processed に存在する全資産）",
    )
    export.add_argument(
        "--out",
        type=Path,
        default=None,
        help="CSV 出力先ディレクトリ（既定: processed ディレクトリ）",
    )
    export.set_defaults(handler=_cmd_export_csv)
    return parser


def _cmd_fetch(args: argparse.Namespace) -> int:
    settings = get_settings()
    try:
        asset_ids = _parse_assets(args.asset)
    except argparse.ArgumentTypeError as exc:
        print(f"エラー: {exc}", file=sys.stderr)
        return 2

    # モードの決定: --set 優先。--asset のみ指定時は所属モードから推定。未指定は既定。
    asset_set: str | None = args.asset_set
    if asset_set is None and asset_ids:
        asset_set = asset_set_for_assets(asset_ids)
        if asset_set is None:
            print(
                "エラー: 資産IDが複数モードにまたがっています。--set でモードを指定してください。",
                file=sys.stderr,
            )
            return 2
    if asset_set is None:
        asset_set = settings.default_asset_set

    set_ids = ASSET_IDS_BY_SET.get(cast(AssetSet, asset_set))
    if set_ids is None:
        print(f"エラー: 未知の資産セットです: {asset_set}", file=sys.stderr)
        return 2
    invalid = [a for a in (asset_ids or []) if a not in set_ids]
    if invalid:
        print(
            f"エラー: 資産セット {asset_set} に含まれない資産IDです: {', '.join(invalid)}",
            file=sys.stderr,
        )
        return 2

    targets = asset_ids or list(set_ids)
    pipeline = PricePipeline(settings, asset_set=asset_set)
    try:
        summary = pipeline.run(asset_ids=asset_ids, start=args.start, end=args.end)
    finally:
        pipeline.close()

    failed = 0
    for res in summary["results"]:
        label = ASSET_LABELS.get(res["asset_id"], res["asset_id"])
        if res["status"] == "succeeded":
            print(
                f"成功: {label} ({res['asset_id']}) — {res['rows']} 行, "
                f"raw={res['raw_snapshot_hash'][:12]}…"
            )
        else:
            failed += 1
            print(f"失敗: {label} ({res['asset_id']}) — {res['error']}", file=sys.stderr)
    print(f"対象資産: {len(targets)} / 成功: {len(targets) - failed} / 失敗: {failed}")
    return 0 if failed == 0 else 1


def _cmd_export_csv(args: argparse.Namespace) -> int:
    settings = get_settings()
    if args.asset:
        for value in args.asset:
            if not is_valid_asset_id(value):
                print(f"エラー: 未知の資産IDです: {value}", file=sys.stderr)
                return 2
    written = export_csv_processed(settings.processed_dir, out_dir=args.out, asset_ids=args.asset)
    if not written:
        print(
            "エクスポート対象のデータがありません。先に fetch を実行してください。",
            file=sys.stderr,
        )
        return 1
    for path in written:
        print(f"出力: {path}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    handler: Callable[[argparse.Namespace], int] = args.handler  # type: ignore[attr-defined]
    return handler(args)


if __name__ == "__main__":
    raise SystemExit(main())
