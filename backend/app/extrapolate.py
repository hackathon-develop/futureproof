"""Deterministic trend extrapolation (linear vs log-linear, pick lower RMSE)."""
import math
from datetime import datetime

import numpy as np

from .schemas import ProjectedPoint, Series, SeriesPoint


def clean_points(points: list[SeriesPoint]) -> list[SeriesPoint]:
    by_year: dict[int, list[SeriesPoint]] = {}
    for p in points:
        if p.value is None or not math.isfinite(p.value):
            continue
        by_year.setdefault(int(p.year), []).append(p)
    out = []
    for y in sorted(by_year):
        ps = by_year[y]
        out.append(SeriesPoint(year=y, value=float(np.mean([p.value for p in ps])), source_url=ps[0].source_url))
    return out


def _growth_projection(series: Series, horizon: int) -> Series:
    """One anchor point + stated annual growth rate -> compound projection."""
    base = series.historical[-1]
    g = series.annual_growth_pct / 100.0
    rel_sigma = max(0.02, abs(g) * 0.5)  # uncertainty grows with size of claimed change
    end_year = max(datetime.now().year, base.year) + horizon
    proj = []
    for k in range(1, end_year - base.year + 1):
        v = base.value * (1 + g) ** k
        band = 1.96 * rel_sigma * abs(v) * math.sqrt(k)
        low = max(0.0, v - band) if base.value >= 0 else v - band
        proj.append(ProjectedPoint(year=base.year + k, value=round(v, 4), low=round(low, 4), high=round(v + band, 4)))
    series.projected = proj
    series.method = f"growth-rate {series.annual_growth_pct:+.1f}%/yr"
    return series


def extrapolate(series: Series, horizon: int) -> Series:
    pts = clean_points(series.historical)
    series.historical = pts
    horizon = max(1, min(int(horizon or 5), 10))
    if len(pts) < 2 and not (len(pts) == 1 and series.annual_growth_pct is not None):
        return series
    if len(pts) == 1 or (len(pts) == 2 and series.annual_growth_pct is not None):
        return _growth_projection(series, horizon)
    x = np.array([p.year for p in pts], dtype=float)
    y = np.array([p.value for p in pts], dtype=float)

    lin = np.polyfit(x, y, 1)
    lin_pred = np.polyval(lin, x)
    lin_rmse = float(np.sqrt(np.mean((y - lin_pred) ** 2)))
    method, rmse, model = "linear", lin_rmse, ("lin", lin)

    if np.all(y > 0):
        lg = np.polyfit(x, np.log(y), 1)
        lg_pred = np.exp(np.polyval(lg, x))
        lg_rmse = float(np.sqrt(np.mean((y - lg_pred) ** 2)))
        if lg_rmse < lin_rmse:
            method, rmse, model = "loglinear", lg_rmse, ("log", lg)

    sigma = max(rmse, 0.03 * float(np.mean(np.abs(y))))
    last = int(x[-1])
    proj = []
    for k in range(1, horizon + 1):
        yr = last + k
        v = float(np.polyval(model[1], yr))
        if model[0] == "log":
            v = math.exp(v)
        band = 1.96 * sigma * math.sqrt(k)
        low = v - band
        if np.all(y >= 0):
            low = max(0.0, low)
        proj.append(ProjectedPoint(year=yr, value=round(v, 4), low=round(low, 4), high=round(v + band, 4)))
    series.projected = proj
    series.method = method
    return series
