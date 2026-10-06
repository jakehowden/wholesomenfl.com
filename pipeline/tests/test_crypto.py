import json
from pathlib import Path

import pytest
from cryptography.exceptions import InvalidTag

from pipeline.crypto import decrypt_json, encrypt_json

OBJ = {"week": 5, "situation": "3-1, chasing the 2 seed", "moves": [{"kind": "hold", "player_ids": ["1"]}]}


def test_round_trip():
    blob = encrypt_json(OBJ, "correct horse")
    env = json.loads(blob)
    assert set(env) == {"salt", "iv", "ct"}
    assert "chasing" not in blob
    assert decrypt_json(blob, "correct horse") == OBJ


def test_fresh_salt_and_iv():
    a, b = json.loads(encrypt_json(OBJ, "p")), json.loads(encrypt_json(OBJ, "p"))
    assert a["salt"] != b["salt"] and a["iv"] != b["iv"]


def test_wrong_passphrase_raises():
    blob = encrypt_json(OBJ, "correct horse")
    with pytest.raises(InvalidTag):
        decrypt_json(blob, "battery staple")


FIXTURES = Path(__file__).parent / "fixtures"
BRIEF = {"week": 5, "generated_at": "2026-10-06T14:00:00+00:00", "situation": "3-1, chasing the 2 seed",
         "moves": [{"kind": "hold", "title": "Hold", "detail": "Stay put", "player_ids": ["4046"]}],
         "reasoning": "Because."}


@pytest.mark.parametrize("name", ["briefing_ts.json", "briefing_py.json"])
def test_decrypts_shared_fixtures(name):
    """briefing_ts.json was encrypted with Web Crypto; web/src/lib/crypto.test.ts decrypts both as well."""
    assert decrypt_json((FIXTURES / name).read_text(encoding="utf-8"), "correct horse") == BRIEF
