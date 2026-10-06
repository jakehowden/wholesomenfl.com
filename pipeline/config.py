from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

LEAGUE_ID = "1383485349862338560"
PREV_LEAGUE_ID = "1241014401570459648"
MY_USERNAME = "jsh96"
SEASON = "2026"

OUT_DIR = ROOT / "web" / "public" / "data"
HISTORY_DIR = ROOT / "data" / "history"
CACHE_DIR = ROOT / ".cache"

FANTASY_POS = ("QB", "RB", "WR", "TE", "K", "DEF")

# Value model (phase 03)
MARKET_W = 0.85
XFP_W = 0.15
XFP_WINDOW = 4
CALIB = {"QB": .67, "RB": .80, "WR": .85, "TE": .80, "K": 1.0, "DEF": 1.0}
AVAIL = {"Out": 0, "IR": 0, "PUP": 0, "Sus": 0, "Doubtful": .3, "Questionable": .85}
PLAYOFF_WEEKS = (15, 16, 17)
PLAYOFF_WT = 1.5
LAST_WEEK = 17
SIM_RUNS = 10000
SIM_SD = 22.0
LLM_OUTLOOK_CAP = 80
