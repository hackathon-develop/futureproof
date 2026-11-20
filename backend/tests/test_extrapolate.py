from app.extrapolate import extrapolate
from app.schemas import Series, SeriesPoint


def test_linear_trend_projects_forward():
    pts = [SeriesPoint(year=y, value=100 + 10 * (y - 2018), source_url="u") for y in range(2018, 2024)]
    s = extrapolate(Series(id="x", metric="m", historical=pts), 3)
    assert [p.year for p in s.projected] == [2024, 2025, 2026]
    assert abs(s.projected[0].value - 160) < 1
    assert all(p.low <= p.value <= p.high for p in s.projected)


def test_single_point_without_growth_no_projection():
    pts = [SeriesPoint(year=2020, value=1, source_url="u")]
    assert extrapolate(Series(id="x", metric="m", historical=pts), 5).projected == []


def test_growth_rate_projection():
    pts = [SeriesPoint(year=2024, value=1000, source_url="u")]
    s = extrapolate(Series(id="x", metric="m", historical=pts, annual_growth_pct=-2.0), 5)
    assert s.projected and s.projected[0].year == 2025
    assert abs(s.projected[0].value - 980) < 0.01
    assert s.method.startswith("growth-rate")
