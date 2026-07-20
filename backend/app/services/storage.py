import asyncio
import functools
import hashlib
import io
import uuid
from datetime import timedelta
from typing import Tuple

from minio import Minio
from minio.error import S3Error

from app.config import settings


class StorageService:
    """MinIO-backed object storage service."""

    def __init__(self) -> None:
        self._client = Minio(
            endpoint=settings.minio_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=settings.minio_secure,
        )
        self._bucket = settings.minio_bucket

    def _ensure_bucket(self) -> None:
        """Create bucket if it does not exist (called synchronously at startup)."""
        if not self._client.bucket_exists(self._bucket):
            self._client.make_bucket(self._bucket)

    def _build_object_name(self, filename: str) -> str:
        """Generate a unique, deterministic object name under a UUID prefix."""
        prefix = str(uuid.uuid4())
        # Sanitise the filename so it is safe as an object key
        safe_name = filename.replace(" ", "_")
        return f"artifacts/{prefix}/{safe_name}"

    def _upload_sync(
        self, object_name: str, file_data: bytes, content_type: str, sha256_hex: str
    ) -> None:
        self._client.put_object(
            bucket_name=self._bucket,
            object_name=object_name,
            data=io.BytesIO(file_data),
            length=len(file_data),
            content_type=content_type,
            metadata={"x-amz-meta-sha256": sha256_hex},
        )

    async def upload_file(
        self,
        file_data: bytes,
        filename: str,
        content_type: str = "application/octet-stream",
    ) -> Tuple[str, str, int]:
        sha256_hex = hashlib.sha256(file_data).hexdigest()
        file_size = len(file_data)
        object_name = self._build_object_name(filename)
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None, self._upload_sync, object_name, file_data, content_type, sha256_hex
        )
        return object_name, sha256_hex, file_size

    async def get_presigned_url(
        self,
        storage_path: str,
        expires: int = 3600,
    ) -> str:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            functools.partial(
                self._client.presigned_get_object,
                bucket_name=self._bucket,
                object_name=storage_path,
                expires=timedelta(seconds=expires),
            ),
        )

    async def delete_file(self, storage_path: str) -> None:
        loop = asyncio.get_event_loop()
        try:
            await loop.run_in_executor(
                None,
                functools.partial(
                    self._client.remove_object,
                    bucket_name=self._bucket,
                    object_name=storage_path,
                ),
            )
        except S3Error as exc:
            if exc.code != "NoSuchKey":
                raise

    def _verify_integrity_sync(self, storage_path: str, expected_sha256: str) -> bool:
        try:
            response = self._client.get_object(
                bucket_name=self._bucket,
                object_name=storage_path,
            )
            hasher = hashlib.sha256()
            try:
                for chunk in response.stream(amt=65536):
                    hasher.update(chunk)
            finally:
                response.close()
                response.release_conn()
            return hasher.hexdigest() == expected_sha256
        except S3Error:
            return False

    async def verify_integrity(
        self,
        storage_path: str,
        expected_sha256: str,
    ) -> bool:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None, self._verify_integrity_sync, storage_path, expected_sha256
        )


# Singleton instance — imported by API routes
storage_service = StorageService()
