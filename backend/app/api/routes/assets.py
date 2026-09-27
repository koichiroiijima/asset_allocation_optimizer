"""資産定義エンドポイント。"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import get_settings
from app.config import Settings, load_asset_mapping
from app.data.repository import ParquetPriceRepository
from app.data.summary import summarize_series
from app.domain.assets import is_valid_asset_set
from app.schemas.asset import Asset, AssetDataStatus, AssetListResponse, AssetWithStatus

router = APIRouter(tags=["assets"])

SettingsDep = Annotated[Settings, Depends(get_settings)]


@router.get("/assets", response_model=AssetListResponse)
def list_assets(
    settings: SettingsDep,
    asset_set: Annotated[str | None, Query(alias="set")] = None,
) -> AssetListResponse:
    """指定した資産セット（モード）の資産定義一覧を返し、データ状態を合成する。

    - `set` は `us`（米国モード・既定）または `jp`（日本モード）。未指定は
      `settings.default_asset_set`。
    - データ未取得の資産は `data_status.available=False` で明示する（握りつぶさない）。
    - 未知の `set` は 400（日本語）を返す。
    """
    name = asset_set or settings.default_asset_set
    mapping_path = settings.asset_mapping_files.get(name)
    if mapping_path is None or not is_valid_asset_set(name):
        raise HTTPException(
            status_code=400,
            detail=(
                f"未知の資産セットです: {name}"
                f"（対応: {', '.join(sorted(settings.asset_mapping_files))}）"
            ),
        )

    repo = ParquetPriceRepository(settings.processed_dir)
    assets = load_asset_mapping(mapping_path)

    result: list[AssetWithStatus] = []
    for definition in assets:
        asset = Asset.model_validate(definition)
        data_status: AssetDataStatus | None = None
        try:
            df = repo.load_series(asset.logical_asset)
        except FileNotFoundError:
            data_status = AssetDataStatus(logical_asset=asset.logical_asset, available=False)
        else:
            status = summarize_series(df)
            manifest = repo.read_manifest(asset.logical_asset)
            status.snapshot_hash = manifest.get("snapshot_hash")
            data_status = status
        result.append(
            AssetWithStatus.model_validate({**asset.model_dump(), "data_status": data_status})
        )

    return AssetListResponse(assets=result)


__all__ = ["router"]
