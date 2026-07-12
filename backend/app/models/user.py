from pydantic import BaseModel


class UserCreate(BaseModel):
    name: str
    email: str
    password: str


class UserLogin(BaseModel):
    email: str
    password: str


class UserPublic(BaseModel):
    id: str
    name: str
    email: str
    createdAt: str


class TokenResponse(BaseModel):
    accessToken: str
    tokenType: str = "bearer"
    user: UserPublic
