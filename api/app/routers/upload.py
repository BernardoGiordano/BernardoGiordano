from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from .. import config, media
from ..auth import require_writer

router = APIRouter(prefix="/api/media", tags=["media"])


@router.post("", status_code=201)
def upload(file: UploadFile = File(...), purpose: str = Form(default="post"), _=Depends(require_writer)):
    raw = file.file.read(config.UPLOAD_MAX_BYTES + 1)
    if len(raw) > config.UPLOAD_MAX_BYTES:
        raise HTTPException(status_code=413, detail="too_large")
    try:
        return media.store(raw, purpose, file.filename or "upload")
    except media.RejectedImage as cause:
        raise HTTPException(status_code=415, detail=str(cause)) from cause
