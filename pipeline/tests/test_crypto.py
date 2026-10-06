import json

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
