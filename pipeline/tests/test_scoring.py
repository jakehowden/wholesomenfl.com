import pytest

from pipeline.schema import validate
from pipeline.scoring import score, score_xfp

SCORING = {
    "pass_yd": 0.04, "pass_td": 6.0, "pass_int": -2.0, "pass_fd": 0.25,
    "rec": 0.5, "rec_yd": 0.1, "rec_td": 6.0, "rec_fd": 0.5,
    "rush_yd": 0.1, "rush_td": 6.0, "rush_fd": 0.5,
    "bonus_rec_te": 0.5,
}


def test_score_six_point_pass_td():
    stats = {"pass_yd": 300, "pass_td": 3, "pass_int": 1, "pts_ppr": 99.9, "gp": 1}
    # 12 + 18 - 2; keys not in scoring (pts_ppr, gp) are ignored
    assert score(stats, SCORING) == 28.0


def test_score_rounds_to_2dp():
    assert score({"pass_yd": 1.234}, SCORING) == 0.05


def test_score_xfp_mapping():
    row = {
        "position": "WR",
        "receptions_exp": 6.0, "rec_yards_gained_exp": 70.0, "rec_touchdown_exp": 0.5,
        "rec_first_down_exp": 3.0, "rush_yards_gained_exp": 5.0,
        "rec_two_point_conv_exp": 1.0,  # rec_2pt not in SCORING -> ignored
        "total_fantasy_points_exp": 999.0,
    }
    # 3 + 7 + 3 + 1.5 + 0.5
    assert score_xfp(row, SCORING) == 15.0


def test_score_xfp_te_bonus_and_pass():
    row = {"position": "TE", "receptions_exp": 4.0, "rec_yards_gained_exp": 40.0}
    assert score_xfp(row, SCORING) == 2 + 4 + 2  # rec + yd + TE bonus
    qb = {"position": "QB", "pass_yards_gained_exp": 250.0, "pass_touchdown_exp": 2.0,
          "pass_interception_exp": 1.0, "pass_first_down_exp": 12.0}
    assert score_xfp(qb, SCORING) == 10 + 12 - 2 + 3


def test_score_xfp_pandas_row():
    pd = pytest.importorskip("pandas")
    row = pd.Series({"position": "TE", "receptions_exp": 4.0, "rec_yards_gained_exp": float("nan")})
    assert score_xfp(row, SCORING) == 4.0


def test_validate_meta():
    meta = {"generated_at": "x", "season": "2026", "week": 5, "league_id": "1",
            "my_roster_id": 3, "sources": {"a": "b"}, "llm_generated_at": None}
    validate("meta", meta)
    with pytest.raises(KeyError):
        validate("meta", {k: v for k, v in meta.items() if k != "week"})
    with pytest.raises(TypeError):
        validate("meta", {**meta, "week": "5"})
