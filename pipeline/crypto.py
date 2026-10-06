"""AES-GCM-256 envelope for private/briefing.enc (decryptable in the browser with WebCrypto).

Format: JSON {salt, iv, ct}, each base64. key = PBKDF2-HMAC-SHA256(passphrase, salt, 250000), 32 bytes.
ct is the AES-GCM ciphertext with the 16-byte tag appended (what WebCrypto expects).
"""
from __future__ import annotations

import base64
import json
import os

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ITERATIONS = 250_000


def _key(passphrase: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITERATIONS)
    return kdf.derive(passphrase.encode("utf-8"))


def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode("ascii")


def encrypt_json(obj, passphrase: str) -> str:
    salt, iv = os.urandom(16), os.urandom(12)
    ct = AESGCM(_key(passphrase, salt)).encrypt(iv, json.dumps(obj).encode("utf-8"), None)
    return json.dumps({"salt": _b64(salt), "iv": _b64(iv), "ct": _b64(ct)})


def decrypt_json(blob: str, passphrase: str):
    """Inverse of encrypt_json. Raises cryptography.exceptions.InvalidTag on a wrong passphrase."""
    env = json.loads(blob)
    salt, iv, ct = (base64.b64decode(env[k]) for k in ("salt", "iv", "ct"))
    return json.loads(AESGCM(_key(passphrase, salt)).decrypt(iv, ct, None))
