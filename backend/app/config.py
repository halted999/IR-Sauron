from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/ir_sauron"
    redis_url: str = "redis://localhost:6379/0"

    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_bucket: str = "ir-artifacts"
    minio_secure: bool = False

    secret_key: str = "change-me-in-production-use-long-random-string"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60
    refresh_expire_days: int = 7

    cors_origins: List[str] = ["http://localhost:3000", "http://localhost:5173"]

    # Directory backend writes the uploaded TLS cert/key pair to (cert.pem /
    # key.pem). Shared with the nginx container via the `ssl_certs` volume —
    # nginx watches it for changes and reloads itself. See nginx/entrypoint.sh.
    ssl_cert_dir: str = "/data/ssl"

    debug: bool = False

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
