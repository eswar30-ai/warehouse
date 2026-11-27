"""Local runner for the YOLO warehouse surveillance dashboard using workspace CSVs."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, redirect

from dashboard.yolo_dashboard import register_yolo_dashboard

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

os.environ.setdefault("YOLO_PERSON_CSV", str(ROOT / "warehouse_person_visits.csv"))
os.environ.setdefault("YOLO_GATE_VEHICLE_CSV", str(ROOT / "gate_vehicle_events.csv"))
os.environ.setdefault("YOLO_WAREHOUSE_VEHICLE_CSV", str(ROOT / "warehouse_vehicle_visits (1).csv"))


def create_app() -> Flask:
    app = Flask(__name__)
    register_yolo_dashboard(app)

    @app.get("/")
    def index():
        return redirect("/yolo/")

    return app


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5012"))
    create_app().run(host="0.0.0.0", port=port, debug=False, threaded=True)
