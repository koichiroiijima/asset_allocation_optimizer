"""ヘルスチェックエンドポイントのテスト。"""

from fastapi.testclient import TestClient


def test_health_ok(client: TestClient) -> None:
    """GET /api/health が 200 と status=ok を返す。"""
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["app"] == "asset-allocation-optimizer"
    assert "version" in body
    assert body["app_env"] == "test"


def test_root_health_ok(client: TestClient) -> None:
    """プレフィックス無しでも /api/health が有効（ベースURLスラッシュ誤り確認）。"""
    resp = client.get("/api/health")
    assert resp.status_code == 200
