import re

from fastapi import APIRouter, Depends, HTTPException
from pymongo.errors import DuplicateKeyError

from app.db.mongo import users
from app.models.common import serialize_doc, utcnow
from app.models.user import TokenResponse, UserCreate, UserLogin, UserPublic
from app.services.auth import create_access_token, get_current_user, hash_password, verify_password

router = APIRouter()

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _to_public(doc: dict) -> UserPublic:
    out = serialize_doc(doc)
    return UserPublic(
        id=out["id"], name=out["name"], email=out["email"], createdAt=out["createdAt"].isoformat()
    )


@router.post("/signup", response_model=TokenResponse)
async def signup(body: UserCreate):
    name = body.name.strip()
    email = body.email.strip().lower()
    if not name:
        raise HTTPException(400, "Name is required")
    if not _EMAIL_RE.match(email):
        raise HTTPException(400, "Invalid email address")
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")

    doc = {
        "name": name,
        "email": email,
        "passwordHash": hash_password(body.password),
        "createdAt": utcnow(),
    }
    try:
        result = await users.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(409, "An account with this email already exists")
    doc["_id"] = result.inserted_id

    token = create_access_token(str(doc["_id"]))
    return TokenResponse(accessToken=token, user=_to_public(doc))


@router.post("/login", response_model=TokenResponse)
async def login(body: UserLogin):
    email = body.email.strip().lower()
    doc = await users.find_one({"email": email})
    if not doc or not verify_password(body.password, doc["passwordHash"]):
        raise HTTPException(401, "Invalid email or password")

    token = create_access_token(str(doc["_id"]))
    return TokenResponse(accessToken=token, user=_to_public(doc))


@router.get("/me", response_model=UserPublic)
async def me(current_user: dict = Depends(get_current_user)):
    return _to_public(current_user)
