"""Optimal lineup solver, ported from app.js optimalLineup()/startingSlots()/SLOT_ELIGIBILITY."""
from __future__ import annotations

from typing import Callable, Iterable

SLOT_ELIGIBILITY = {
    "QB": ["QB"],
    "RB": ["RB"],
    "WR": ["WR"],
    "TE": ["TE"],
    "K": ["K"],
    "DEF": ["DEF"],
    "DL": ["DL"],
    "LB": ["LB"],
    "DB": ["DB"],
    "FLEX": ["RB", "WR", "TE"],
    "WRRB_FLEX": ["RB", "WR"],
    "REC_FLEX": ["WR", "TE"],
    "WRRB_WRT": ["RB", "WR", "TE"],
    "SUPER_FLEX": ["QB", "RB", "WR", "TE"],
    "IDP_FLEX": ["DL", "LB", "DB"],
}
BENCH_SLOTS = ("BN", "IR", "TAXI")


def starting_slots(roster_positions: Iterable[str]) -> list[str]:
    return [s for s in roster_positions if s not in BENCH_SLOTS]


def optimal_lineup(ids: Iterable[str], value: Callable[[str], float], pos: Callable[[str], str | None],
                   slots: list[str]) -> tuple[float, list[str | None]]:
    """Greedy fill, narrowest slots first (then FLEX, then SUPER_FLEX). Returns (total, player id per slot)."""
    ids = list(ids)
    order = sorted(range(len(slots)), key=lambda i: (len(SLOT_ELIGIBILITY.get(slots[i], [])), i))
    used: set[str] = set()
    assigned: list[str | None] = [None] * len(slots)
    total = 0.0
    for i in order:
        elig = SLOT_ELIGIBILITY.get(slots[i], [])
        best, best_v = None, float("-inf")
        for pid in ids:
            if pid in used or pos(pid) not in elig:
                continue
            v = value(pid)
            if v > best_v:
                best, best_v = pid, v
        if best is not None:
            used.add(best)
            total += best_v
        assigned[i] = best
    return round(total, 2), assigned
