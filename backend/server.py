import asyncio
import random
from contextlib import suppress
from fastapi import FastAPI, APIRouter, Query, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING, IndexModel
from bson import ObjectId
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, BeforeValidator, ConfigDict, field_validator
from typing import List, Optional, Annotated, Literal
from datetime import datetime, timezone, timedelta


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

INDEXES: dict[str, list[IndexModel]] = {
    "rides": [
        IndexModel([("created_at", DESCENDING)], name="created_at_desc"),
        IndexModel([("accepted", ASCENDING), ("created_at", DESCENDING)], name="accepted_created"),
    ],
    "settings": [IndexModel([("key", ASCENDING)], name="key", unique=True)],
}


async def ensure_indexes() -> None:
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
    key: str = "default"
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


async def get_settings() -> Settings:
    doc = await db.settings.find_one({"key": "default"})
    if doc:
        return Settings.from_mongo(doc)
    s = Settings()
    await db.settings.update_one({"key": "default"}, {"$setOnInsert": s.to_mongo()}, upsert=True)
    return Settings.from_mongo(await db.settings.find_one({"key": "default"}))


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


@api_router.get("/settings")
async def read_settings():
    return (await get_settings()).to_api()


@api_router.put("/settings")
async def update_settings(body: SettingsUpdate):
    await get_settings()
    changes = body.model_dump(exclude_none=True)
    for f in TEXT_LIST_FIELDS:
        if f in changes:
            changes[f] = [t.strip() for t in changes[f] if t.strip()]
    if changes:
        await db.settings.update_one({"key": "default"}, {"$set": changes})
    return (await get_settings()).to_api()


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
async def simulate(tz: int = Query(0, ge=-840, le=840)):
    s = await get_settings()
    trip_km = round(random.uniform(1.5, 25), 1)
    price = round(trip_km * random.uniform(1.1, 3.4) + random.uniform(2, 5), 2)
    pickup_km = round(random.uniform(0.3, 7), 1)
    ppk, reasons = evaluate(price, trip_km, pickup_km, s)
    if not in_schedule(s, datetime.now(timezone.utc) + timedelta(minutes=tz)):
        reasons.append("Fora do horário de trabalho")
    a, b = random.sample(PLACES, 2)
    ride = Ride(price=price, trip_km=trip_km, pickup_km=pickup_km, price_per_km=ppk,
                accepted=not reasons, reasons=reasons, source="simulador", pickup=a, dropoff=b)
    res = await db.rides.insert_one(ride.to_mongo())
    ride.id = str(res.inserted_id)
    return ride.to_api()


@api_router.post("/rides/bulk")
async def add_rides(items: List[RideIn]):
    docs = []
    for r in items:
        ppk = r.price_per_km if r.price_per_km is not None else (round(r.price / r.trip_km, 2) if r.trip_km > 0 else 0)
        ride = Ride(price=r.price, trip_km=r.trip_km, pickup_km=r.pickup_km, price_per_km=ppk,
                    accepted=r.accepted, reasons=r.reasons, source=r.source,
                    created_at=to_utc_iso(r.created_at) if r.created_at else datetime.now(timezone.utc).isoformat())
        docs.append(ride.to_mongo())
    if docs:
        await db.rides.insert_many(docs)
    return {"inserted": len(docs)}


@api_router.get("/rides")
async def list_rides(status: Literal["all", "accepted", "rejected"] = "all", limit: int = Query(100, ge=1, le=500)):
    q = {} if status == "all" else {"accepted": status == "accepted"}
    docs = await db.rides.find(q).sort("created_at", -1).limit(limit).to_list(limit)
    return [Ride.from_mongo(d).to_api() for d in docs]


@api_router.delete("/rides")
async def clear_rides():
    res = await db.rides.delete_many({})
    return {"deleted": res.deleted_count}


@api_router.get("/stats")
async def stats(since: Optional[str] = None):
    if since:
        try:
            start = to_utc_iso(since)
        except ValueError:
            raise HTTPException(status_code=422, detail="Parâmetro 'since' inválido")
    else:
        start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    docs = await db.rides.find({"created_at": {"$gte": start}}, {"price": 1, "accepted": 1}).to_list(5000)
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
async def stats_weekly(tz: int = Query(0, ge=-840, le=840)):
    """Last 7 local days (tz = minutes offset from UTC, e.g. -180 for Brasília)."""
    now_local = datetime.now(timezone.utc) + timedelta(minutes=tz)
    first_day = (now_local - timedelta(days=6)).date()
    start_utc = datetime(first_day.year, first_day.month, first_day.day, tzinfo=timezone.utc) - timedelta(minutes=tz)
    docs = await db.rides.find({"created_at": {"$gte": start_utc.isoformat()}}, {"price": 1, "accepted": 1, "created_at": 1}).to_list(20000)
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
