"""
GS ML Service — FastAPI prediction server.
Loads model.pkl on startup (trains from DB if missing).
DB is only needed for training; /predict is pure numpy.
"""

import asyncio
import os
import pickle
import logging
from contextlib import asynccontextmanager
from typing import Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

MODEL_PATH = os.path.join(os.path.dirname(__file__), "model.pkl")

# Global model state
_state: dict = {"bundle": None}

FEATURE_NAMES = [
    "h1_home", "h1_away", "score_diff", "total_h1",
    "is_20p", "home_leading", "away_leading", "drawing",
    "home_form_pts", "away_form_pts", "h2h_home_win_rate",
    "hc_line", "is_h2", "minute", "red_card_diff",
]


def make_features(
    h1_home: int,
    h1_away: int,
    match_type: str = "20p",
    home_form_pts: float = 7.0,
    away_form_pts: float = 7.0,
    h2h_home_win_rate: float = 0.5,
    hc_line: float = 0.0,
    is_h2: bool = False,
    minute: int = 45,
    red_home: int = 0,
    red_away: int = 0,
) -> list:
    score_diff = h1_home - h1_away
    total_h1 = h1_home + h1_away
    return [
        h1_home, h1_away,
        score_diff,
        total_h1,
        int(match_type == "20p"),
        int(h1_home > h1_away),
        int(h1_home < h1_away),
        int(h1_home == h1_away),
        float(home_form_pts),
        float(away_form_pts),
        float(h2h_home_win_rate),
        float(hc_line),
        int(is_h2),
        int(minute),
        red_home - red_away,
    ]


def load_model() -> Optional[dict]:
    if not os.path.exists(MODEL_PATH):
        return None
    with open(MODEL_PATH, "rb") as f:
        return pickle.load(f)


def train_from_db() -> dict:
    """Fetch all matches from DB and train logistic regression. Returns bundle."""
    import psycopg2
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import cross_val_score

    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise RuntimeError("DATABASE_URL not set")

    log.info("Connecting to DB for training…")
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    cur.execute(
        "SELECT match_type, h1_home, h1_away, tt_home, tt_away FROM gs_matches_history"
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()
    log.info("Fetched %d rows from DB", len(rows))

    X, y = [], []
    for match_type, h1_home, h1_away, tt_home, tt_away in rows:
        if tt_home is None or tt_away is None:
            continue
        feats = make_features(
            h1_home=int(h1_home or 0),
            h1_away=int(h1_away or 0),
            match_type=match_type or "20p",
        )
        X.append(feats)
        if tt_home > tt_away:
            y.append(2)  # home win
        elif tt_home < tt_away:
            y.append(0)  # away win
        else:
            y.append(1)  # draw

    if len(X) < 50:
        raise RuntimeError(f"Only {len(X)} samples — need at least 50 to train")

    X_arr = np.array(X, dtype=float)
    y_arr = np.array(y, dtype=int)

    clf = LogisticRegression(multi_class="multinomial", max_iter=1000, C=1.0)
    scores = cross_val_score(clf, X_arr, y_arr, cv=5, scoring="accuracy")
    accuracy = float(scores.mean())
    log.info("Cross-val accuracy: %.3f (±%.3f)", accuracy, scores.std())

    clf.fit(X_arr, y_arr)

    existing = load_model()
    version = (existing["version"] + 1) if existing else 1

    bundle = {
        "model": clf,
        "accuracy": accuracy,
        "n_samples": len(X),
        "version": version,
        "feature_names": FEATURE_NAMES,
    }
    with open(MODEL_PATH, "wb") as f:
        pickle.dump(bundle, f)
    log.info("Model v%d saved to %s", version, MODEL_PATH)
    return bundle


def db_row_count() -> int:
    """Return current row count in gs_matches_history (with tt_home filled)."""
    import psycopg2
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        return 0
    try:
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM gs_matches_history WHERE tt_home IS NOT NULL")
        count = cur.fetchone()[0]
        cur.close()
        conn.close()
        return int(count)
    except Exception as e:
        log.warning("db_row_count error: %s", e)
        return 0


async def auto_retrain_loop():
    """Every 30 min: retrain if DB has 5+ new samples since last train."""
    INTERVAL = 2 * 60  # 2 minutes
    THRESHOLD = 5       # retrain when at least 5 new samples
    while True:
        await asyncio.sleep(INTERVAL)
        try:
            current_n = _state["bundle"]["n_samples"] if _state["bundle"] else 0
            db_n = await asyncio.get_event_loop().run_in_executor(None, db_row_count)
            if db_n >= current_n + THRESHOLD:
                log.info("Auto-retrain: DB has %d rows, model has %d samples — retraining…", db_n, current_n)
                bundle = await asyncio.get_event_loop().run_in_executor(None, train_from_db)
                _state["bundle"] = bundle
                log.info("Auto-retrain done: v%d, %d samples, %.3f acc", bundle["version"], bundle["n_samples"], bundle["accuracy"])
            else:
                log.info("Auto-retrain check: DB %d vs model %d — no retrain needed", db_n, current_n)
        except Exception as e:
            log.warning("Auto-retrain failed: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    bundle = load_model()
    if bundle is None:
        log.info("No model.pkl found — training from DB…")
        try:
            bundle = train_from_db()
        except Exception as e:
            log.warning("Auto-train failed: %s — starting without model", e)
    else:
        log.info("Loaded model v%d (%.3f acc, %d samples)", bundle["version"], bundle["accuracy"], bundle["n_samples"])
    _state["bundle"] = bundle

    task = asyncio.create_task(auto_retrain_loop())
    yield
    task.cancel()
    _state["bundle"] = None


app = FastAPI(title="GS ML Service", lifespan=lifespan)


# ── Request / response models ─────────────────────────────────────────────────

class PredictRequest(BaseModel):
    h1_home: int
    h1_away: int
    match_type: str = "20p"
    home_form_pts: float = 7.0
    away_form_pts: float = 7.0
    h2h_home_win_rate: float = 0.5
    hc_line: float = 0.0
    is_h2: bool = False
    minute: int = 45
    red_home: int = 0
    red_away: int = 0


class PredictResponse(BaseModel):
    home_pct: int
    draw_pct: int
    away_pct: int
    model_version: int
    confidence: str  # "high" | "medium" | "low"
    n_samples: int


class TrainResponse(BaseModel):
    ok: bool
    n_samples: int
    accuracy: float
    version: int


class StatusResponse(BaseModel):
    loaded: bool
    n_samples: int
    accuracy: float
    version: int


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/status", response_model=StatusResponse)
def status():
    b = _state["bundle"]
    if b is None:
        return StatusResponse(loaded=False, n_samples=0, accuracy=0.0, version=0)
    return StatusResponse(
        loaded=True,
        n_samples=b["n_samples"],
        accuracy=round(b["accuracy"], 4),
        version=b["version"],
    )


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
    b = _state["bundle"]
    if b is None:
        raise HTTPException(status_code=503, detail="Model not loaded — call POST /train first")

    feats = make_features(
        h1_home=req.h1_home,
        h1_away=req.h1_away,
        match_type=req.match_type,
        home_form_pts=req.home_form_pts,
        away_form_pts=req.away_form_pts,
        h2h_home_win_rate=req.h2h_home_win_rate,
        hc_line=req.hc_line,
        is_h2=req.is_h2,
        minute=req.minute,
        red_home=req.red_home,
        red_away=req.red_away,
    )
    proba = b["model"].predict_proba([feats])[0]
    # classes: [0=away_win, 1=draw, 2=home_win]
    classes = list(b["model"].classes_)
    proba_map = dict(zip(classes, proba))
    away_p = proba_map.get(0, 0.0)
    draw_p = proba_map.get(1, 0.0)
    home_p = proba_map.get(2, 0.0)

    max_prob = max(home_p, draw_p, away_p)
    if max_prob > 0.6:
        confidence = "high"
    elif max_prob > 0.45:
        confidence = "medium"
    else:
        confidence = "low"

    return PredictResponse(
        home_pct=round(home_p * 100),
        draw_pct=round(draw_p * 100),
        away_pct=round(away_p * 100),
        model_version=b["version"],
        confidence=confidence,
        n_samples=b["n_samples"],
    )


@app.post("/train", response_model=TrainResponse)
def train():
    try:
        bundle = train_from_db()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    _state["bundle"] = bundle
    return TrainResponse(
        ok=True,
        n_samples=bundle["n_samples"],
        accuracy=round(bundle["accuracy"], 4),
        version=bundle["version"],
    )


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8001"))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=False)
