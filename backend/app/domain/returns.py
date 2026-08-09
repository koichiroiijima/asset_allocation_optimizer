"""リターン計算・年率換算（純粋な pandas 演算）。

HTTP・DB・外部データに依存しないドメイン層の純粋関数。正規化済みの
価格系列（`prices`）やリターン系列（`returns`）を入力とする。

前提:
- インデックスは `DatetimeIndex`（昇順）。
- 欠損値（NaN）は前処理・推測補完せず、そのまま結果へ伝播する
  （CLAUDE.md: 金融データの値を推測で補完しない）。
- 累積リターンと年率リターンは時間加重（time-weighted）を基本とする。
- 年率換算の頻度（`annualization_factor`）は引数として注入し、
  `Settings.annualization_factor`（既定 252）と整合させる。
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

from app.schemas.series import Frequency


def _mean(returns: pd.Series) -> float | None:
    """欠損を除いた平均を返す。空・全 NaN の場合は None。"""
    clean = returns.dropna()
    if clean.size == 0:
        return None
    return float(clean.mean())


# pandas 2.2 以降は "M"（MonthEnd）→ "ME" へ改名されたため明示的に "ME" を使う。
_FREQ_MAP: dict[Frequency, str] = {"D": "D", "W": "W", "M": "ME"}


def simple_return(prices: pd.Series) -> pd.Series:
    """単純リターン（時間加重）の系列を返す。

    各時点のリターンは `prices[t] / prices[t-1] - 1`。先頭は NaN になる。
    欠損値は前処理しない（`fill_method=None` により NaN を伝播させる）。
    空・1 点入力は全 NaN の Series を返す（例外を投げない）。
    """
    return prices.pct_change(fill_method=None)


def log_return(prices: pd.Series) -> pd.Series:
    """対数リターン `ln(prices[t] / prices[t-1])` の系列を返す。

    先頭は NaN。非正の価格は対数が定義されないため `-inf` や NaN として
    顕在化させる（推測補完しない）。
    """
    ratio = prices.astype("float64") / prices.shift().astype("float64")
    return ratio.map(np.log)


def cumulative_return(returns: pd.Series) -> pd.Series:
    """累積リターンの系列（時間加重・`cumprod(1 + r) - 1`）を返す。

    先頭要素は基準日＝リターン 0.0 を表し、累積は 0.0 から始まる。
    途中の NaN は `cumprod` の skipna に任せ「観測なし＝1.0 の寄与」と
    みなす（推測補完しない）。
    """
    cumulative = (1.0 + returns).cumprod() - 1.0
    if not cumulative.empty:
        cumulative = cumulative.copy()
        cumulative.iloc[0] = 0.0
    return cumulative


def annualize_return(
    returns: pd.Series,
    annualization_factor: int = 252,
    *,
    method: str = "geometric",
) -> float:
    """リターン系列を年率換算した値を返す。

    - `geometric`（既定）: `(1 + mean)^factor - 1`
      時間加重の相場慣例。バックテストの年率リターンに使う。
    - `arithmetic`: `mean * factor`
      PyPortfolioOpt の `mean_historical_return` 互換。後続の最適化に使う。

    空・全 NaN の場合は `float("nan")` を返す（ゼロ除算・空系列を握り
    つぶさない）。
    """
    mean = _mean(returns)
    if mean is None:
        return float("nan")
    if method == "geometric":
        return float((1.0 + mean) ** annualization_factor - 1.0)
    if method == "arithmetic":
        return float(mean * annualization_factor)
    raise ValueError(f"未知の method: {method!r}（'geometric' または 'arithmetic'）")


def annualize_log_return(
    log_returns: pd.Series,
    annualization_factor: int = 252,
) -> float:
    """対数リターン系列を年率換算した値を返す。

    対数リターンの和は経路非依存のため `expm1(mean * factor)` で正確に
    年率換算できる。空・全 NaN の場合は `float("nan")` を返す。
    """
    mean = _mean(log_returns)
    if mean is None:
        return float("nan")
    return float(np.expm1(mean * annualization_factor))


def annualize_volatility(
    returns: pd.Series,
    annualization_factor: int = 252,
) -> float:
    """リターン系列の年率換算ボラティリティを返す。

    標本標準偏差（ddof=1）× `sqrt(factor)`。データが 1 点未満の場合は
    `float("nan")` を返す。
    """
    clean = returns.dropna()
    if clean.size < 2:
        return float("nan")
    return float(clean.std(ddof=1) * math.sqrt(float(annualization_factor)))


def rolling_volatility(
    returns: pd.Series,
    window: int,
    annualization_factor: int = 252,
) -> pd.Series:
    """リターン系列のローリング（移動）年率ボラティリティ系列を返す。

    各時点で直近 `window` 個の観測（NaN を除外した標本標準偏差 ddof=1）に
    `sqrt(factor)` を掛けて年率換算する。`window` 個未満の観測しかない
    先頭区間は NaN になる。欠損値は補完せず NaN のまま伝播する
    （`rolling().std` は min_periods 既定により window 個に満たない窓を NaN に）。

    - `window < 2` は集計不能なため `ValueError` を投げる（範囲外の入力）。
    - 空・全 NaN の Series は全 NaN の Series を返す（例外を投げない）。
    """
    if window < 2:
        raise ValueError(f"rolling_volatility の window は2以上必要です（指定: {window}）")
    source = returns.astype("float64")
    if source.dropna().size < 2:
        return pd.Series(np.nan, index=source.index, dtype="float64")
    vol = source.rolling(window=window).std(ddof=1) * math.sqrt(float(annualization_factor))
    return vol.astype("float64")


def correlation_matrix(returns: pd.DataFrame) -> pd.DataFrame:
    """リターン系列（列=資産）のピアソン相関行列を返す。

    pandas の `DataFrame.corr()` に従い、NaN は列（資産）ペアごとに
    観測がある組だけを使って除外する（値を推測補完しない）。行が 1 未満、
    列が 1 未満の場合は空/1×1 の行列を返す。単一資産（1 列）は 1×1 行列で
    対角成分が 1.0 になる。

    注: 観測数の少ないペアの相関は安定しない。呼び出し側で観測数を警告し、
    解釈を慎重にする（CLAUDE.md: 金融データの値は推測補完しない）。
    """
    if returns.empty or returns.shape[1] < 1:
        return pd.DataFrame(index=returns.columns, columns=returns.columns, dtype="float64")
    return returns.corr()


def resample_returns(
    returns: pd.Series,
    frequency: Frequency = "M",
    *,
    log: bool = False,
) -> pd.Series:
    """リターン系列を指定頻度（'D'/'W'/'M'）へ集約した系列を返す。

    - 入力が単純リターン（`log=False`）: 期間内を `(1 + r)` の積で複利合成
      （`(1+r).prod() - 1`、時間加重に整合）。
    - 入力が対数リターン（`log=True`）: 期間内の**和**（経路非依存）。

    集約 index は各期間の**最終観測日**（`SeriesPoint.date` に一致させる）。
    空・1 点の Series もそのまま返す。'D' は恒等。

    注: 週次（'W'）のアンカーは pandas 既定（週末終わり）に任せる。
    カレンダー規則の確定時に、アンカーや週次複利の偶発的欠損の扱いを
    再検討する（docs/design.md §11 参照）。
    """
    # mypy: 戻り値の dtype を揃えるため float 昇格。
    source = returns.astype("float64")
    if frequency == "D" or source.size < 2:
        return source

    freq = _FREQ_MAP[frequency]
    grouper = pd.Grouper(freq=freq, origin="start_day")
    if log:
        grouped: pd.Series = source.groupby(grouper).sum().astype("float64")
    else:
        grouped = (1.0 + source).groupby(grouper).prod().astype("float64") - 1.0

    # 各期間の最終観測日を index に使う（期間の終了日ではない）。
    # 日付を値にもつ直列を作り期間で最大値を取ることで、実際の最終観測日を得る。
    # groupby はデータのない空期間（例: 2月〜5月の間の3・4月）も NaT で index に出す。
    # この NaT（空期間）をマスクに、対応する grouped 行ごと除去して同期させる
    # （sum/prod は空期間を NaN・0.0 として残すため、last_obs 側の NaT で揃えて除く）。
    last_obs: pd.Series = source.index.to_series().groupby(grouper).max()
    valid = ~last_obs.isna()
    grouped = grouped[valid.to_numpy()]
    grouped.index = pd.DatetimeIndex(last_obs[valid].to_numpy())
    grouped.index.name = source.index.name
    return grouped


def resample_prices(
    prices: pd.Series,
    frequency: Frequency = "M",
) -> pd.Series:
    """価格系列を指定頻度（'D'/'W'/'M'）へ集約した系列を返す。

    各期間の**直近の観測価格**（その期間の最終観測日にある最大の実測価格）を
    採用する。まず欠損（NaN）を除いた上で `groupby().last()` を使うため、
    期間内で最後に実際に観測された価格が値に、その観測日が index になる
    （値と日付が常に対応する。値を推測補完しない）。リターン系の
    `resample_returns` と同じ「最終観測日を index にする」規則に揃える。

    空・1 点の Series はそのまま返す。'D' は恒等。
    """
    source = prices.astype("float64")
    if frequency == "D" or source.size < 2:
        return source

    # 観測がある行だけに絞る（NaN は未来の価格として index に混ぜない）。
    clean = source.dropna()
    freq = _FREQ_MAP[frequency]
    grouper = pd.Grouper(freq=freq, origin="start_day")
    # 各期間の最終観測日を index に使う。空期間の NaT をマスクに grouped と同期除去する。
    last_obs: pd.Series = clean.index.to_series().groupby(grouper).max()
    grouped: pd.Series = clean.groupby(grouper).last().astype("float64")
    valid = ~last_obs.isna()
    grouped = grouped[valid.to_numpy()]
    grouped.index = pd.DatetimeIndex(last_obs[valid].to_numpy())
    grouped.index.name = source.index.name
    return grouped
