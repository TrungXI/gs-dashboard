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


class AnalyzeRequest(BaseModel):
    home_team: str
    away_team: str


class AnalyzeResponse(BaseModel):
    text: str


def analyze_teams_from_db(home_team: str, away_team: str) -> str:
    import psycopg2
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        return ""
    try:
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()

        # Query 1: per-match H1 score and final score
        cur.execute("""
            WITH h1_snap AS (
                SELECT event_id, score_home AS h1_home, score_away AS h1_away
                FROM match_odds_log WHERE snapshot_type = 'kickoff_h2'
            ),
            last_snap AS (
                SELECT DISTINCT ON (event_id) event_id,
                    score_home AS final_home, score_away AS final_away
                FROM match_odds_log ORDER BY event_id, recorded_at DESC
            )
            SELECT d.event_id, d.home_team, d.away_team,
                   h1.h1_home, h1.h1_away, ls.final_home, ls.final_away
            FROM (SELECT DISTINCT event_id, home_team, away_team
                  FROM match_odds_log
                  WHERE home_team = %s OR away_team = %s
                     OR home_team = %s OR away_team = %s) d
            LEFT JOIN h1_snap h1 USING (event_id)
            LEFT JOIN last_snap ls USING (event_id)
            WHERE h1.h1_home IS NOT NULL AND ls.final_home IS NOT NULL
            ORDER BY d.event_id DESC LIMIT 300
        """, (home_team, home_team, away_team, away_team))
        match_rows = cur.fetchall()

        # Query 2: goal timing
        cur.execute("""
            SELECT event_id, minute
            FROM match_odds_log
            WHERE snapshot_type IN ('goal_h1', 'goal_h2')
              AND minute IS NOT NULL
              AND (home_team = %s OR away_team = %s
                OR home_team = %s OR away_team = %s)
            ORDER BY event_id, recorded_at
        """, (home_team, home_team, away_team, away_team))
        goal_rows = cur.fetchall()
        cur.close()
        conn.close()
    except Exception as e:
        log.warning("analyze_teams_from_db error: %s", e)
        return ""

    if not match_rows:
        return ""

    # --- per-match analysis ---
    # track first goal minute per event
    first_goal_per_event: dict = {}
    for ev_id, minute in goal_rows:
        if ev_id not in first_goal_per_event:
            first_goal_per_event[ev_id] = minute

    def team_stats(team: str):
        n = cb = cb_total = 0
        h2_goals_total = 0
        for ev_id, ht, at, h1h, h1a, fh, fa in match_rows:
            is_home = ht == team
            is_away = at == team
            if not (is_home or is_away):
                continue
            n += 1
            # H1 goals for this team
            h1_for = h1h if is_home else h1a
            h1_opp = h1a if is_home else h1h
            fin_for = fh if is_home else fa
            fin_opp = fa if is_home else fh
            # H2 goals added
            h2_goals_total += max(0, fin_for - h1_for)
            # Comeback: trailing at H1, not losing at final
            if h1_for < h1_opp and fin_for >= fin_opp:
                cb += 1
            if h1_for < h1_opp:
                cb_total += 1
        h2_avg = (h2_goals_total / n) if n > 0 else 0.0
        return n, cb, cb_total, h2_avg

    home_n, home_cb, home_cb_total, home_h2 = team_stats(home_team)
    away_n, away_cb, away_cb_total, away_h2 = team_stats(away_team)

    # H2H
    h2h_home_w = h2h_away_w = h2h_d = 0
    for ev_id, ht, at, h1h, h1a, fh, fa in match_rows:
        if not ((ht == home_team and at == away_team) or
                (ht == away_team and at == home_team)):
            continue
        if fh > fa:
            winner = ht
        elif fa > fh:
            winner = at
        else:
            winner = None
        if winner == home_team:
            h2h_home_w += 1
        elif winner == away_team:
            h2h_away_w += 1
        else:
            h2h_d += 1
    h2h_n = h2h_home_w + h2h_away_w + h2h_d

    # Average first goal minute (across all matching matches)
    mins = [m for ev_id, m in first_goal_per_event.items()
            if any(r[0] == ev_id for r in match_rows)]
    avg_min = round(sum(mins) / len(mins)) if mins else None

    total = home_n + away_n
    if total < 5:
        return f"📊 Lịch sử: {total} trận — chưa đủ dữ liệu để phân tích"

    # Short team display
    def short(name: str) -> str:
        return name.split(" (")[0] if " (" in name else name

    hn = short(home_team)
    an = short(away_team)

    lines = [f"📊 Lịch sử odds ({home_n} trận {hn}, {away_n} trận {an})"]
    if home_cb_total > 0:
        lines.append(f"   {hn}: lật ngược {home_cb}/{home_cb_total} khi thua H1 · H2 TB +{home_h2:.1f} bàn")
    else:
        lines.append(f"   {hn}: không thua H1 trong DB · H2 TB +{home_h2:.1f} bàn")
    if away_cb_total > 0:
        lines.append(f"   {an}: lật ngược {away_cb}/{away_cb_total} khi thua H1 · H2 TB +{away_h2:.1f} bàn")
    else:
        lines.append(f"   {an}: không thua H1 trong DB · H2 TB +{away_h2:.1f} bàn")
    if avg_min is not None:
        lines.append(f"   Bàn đầu TB: phút {avg_min}")
    if h2h_n > 0:
        h2h_leader = hn if h2h_home_w > h2h_away_w else (an if h2h_away_w > h2h_home_w else "Cân bằng")
        h2h_w = max(h2h_home_w, h2h_away_w)
        lines.append(f"   H2H: {h2h_n} trận · {h2h_leader} thắng {h2h_w} · Hòa {h2h_d}")

    return "\n".join(lines)


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest):
    try:
        text = analyze_teams_from_db(req.home_team, req.away_team)
        return AnalyzeResponse(text=text)
    except Exception as e:
        log.warning("analyze endpoint error: %s", e)
        return AnalyzeResponse(text="")


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8001"))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=False)
