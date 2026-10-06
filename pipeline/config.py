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
# league-wide starters per position (SF/FLEX folded in): calibration pool and "startable" range for BUY
STARTERS = {"QB": 15, "RB": 35, "WR": 35, "TE": 12, "K": 10, "DEF": 10}
IR_WEEKS = 4                # IR zeroes weeks cur .. cur+IR_WEEKS-1
INJURY_WEEKS = 2            # other AVAIL statuses apply to cur and cur+1
REPL_FA_N = 3               # replacement = mean of the N best free agents
FA_KEEP = 300               # free agents kept in players.json (by ROS)
USAGE_STD_FLOOR = 0.03
TAG_USAGE_Z = 0.75
TAG_LUCK = 15.0
TAG_MARKET_GAP = 15
BREAKOUT_SNAP = 0.15
BREAKOUT_TS = 0.08
LAST_WEEK = 17
SIM_RUNS = 10000
SIM_SD = 22.0
