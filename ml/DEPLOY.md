# Deploy GS ML Service to VPS

## 1. Upload files

```bash
scp -r ml/ root@103.82.23.48:/opt/gs-ml/
```

## 2. On VPS

```bash
ssh root@103.82.23.48
cd /opt/gs-ml

# Create virtualenv and install deps
python3 -m venv venv
./venv/bin/pip install -r requirements.txt

# Configure
cp .env.example .env
nano .env   # set DATABASE_URL

# Run DB migration
psql $DATABASE_URL -f migrate.sql

# Train initial model (needs 50+ rows in gs_matches_history)
./venv/bin/python train.py
# → prints accuracy report and saves model.pkl

# Start service with PM2
pm2 start ecosystem.config.js
pm2 save
pm2 logs gs-ml   # verify startup
```

## 3. Open firewall port (if needed)

```bash
ufw allow 8001/tcp
```

## 4. Wire up Vercel

```bash
# From local machine
vercel env add ML_SERVICE_URL   # enter: http://103.82.23.48:8001
vercel --prod
```

## 5. Verify

```bash
# Check service health
curl http://103.82.23.48:8001/status

# Test prediction
curl -X POST http://103.82.23.48:8001/predict \
  -H 'Content-Type: application/json' \
  -d '{"h1_home":1,"h1_away":0,"match_type":"20p","home_form_pts":9,"away_form_pts":6}'
```

## 6. Retrain when you have more data

```bash
# On VPS — retrain and reload without downtime
./venv/bin/python train.py
curl -X POST http://103.82.23.48:8001/train   # hot-reload model into running service
```

## How it learns

1. Every prediction is logged to `gs_ml_predictions` (home_team, away_team, h1, form, predicted %)
2. After matches end, the collector can fill in `actual_winner`, `tt_home`, `tt_away`
3. Run `python train.py` periodically (weekly cron) to retrain on the growing dataset
4. Each retrain bumps `model_version` — you can see it in the `[ML v{N}]` header in the UI

## Architecture

```
Vercel (Next.js)
  POST /api/gs-predict
       |── callMlService() ──▶ http://VPS:8001/predict  (2s timeout, fallback to stats)
       |── logPrediction()  ──▶ gs_ml_predictions table (fire-and-forget)
       └── statsStream() or claudeStream()

VPS
  FastAPI (port 8001) — loads model.pkl, pure numpy inference
  train.py            — fetches gs_matches_history, retrains, saves model.pkl
  gs_ml_predictions   — prediction log for future retraining
```

## Notes

- ML service has a **2-second timeout** — if VPS is slow/down, Vercel falls back to stats engine silently
- model.pkl is loaded into RAM at startup — `/predict` is pure numpy, no DB at runtime
- First 1000+ predictions logged → enough to retrain with actual outcomes for v2
