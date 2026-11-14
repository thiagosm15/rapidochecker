import asyncio
import random
from contextlib import suppress
from fastapi import FastAPI, APIRouter, Query, HTTPException, Depends
from fastapi.responses import HTMLResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import jwt
from jwt.exceptions import InvalidTokenError
from pwdlib import PasswordHash
from pymongo.errors import DuplicateKeyError
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING, IndexModel
from bson import ObjectId
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, BeforeValidator, ConfigDict, field_validator, EmailStr
from typing import List, Optional, Annotated, Literal
from datetime import datetime, timezone, timedelta


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]
JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = "HS256"
TOKEN_DAYS = 30  # drivers stay signed in on their phone; expired tokens -> 401 -> login again
passwords = PasswordHash.recommended()
bearer = HTTPBearer(auto_error=False)

INDEXES: dict[str, list[IndexModel]] = {
    "rides": [
        IndexModel([("user_id", ASCENDING), ("created_at", DESCENDING)], name="user_created"),
        IndexModel([("user_id", ASCENDING), ("accepted", ASCENDING), ("created_at", DESCENDING)], name="user_accepted_created"),
    ],
    "settings": [IndexModel([("user_id", ASCENDING)], name="user_id", unique=True)],
    "users": [IndexModel([("email", ASCENDING)], name="email", unique=True)],
    "login_attempts": [IndexModel([("email", ASCENDING), ("at", DESCENDING)], name="email_at")],
}


async def ensure_indexes() -> None:
    # Legacy single-user indexes (before login existed)
    for coll, name in (("settings", "key"), ("rides", "created_at_desc"), ("rides", "accepted_created")):
        with suppress(Exception):
            await db[coll].drop_index(name)
    for collection, models in INDEXES.items():
        for model in models:
            try:
                await db[collection].create_indexes([model])
            except Exception as exc:
                logging.getLogger(__name__).error("ensure_indexes(%s.%s): %s", collection, model.document["name"], exc)


app = FastAPI()


@app.get("/health", include_in_schema=False)
@app.head("/health", include_in_schema=False)
async def health():
    return {"status": "ok"}


api_router = APIRouter(prefix="/api")

# ---------- Mongo helpers ----------
PyObjectId = Annotated[str, BeforeValidator(lambda v: str(v) if isinstance(v, ObjectId) else v)]


class BaseDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: Optional[PyObjectId] = Field(default=None, alias="_id")

    @classmethod
    def from_mongo(cls, doc: dict):
        return cls.model_validate(doc)

    def to_mongo(self) -> dict:
        data = self.model_dump(by_alias=True, exclude={"id"})
        data.pop("_id", None)
        return data

    def to_api(self) -> dict:
        return self.model_dump(by_alias=False)


# ---------- Models ----------
class Settings(BaseDocument):
    user_id: str
    auto_accept: bool = False
    min_price_per_km: float = 2.0
    min_fare: float = 8.0
    max_pickup_km: float = 4.0
    accept_texts: List[str] = ["Aceitar", "Aceitar corrida", "Accept"]
    target_package: str = "rapido"
    # 99 sync: go offline on RapidoCar while a 99 ride is in progress
    sync_99_enabled: bool = False
    ninety_nine_package: str = "app99"
    ride_active_texts: List[str] = ["Iniciar corrida", "Finalizar corrida", "Cheguei ao local", "A caminho do passageiro"]
    ride_end_texts: List[str] = ["Corrida finalizada", "Avaliar passageiro", "Avalie o passageiro"]
    offline_texts: List[str] = ["Ficar offline", "Desconectar", "Ficar indisponível"]
    online_texts: List[str] = ["Ficar online", "Conectar", "Ficar disponível"]
    # Working hours (days: 0=Sunday..6=Saturday; times HH:MM, may cross midnight)
    schedule_enabled: bool = False
    schedule_start: str = "06:00"
    schedule_end: str = "22:00"
    schedule_days: List[int] = [0, 1, 2, 3, 4, 5, 6]
    # Sound + vibration when a ride is auto-accepted
    alert_enabled: bool = True


TEXT_LIST_FIELDS = ["accept_texts", "ride_active_texts", "ride_end_texts", "offline_texts", "online_texts"]


class SettingsUpdate(BaseModel):
    auto_accept: Optional[bool] = None
    min_price_per_km: Optional[float] = Field(default=None, ge=0)
    min_fare: Optional[float] = Field(default=None, ge=0)
    max_pickup_km: Optional[float] = Field(default=None, ge=0)
    accept_texts: Optional[List[str]] = None
    target_package: Optional[str] = None
    sync_99_enabled: Optional[bool] = None
    ninety_nine_package: Optional[str] = None
    ride_active_texts: Optional[List[str]] = None
    ride_end_texts: Optional[List[str]] = None
    offline_texts: Optional[List[str]] = None
    online_texts: Optional[List[str]] = None
    schedule_enabled: Optional[bool] = None
    schedule_start: Optional[str] = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    schedule_end: Optional[str] = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    schedule_days: Optional[List[Annotated[int, Field(ge=0, le=6)]]] = None
    alert_enabled: Optional[bool] = None


class Ride(BaseDocument):
    user_id: Optional[str] = None
    price: float
    trip_km: float
    pickup_km: float = 0
    price_per_km: float
    accepted: bool
    reasons: List[str] = []
    source: Literal["simulador", "rapidocar"] = "simulador"
    pickup: Optional[str] = None
    dropoff: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class RideIn(BaseModel):
    price: float
    trip_km: float
    pickup_km: float = 0
    price_per_km: Optional[float] = None
    accepted: bool
    reasons: List[str] = []
    source: Literal["simulador", "rapidocar"] = "rapidocar"
    created_at: Optional[str] = None

    @field_validator("created_at")
    @classmethod
    def _valid_date(cls, v):
        if v is not None:
            datetime.fromisoformat(v.replace("Z", "+00:00"))
        return v


class User(BaseDocument):
    email: str
    name: str = ""
    password_hash: str
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def public(self) -> dict:
        return {"id": self.id, "email": self.email, "name": self.name}


class RegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


def issue_token(user_id: str) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode({"sub": user_id, "iat": now, "exp": now + timedelta(days=TOKEN_DAYS)}, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def current_user(credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(bearer)]) -> User:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Faça login para continuar")
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        uid = payload.get("sub")
        if not uid or not ObjectId.is_valid(uid):
            raise InvalidTokenError("bad subject")
    except InvalidTokenError:
        raise HTTPException(status_code=401, detail="Sessão expirada. Entre novamente.")
    doc = await db.users.find_one({"_id": ObjectId(uid)})
    if not doc:
        raise HTTPException(status_code=401, detail="Usuário não encontrado")
    return User.from_mongo(doc)


CurrentUser = Annotated[User, Depends(current_user)]


async def get_settings(uid: str) -> Settings:
    doc = await db.settings.find_one({"user_id": uid})
    if doc:
        return Settings.from_mongo(doc)
    s = Settings(user_id=uid)
    await db.settings.update_one({"user_id": uid}, {"$setOnInsert": s.to_mongo()}, upsert=True)
    return Settings.from_mongo(await db.settings.find_one({"user_id": uid}))


def to_utc_iso(value: str) -> str:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def evaluate(price: float, trip_km: float, pickup_km: float, s: Settings) -> tuple[float, list[str]]:
    ppk = round(price / trip_km, 2) if trip_km > 0 else 0.0
    reasons = []
    if ppk < s.min_price_per_km:
        reasons.append("R$/km abaixo do mínimo")
    if price < s.min_fare:
        reasons.append("Valor abaixo do mínimo")
    if pickup_km > s.max_pickup_km:
        reasons.append("Busca muito longe")
    return ppk, reasons


# ---------- Routes ----------
@api_router.get("/")
async def root():
    return {"message": "AutoCorrida API"}


@api_router.post("/auth/register", status_code=201)
async def register(body: RegisterIn):
    email = body.email.lower()
    first_user = await db.users.count_documents({}, limit=1) == 0
    user = User(email=email, name=body.name.strip(), password_hash=passwords.hash(body.password))
    try:
        res = await db.users.insert_one(user.to_mongo())
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Este e-mail já está cadastrado")
    uid = str(res.inserted_id)
    user.id = uid
    if first_user:
        # Data created before login existed belongs to the first driver.
        await db.rides.update_many({"user_id": {"$exists": False}}, {"$set": {"user_id": uid}})
        await db.settings.update_one({"key": "default", "user_id": {"$exists": False}},
                                     {"$set": {"user_id": uid}, "$unset": {"key": ""}})
    return {"access_token": issue_token(uid), "token_type": "bearer", "user": user.public()}


@api_router.post("/auth/login")
async def login(body: LoginIn):
    email = body.email.lower()
    window_start = (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat()
    fails = await db.login_attempts.count_documents({"email": email, "at": {"$gte": window_start}})
    if fails >= 5:
        raise HTTPException(status_code=429, detail="Muitas tentativas. Aguarde 15 minutos e tente de novo.")
    doc = await db.users.find_one({"email": email})
    if not doc or not passwords.verify(body.password, doc["password_hash"]):
        await db.login_attempts.insert_one({"email": email, "at": datetime.now(timezone.utc).isoformat()})
        raise HTTPException(status_code=401, detail="E-mail ou senha incorretos")
    await db.login_attempts.delete_many({"email": email})
    user = User.from_mongo(doc)
    return {"access_token": issue_token(user.id), "token_type": "bearer", "user": user.public()}


@api_router.get("/auth/me")
async def me(user: CurrentUser):
    return user.public()


@api_router.get("/settings")
async def read_settings(user: CurrentUser):
    return (await get_settings(user.id)).to_api()


@api_router.put("/settings")
async def update_settings(body: SettingsUpdate, user: CurrentUser):
    await get_settings(user.id)
    changes = body.model_dump(exclude_none=True)
    for f in TEXT_LIST_FIELDS:
        if f in changes:
            changes[f] = [t.strip() for t in changes[f] if t.strip()]
    if changes:
        await db.settings.update_one({"user_id": user.id}, {"$set": changes})
    return (await get_settings(user.id)).to_api()


PLACES = ["Av. Paulista", "Pinheiros", "Vila Madalena", "Moema", "Centro", "Tatuapé", "Santana",
          "Itaim Bibi", "Brooklin", "Lapa", "Mooca", "Butantã", "Aeroporto Congonhas", "Liberdade"]


def in_schedule(s: Settings, local: datetime) -> bool:
    if not s.schedule_enabled:
        return True
    day = (local.weekday() + 1) % 7  # Python Monday=0 -> Sunday=0
    if day not in s.schedule_days:
        return False
    to_min = lambda t: int(t[:2]) * 60 + int(t[3:5])
    m = local.hour * 60 + local.minute
    start, end = to_min(s.schedule_start), to_min(s.schedule_end)
    return start <= m < end if start <= end else (m >= start or m < end)


@api_router.post("/simulate")
async def simulate(user: CurrentUser, tz: int = Query(0, ge=-840, le=840)):
    s = await get_settings(user.id)
    trip_km = round(random.uniform(1.5, 25), 1)
    price = round(trip_km * random.uniform(1.1, 3.4) + random.uniform(2, 5), 2)
    pickup_km = round(random.uniform(0.3, 7), 1)
    ppk, reasons = evaluate(price, trip_km, pickup_km, s)
    if not in_schedule(s, datetime.now(timezone.utc) + timedelta(minutes=tz)):
        reasons.append("Fora do horário de trabalho")
    a, b = random.sample(PLACES, 2)
    ride = Ride(user_id=user.id, price=price, trip_km=trip_km, pickup_km=pickup_km, price_per_km=ppk,
                accepted=not reasons, reasons=reasons, source="simulador", pickup=a, dropoff=b)
    res = await db.rides.insert_one(ride.to_mongo())
    ride.id = str(res.inserted_id)
    return ride.to_api()


@api_router.post("/rides/bulk")
async def add_rides(items: List[RideIn], user: CurrentUser):
    docs = []
    for r in items:
        ppk = r.price_per_km if r.price_per_km is not None else (round(r.price / r.trip_km, 2) if r.trip_km > 0 else 0)
        ride = Ride(user_id=user.id, price=r.price, trip_km=r.trip_km, pickup_km=r.pickup_km, price_per_km=ppk,
                    accepted=r.accepted, reasons=r.reasons, source=r.source,
                    created_at=to_utc_iso(r.created_at) if r.created_at else datetime.now(timezone.utc).isoformat())
        docs.append(ride.to_mongo())
    if docs:
        await db.rides.insert_many(docs)
    return {"inserted": len(docs)}


@api_router.get("/rides")
async def list_rides(user: CurrentUser, status: Literal["all", "accepted", "rejected"] = "all", limit: int = Query(100, ge=1, le=500)):
    q: dict = {"user_id": user.id}
    if status != "all":
        q["accepted"] = status == "accepted"
    docs = await db.rides.find(q).sort("created_at", -1).limit(limit).to_list(limit)
    return [Ride.from_mongo(d).to_api() for d in docs]


@api_router.delete("/rides")
async def clear_rides(user: CurrentUser):
    res = await db.rides.delete_many({"user_id": user.id})
    return {"deleted": res.deleted_count}


@api_router.get("/stats")
async def stats(user: CurrentUser, since: Optional[str] = None):
    if since:
        try:
            start = to_utc_iso(since)
        except ValueError:
            raise HTTPException(status_code=422, detail="Parâmetro 'since' inválido")
    else:
        start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    docs = await db.rides.find({"user_id": user.id, "created_at": {"$gte": start}}, {"price": 1, "accepted": 1}).to_list(5000)
    total = len(docs)
    accepted = [d for d in docs if d.get("accepted")]
    return {
        "today_earnings": round(sum(d["price"] for d in accepted), 2),
        "today_total": total,
        "today_accepted": len(accepted),
        "accept_rate": round(len(accepted) * 100 / total, 1) if total else 0,
    }


WEEKDAYS_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]


@api_router.get("/stats/weekly")
async def stats_weekly(user: CurrentUser, tz: int = Query(0, ge=-840, le=840)):
    """Last 7 local days (tz = minutes offset from UTC, e.g. -180 for Brasília)."""
    now_local = datetime.now(timezone.utc) + timedelta(minutes=tz)
    first_day = (now_local - timedelta(days=6)).date()
    start_utc = datetime(first_day.year, first_day.month, first_day.day, tzinfo=timezone.utc) - timedelta(minutes=tz)
    docs = await db.rides.find({"user_id": user.id, "created_at": {"$gte": start_utc.isoformat()}}, {"price": 1, "accepted": 1, "created_at": 1}).to_list(20000)
    days = []
    for i in range(7):
        d = first_day + timedelta(days=i)
        days.append({"date": d.isoformat(), "label": WEEKDAYS_PT[(d.weekday() + 1) % 7], "earnings": 0.0, "accepted": 0, "total": 0})
    for doc in docs:
        local = datetime.fromisoformat(doc["created_at"]) + timedelta(minutes=tz)
        idx = (local.date() - first_day).days
        if 0 <= idx < 7:
            days[idx]["total"] += 1
            if doc.get("accepted"):
                days[idx]["accepted"] += 1
                days[idx]["earnings"] = round(days[idx]["earnings"] + doc["price"], 2)
    for d in days:
        d["accept_rate"] = round(d["accepted"] * 100 / d["total"], 1) if d["total"] else 0
    return {
        "days": days,
        "week_earnings": round(sum(d["earnings"] for d in days), 2),
        "week_accepted": sum(d["accepted"] for d in days),
        "week_total": sum(d["total"] for d in days),
    }


MONTHS_PT = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto",
             "Setembro", "Outubro", "Novembro", "Dezembro"]


@api_router.get("/stats/monthly")
async def stats_monthly(user: CurrentUser, tz: int = Query(0, ge=-840, le=840),
                        month: Optional[str] = Query(None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$")):
    """Month report (local time). month = YYYY-MM, default current month."""
    now_local = datetime.now(timezone.utc) + timedelta(minutes=tz)
    year, mon = (int(month[:4]), int(month[5:])) if month else (now_local.year, now_local.month)
    start_local = datetime(year, mon, 1, tzinfo=timezone.utc)
    end_local = datetime(year + (mon == 12), mon % 12 + 1, 1, tzinfo=timezone.utc)
    start_utc, end_utc = start_local - timedelta(minutes=tz), end_local - timedelta(minutes=tz)
    docs = await db.rides.find(
        {"user_id": user.id, "created_at": {"$gte": start_utc.isoformat(), "$lt": end_utc.isoformat()}},
        {"price": 1, "accepted": 1, "created_at": 1, "trip_km": 1, "price_per_km": 1, "reasons": 1},
    ).to_list(50000)

    hours = [{"hour": h, "earnings": 0.0, "accepted": 0, "total": 0} for h in range(24)]
    weekdays = [{"day": i, "label": WEEKDAYS_PT[i], "earnings": 0.0, "accepted": 0, "total": 0} for i in range(7)]
    reasons: dict[str, int] = {}
    accepted = []
    active_days = set()
    for d in docs:
        local = datetime.fromisoformat(d["created_at"]) + timedelta(minutes=tz)
        wd = (local.weekday() + 1) % 7
        for bucket in (hours[local.hour], weekdays[wd]):
            bucket["total"] += 1
        if d.get("accepted"):
            accepted.append(d)
            active_days.add(local.date())
            for bucket in (hours[local.hour], weekdays[wd]):
                bucket["accepted"] += 1
                bucket["earnings"] = round(bucket["earnings"] + d["price"], 2)
        for r in d.get("reasons", []):
            reasons[r] = reasons.get(r, 0) + 1

    earnings = round(sum(d["price"] for d in accepted), 2)
    km = round(sum(d.get("trip_km", 0) for d in accepted), 1)
    best_hours = sorted([h for h in hours if h["earnings"] > 0], key=lambda h: -h["earnings"])[:3]
    best_days = sorted([w for w in weekdays if w["earnings"] > 0], key=lambda w: -w["earnings"])[:3]
    return {
        "month": f"{year:04d}-{mon:02d}",
        "label": f"{MONTHS_PT[mon - 1]} {year}",
        "earnings": earnings,
        "accepted": len(accepted),
        "total": len(docs),
        "accept_rate": round(len(accepted) * 100 / len(docs), 1) if docs else 0,
        "km": km,
        "avg_price_per_km": round(earnings / km, 2) if km else 0,
        "avg_ride": round(earnings / len(accepted), 2) if accepted else 0,
        "active_days": len(active_days),
        "avg_per_day": round(earnings / len(active_days), 2) if active_days else 0,
        "best_hours": best_hours,
        "best_days": best_days,
        "hours": hours,
        "rejection_reasons": [{"reason": k, "count": v} for k, v in sorted(reasons.items(), key=lambda x: -x[1])],
    }


PRIVACY_HTML = """<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>AutoCorrida - Política de Privacidade</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:0 auto;padding:24px;line-height:1.6;color:#111}
h1{font-size:26px}h2{font-size:18px;margin-top:28px}</style></head><body>
<h1>Política de Privacidade - AutoCorrida</h1><p>Última atualização: junho de 2026</p>
<h2>1. O que o app faz</h2><p>O AutoCorrida ajuda motoristas a aceitar automaticamente ofertas de corrida do RapidoCar
que atendem aos filtros definidos pelo próprio motorista (preço por km, valor mínimo, distância e horário), e a ficar
offline no RapidoCar durante corridas da 99.</p>
<h2>2. Uso do Serviço de Acessibilidade (Android)</h2><p>Com a sua permissão, o app usa a API de Acessibilidade do Android
para <b>ler os textos exibidos</b> nas telas do RapidoCar e da 99 (por exemplo: valor da corrida, distâncias e nomes de botões)
e para <b>tocar nos botões</b> "Aceitar", "Ficar offline" e "Ficar online" em seu nome. O serviço só atua nesses apps,
só quando você ativa, e pode ser desligado a qualquer momento em Configurações &gt; Acessibilidade.
O app não lê senhas, mensagens, conteúdo de outros apps nem registra o que você digita.</p>
<h2>3. Dados coletados</h2><ul><li>Conta: nome, e-mail e senha (guardada apenas como hash criptográfico).</li>
<li>Configurações: seus filtros, horários e textos de botões.</li>
<li>Histórico de ofertas: valor, distâncias, preço por km, decisão (aceita/recusada), motivo e horário.</li></ul>
<p>Não coletamos localização, contatos, fotos, dados do passageiro nem dados de pagamento.</p>
<h2>4. Como usamos</h2><p>Somente para aplicar seus filtros, mostrar seus ganhos e relatórios. Não vendemos nem compartilhamos
seus dados com terceiros e não usamos os dados para publicidade.</p>
<h2>5. Armazenamento e segurança</h2><p>Os dados ficam em servidor protegido e são transmitidos por conexão criptografada (HTTPS).
Cada motorista só acessa os próprios dados.</p>
<h2>6. Seus direitos (LGPD)</h2><p>Você pode apagar seu histórico no app ou excluir sua conta e todos os dados
pelo próprio app (Conta &gt; Excluir conta).</p>
<h2>7. Aviso</h2><p>O AutoCorrida não é afiliado ao RapidoCar nem à 99. O uso de automação pode estar sujeito aos termos desses apps;
o motorista é responsável pelo uso.</p>
</body></html>"""


@api_router.get("/privacy", response_class=HTMLResponse, include_in_schema=False)
async def privacy():
    return PRIVACY_HTML


@api_router.delete("/auth/account")
async def delete_account(user: CurrentUser):
    await db.rides.delete_many({"user_id": user.id})
    await db.settings.delete_many({"user_id": user.id})
    await db.users.delete_one({"_id": ObjectId(user.id)})
    return {"deleted": True}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def start_index_build():
    app.state.index_task = asyncio.create_task(ensure_indexes())


@app.on_event("shutdown")
async def shutdown_db_client():
    app.state.index_task.cancel()
    with suppress(asyncio.CancelledError):
        await app.state.index_task
    client.close()
