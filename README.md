# PrimeSight YOLO Dashboard (`/yolo`)

A light-theme, futuristic glassmorphism dashboard built around the uploaded PrimeSight CSV schemas. It uses inline SVG icons and SVG charts, responsive layouts, light animations, a set of quick AI prompts, and a server-side Groq assistant.

## What it shows

- People tracking records, active/completed record counts, median completed tracking duration, daily records and most common activities.
- Vehicle gate entry/exit event counts and daily flow.
- Warehouse vehicle records by status (`DOCKED`, `AT DOCK`, `IN PARKING`, `PARKED`, `IN YARD`, `ENTERED`, `EXITED`).
- Loading shutter record counts.
- Number-plate data quality note.

**Data definitions:** people rows are tracking records, not verified unique people; warehouse vehicle rows are state records, not verified unique vehicles. Gate entry minus exit is an event-count difference, not a verified live vehicle balance. The supplied files contain no readable plate values and no usable non-zero plate-confidence values. Vehicle duration is not used because most values are zero.

## 1. Copy the package into the existing PrimeSight project

Copy the `dashboard/yolo_dashboard/` directory into:

```text
/home/azureuser/ai-projects/projects/primesight/dashboard/yolo_dashboard/
```

Do not replace your existing `dashboard/main.py`.

## 2. Put the CSV files on the server

Create a data folder and copy the three CSV exports into it:

```bash
cd /home/azureuser/ai-projects/projects/primesight
mkdir -p data/yolo
```

Expected files:

```text
data/yolo/warehouse_person_visits.csv
data/yolo/gate_vehicle_events.csv
data/yolo/warehouse_vehicle_visits.csv
```

Alternatively, set the three CSV paths with environment variables:

- `YOLO_PERSON_CSV`
- `YOLO_GATE_VEHICLE_CSV`
- `YOLO_WAREHOUSE_VEHICLE_CSV`

The dashboard re-reads the CSV files whenever the API is called. The browser refreshes the displayed data every 60 seconds. This is only as current as the CSV files written by your application.

## 3. Register the `/yolo` blueprint

Open the existing `dashboard/main.py`. Find where your Flask app or Dash app is created. After the app/server object exists, add the registration call **once**.

If it is a Dash app named `app`:

```python
from dashboard.yolo_dashboard import register_yolo_dashboard
register_yolo_dashboard(app)  # uses app.server automatically
```

If it is a Flask app named `app`:

```python
from dashboard.yolo_dashboard import register_yolo_dashboard
register_yolo_dashboard(app)
```

Place this before the application is started by Waitress. Do not create a second Flask/Waitress server just for this dashboard. Restart the existing service after saving.

### Authentication note

Your existing PrimeSight login must also protect this Flask blueprint and its `/yolo/api/*` endpoints. If your current login protection only wraps Dash page routes, wire the same authentication check into this blueprint. For example, if Flask-Login is already used, import `current_user` and register with:

```python
register_yolo_dashboard(app, auth_check=lambda: current_user.is_authenticated)
```

Use the authentication mechanism already used by your application. Do not leave surveillance data endpoints publicly accessible.

## 4. Configure Groq safely

The Groq key must stay on the server. Do not put it in `dashboard.js`, HTML, or a `VITE_*` / browser-visible variable.

Install the HTTP dependency in the same virtual environment used by PrimeSight:

```bash
/home/azureuser/ai-projects/venvs/primesight/bin/pip install requests
```

Create a protected environment file:

```bash
sudo mkdir -p /etc/primesight
sudo nano /etc/primesight/primesight.env
```

Add:

```bash
GROQ_API_KEY=put_your_groq_key_here
GROQ_MODEL=openai/gpt-oss-20b
```

Restrict access:

```bash
sudo chown root:root /etc/primesight/primesight.env
sudo chmod 600 /etc/primesight/primesight.env
```

Add this line under `[Service]` in `/etc/systemd/system/primesight.service`:

```ini
EnvironmentFile=/etc/primesight/primesight.env
```

Then reload and restart:

```bash
sudo systemctl daemon-reload
sudo systemctl restart primesight
sudo systemctl status primesight --no-pager
```

`GROQ_MODEL` is configurable. Confirm that the model is available to your Groq account; available model IDs can be checked using Groq's Models API. The default in this package is `openai/gpt-oss-20b`.

## 5. Test

```bash
curl -I http://127.0.0.1:5012/yolo/
curl -s http://127.0.0.1:5012/yolo/api/summary | head -c 500
```

Then open:

```text
https://primesight.utkarshconnect.com/yolo/
```

The blueprint is served by the same host and port as PrimeSight. **No separate Nginx location block should be required** when Nginx already proxies the whole domain to `127.0.0.1:5012`.

## 6. API routes

- `GET /yolo/` — dashboard page
- `GET /yolo/api/summary` — aggregate dashboard metrics
- `POST /yolo/api/assistant` — Groq assistant, body: `{"message":"Summarize vehicle movement"}`

The assistant sends aggregate dashboard metrics only. It does not send raw person IDs, plate fields, camera snapshots, or raw event rows to Groq.

## 7. Live-data integration

This first version reads CSV exports. For a production live dashboard, replace `_read_csv()` / `build_dashboard_data()` with queries to the same database or internal APIs that PrimeSight writes to. Keep the JSON response structure stable so the frontend can continue to work. Do not treat a periodically exported CSV as a real-time camera feed.

## Troubleshooting

- `503 Missing data file`: upload the CSVs or set the three `YOLO_*_CSV` paths.
- AI says not configured: confirm `GROQ_API_KEY` exists in the service environment; do not print the value in logs.
- `401 Sign in is required`: ensure `auth_check` matches the current login session, or apply the existing app-wide authentication hook.
- `404 /yolo/`: confirm `register_yolo_dashboard(app)` is called on the actual Flask server and service was restarted.
- CSS/JS does not load: inspect browser Network tab for `/yolo/assets/dashboard.css` and `/yolo/assets/dashboard.js`. They should return `200` with CSS/JavaScript content types.
