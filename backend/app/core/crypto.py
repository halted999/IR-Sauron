import os

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

_SALT_LEN = 16
_NONCE_LEN = 12
_KDF_ITERATIONS = 390_000


def _derive_key(password: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=_KDF_ITERATIONS)
    return kdf.derive(password.encode("utf-8"))


def encrypt_bytes(password: str, plaintext: bytes) -> bytes:
    """Encrypt with AES-256-GCM using a PBKDF2-derived key. Output: salt || nonce || ciphertext+tag."""
    salt = os.urandom(_SALT_LEN)
    nonce = os.urandom(_NONCE_LEN)
    key = _derive_key(password, salt)
    ciphertext = AESGCM(key).encrypt(nonce, plaintext, None)
    return salt + nonce + ciphertext


def decrypt_bytes(password: str, blob: bytes) -> bytes:
    salt, nonce, ciphertext = (
        blob[:_SALT_LEN],
        blob[_SALT_LEN:_SALT_LEN + _NONCE_LEN],
        blob[_SALT_LEN + _NONCE_LEN:],
    )
    key = _derive_key(password, salt)
    return AESGCM(key).decrypt(nonce, ciphertext, None)
