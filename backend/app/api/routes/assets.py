"""資産定義エンドポイント。"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import get_settings
from app.config import Settings, load_asset_mapping
from app.data.repository import ParquetPriceRepository
from app.data.summary import summarize_series
from app.schemas.asset import Asset, AssetDataStatus, AssetListResponse, AssetWithStatus

router = APIRouter(tags=["assets"])

SettingsDep = Annotated[Settings, Depends(get_settings)]


@router.get("/assets", response_model=AssetListResponse)
def list_assets(settings: SettingsDep) -> AssetListResponse:
    """設定ファイルから資産定義一覧を返し、processed データの状態を合成する。

    データ未取得の資産は `data_status.available=False` で明示する（握りつぶさない）。
    """
    repo = ParquetPriceRepository(settings.processed_dir)
    assets = load_asset_mapping(settings.asset_mapping_file)

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
