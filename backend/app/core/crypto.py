import base64
import hashlib
import os

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from app.config import settings

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


def _static_key() -> bytes:
    """Server-side key derived from settings.secret_key, for at-rest secrets that
    must be decrypted without any user-supplied password (e.g. integration API keys)."""
    return hashlib.sha256(settings.secret_key.encode("utf-8")).digest()


def encrypt_secret(plaintext: str) -> str:
    """Encrypt with AES-256-GCM using the server's static key. Output: base64(nonce || ciphertext+tag)."""
    nonce = os.urandom(_NONCE_LEN)
    ciphertext = AESGCM(_static_key()).encrypt(nonce, plaintext.encode("utf-8"), None)
    return base64.b64encode(nonce + ciphertext).decode("ascii")


def decrypt_secret(token: str) -> str:
    raw = base64.b64decode(token)
    nonce, ciphertext = raw[:_NONCE_LEN], raw[_NONCE_LEN:]
    return AESGCM(_static_key()).decrypt(nonce, ciphertext, None).decode("utf-8")
