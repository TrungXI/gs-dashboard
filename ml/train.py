"""
Standalone training script.
Usage: python train.py

Model A (default): trains on gs_matches_history — h1_home, h1_away, match_type only.
                   Works from day 1 with existing data.

Model B (future):  joins gs_match_odds_log with gs_matches_history to include
                   HC odds, OU line, cards, corners as features.
                   Run automatically when gs_match_odds_log has 1000+ filled rows.

Reads DATABASE_URL from .env, trains model, saves model.pkl, prints report.
"""

import os
import pickle
import sys

import numpy as np
from dotenv import load_dotenv

load_dotenv()


FEATURE_NAMES = [
    "h1_home", "h1_away", "score_diff", "total_h1",
    "is_20p", "home_leading", "away_leading", "drawing",
    "home_form_pts", "away_form_pts", "h2h_home_win_rate",
    "hc_line", "is_h2", "minute", "red_card_diff",
]

MODEL_PATH = os.path.join(os.path.dirname(__file__), "model.pkl")


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
        h1_home, h1_away, score_diff, total_h1,
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


def main():
    import psycopg2
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import cross_val_score
    from sklearn.metrics import classification_report, confusion_matrix

    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("ERROR: DATABASE_URL not set in .env")
        sys.exit(1)

    print(f"Connecting to DB…")
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()

    # Check if Model B is possible (1000+ filled odds log rows)
    model_b = False
    try:
        cur.execute("SELECT COUNT(*) FROM gs_match_odds_log WHERE outcome_filled = TRUE")
        odds_count = cur.fetchone()[0]
        if odds_count >= 1000:
            model_b = True
            print(f"gs_match_odds_log has {odds_count} filled rows — training Model B (full features)")
    except Exception:
        pass  # table doesn't exist yet

    if model_b:
        # Model B: join odds log with history for full feature set
        cur.execute("""
            SELECT
                ol.match_type, ol.h1_home, ol.h1_away,
                ol.hc_line, ol.hc_home_odds,
                ol.ou_line,
                ol.is_h2, ol.minute_elapsed,
                ol.red_home, ol.red_away,
                ol.tt_home, ol.tt_away
            FROM gs_match_odds_log ol
            WHERE ol.outcome_filled = TRUE
              AND ol.tt_home IS NOT NULL
              AND ol.minute_elapsed BETWEEN 1 AND 44
        """)
        rows = cur.fetchall()
        print(f"Fetched {len(rows)} odds-log rows (Model B)")
        use_odds = True
    else:
        cur.execute(
            "SELECT match_type, h1_home, h1_away, tt_home, tt_away FROM gs_matches_history"
        )
        rows = cur.fetchall()
        print(f"Fetched {len(rows)} rows from gs_matches_history (Model A)")
        use_odds = False

    cur.close()
    conn.close()

    X, y = [], []
    skipped = 0

    if use_odds:
        # Model B rows: match_type, h1_home, h1_away, hc_line, hc_home_odds,
        #               ou_line, is_h2, minute_elapsed, red_home, red_away, tt_home, tt_away
        for row in rows:
            match_type, h1_home, h1_away, hc_line, hc_home_odds, ou_line, \
                is_h2, minute, red_home, red_away, tt_home, tt_away = row
            if tt_home is None or tt_away is None:
                skipped += 1
                continue
            feats = make_features(
                h1_home=int(h1_home or 0),
                h1_away=int(h1_away or 0),
                match_type=match_type or "20p",
                hc_line=float(hc_home_odds or 0),
                is_h2=bool(is_h2),
                minute=int(minute or 45),
                red_home=int(red_home or 0),
                red_away=int(red_away or 0),
            )
            X.append(feats)
            tt_home, tt_away = int(tt_home), int(tt_away)
            y.append(2 if tt_home > tt_away else 0 if tt_home < tt_away else 1)
    else:
        # Model A rows: match_type, h1_home, h1_away, tt_home, tt_away
        for match_type, h1_home, h1_away, tt_home, tt_away in rows:
            if tt_home is None or tt_away is None:
                skipped += 1
                continue
            feats = make_features(
                h1_home=int(h1_home or 0),
                h1_away=int(h1_away or 0),
                match_type=match_type or "20p",
            )
            X.append(feats)
            tt_home, tt_away = int(tt_home), int(tt_away)
            y.append(2 if tt_home > tt_away else 0 if tt_home < tt_away else 1)

    if skipped:
        print(f"Skipped {skipped} rows with missing scores")

    n = len(X)
    if n < 50:
        print(f"ERROR: Only {n} samples — need at least 50")
        sys.exit(1)

    print(f"Training on {n} samples…")
    X_arr = np.array(X, dtype=float)
    y_arr = np.array(y, dtype=int)

    clf = LogisticRegression(multi_class="multinomial", max_iter=1000, C=1.0)
    scores = cross_val_score(clf, X_arr, y_arr, cv=5, scoring="accuracy")
    print(f"Cross-val accuracy: {scores.mean():.3f} ± {scores.std():.3f}")

    clf.fit(X_arr, y_arr)
    y_pred = clf.predict(X_arr)

    print("\nConfusion matrix (rows=actual, cols=predicted):")
    print("  Labels: 0=away_win, 1=draw, 2=home_win")
    print(confusion_matrix(y_arr, y_pred))

    print("\nClassification report:")
    print(classification_report(y_arr, y_pred, target_names=["away_win", "draw", "home_win"]))

    # Load existing to bump version
    existing = None
    if os.path.exists(MODEL_PATH):
        with open(MODEL_PATH, "rb") as f:
            existing = pickle.load(f)
    version = (existing["version"] + 1) if existing else 1

    bundle = {
        "model": clf,
        "accuracy": float(scores.mean()),
        "n_samples": n,
        "version": version,
        "feature_names": FEATURE_NAMES,
    }
    with open(MODEL_PATH, "wb") as f:
        pickle.dump(bundle, f)
    print(f"\nSaved model v{version} to {MODEL_PATH}")


if __name__ == "__main__":
    main()
