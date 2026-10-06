"""League scoring. Mirrors app.js score(): sum(scoring[k] * stats[k]), rounded to 2dp."""

XFP_MAP = {
    "pass_yards_gained_exp": "pass_yd",
    "pass_touchdown_exp": "pass_td",
    "pass_interception_exp": "pass_int",
    "pass_two_point_conv_exp": "pass_2pt",
    "receptions_exp": "rec",
    "rec_yards_gained_exp": "rec_yd",
    "rec_touchdown_exp": "rec_td",
    "rec_two_point_conv_exp": "rec_2pt",
    "rush_yards_gained_exp": "rush_yd",
    "rush_touchdown_exp": "rush_td",
    "rush_two_point_conv_exp": "rush_2pt",
    "pass_first_down_exp": "pass_fd",
    "rec_first_down_exp": "rec_fd",
    "rush_first_down_exp": "rush_fd",
}

REC_BONUS = {"TE": "bonus_rec_te", "WR": "bonus_rec_wr", "RB": "bonus_rec_rb"}


def _num(v) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0.0
    return 0.0 if f != f else f  # NaN -> 0


def score(stats: dict, scoring: dict) -> float:
    total = 0.0
    for k, v in stats.items():
        w = scoring.get(k)
        if isinstance(w, (int, float)) and not isinstance(w, bool):
            total += w * _num(v)
    return round(total, 2)


def score_xfp(row, scoring: dict) -> float:
    """Expected fantasy points for one ffopportunity row (dict or pandas Series) in league scoring."""
    stats = {}
    for col, key in XFP_MAP.items():
        if key in scoring and col in row:
            stats[key] = _num(row[col])
    bonus = REC_BONUS.get(str(row.get("position") or ""))
    if bonus and bonus in scoring and "receptions_exp" in row:
        stats[bonus] = _num(row["receptions_exp"])
    return score(stats, scoring)
