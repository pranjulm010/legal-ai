from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from cryptography.fernet import Fernet, InvalidToken


def _fernet() -> Fernet:
    key = getattr(settings, "AI_CREDENTIAL_ENCRYPTION_KEY", None)
    if not key:
        raise ImproperlyConfigured(
            "AI_CREDENTIAL_ENCRYPTION_KEY is not set - required to store BYOK AI "
            "provider credentials. Generate one with: python -c \"from "
            "cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\" "
            "and set it in .env."
        )
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt_secret(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_secret(ciphertext: str) -> str:
    try:
        return _fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken:
        raise ValueError("Stored credential could not be decrypted - it may be corrupted.")
