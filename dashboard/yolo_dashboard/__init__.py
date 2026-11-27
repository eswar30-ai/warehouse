"""YOLO warehouse surveillance dashboard blueprint.

Register with either a Flask app or a Dash app:
    register_yolo_dashboard(app)        # Flask
    register_yolo_dashboard(dash_app)   # Dash (uses dash_app.server)
"""
from __future__ import annotations

import csv
import json
import os
import re
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

import requests
from flask import Blueprint, current_app, jsonify, render_template, request

bp = Blueprint(
    "yolo_dashboard",
    __name__,
    template_folder="templates",
    static_folder="static",
    static_url_path="/assets",
)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATA_DIR = PROJECT_ROOT / "data" / "yolo"
_TRAIL_BRACKET_RE = re.compile(r"\s*\[[^\]]*\]\s*$")

CAUTION_TEXT = (
    "Due to low visual quality, vehicle number plates cannot be tracked reliably, "
    "and the same vehicle cannot be uniquely identified across multiple camera views."
)

ACTIVITY_NAME_MAP = {
    "Passing through courtyard main gate entrance": "Passing through main gate",
    "Inspecting vehicle Truck": "Checking truck area",
    "Walking across dock apron": "Walking near loading docks",
    "Moving through CH4 active zone": "Moving through Zone CH4",
    "Walking across parking yard": "Walking through parking yard",
    "Moving through CH6 active zone": "Moving through Zone CH6",
    "Inspecting vehicle Bus": "Checking bus area",
    "Moving through CH5 active zone": "Moving through Zone CH5",
    "Moving through CH3 active zone": "Moving through Zone CH3",
    "Operating Motorcycle": "Motorcycle activity",
    "Loading / Unloading cargo at Truck": "Truck cargo loading",
}


def _csv_path(env_name: str, filename: str) -> Path:
    configured = os.getenv(env_name)
    return Path(configured).expanduser() if configured else DEFAULT_DATA_DIR / filename


def _read_csv(env_name: str, filename: str) -> tuple[list[dict[str, str]], dict[str, Any]]:
    path = _csv_path(env_name, filename)
    if not path.exists():
        raise FileNotFoundError(
            f"Missing data file: {path}. Set {env_name} or place the CSV in {DEFAULT_DATA_DIR}."
        )
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    stat = path.stat()
    return rows, {
        "file": path.name,
        "updated_at": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
    }


def _parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
            try:
                return datetime.strptime(text, fmt)
            except ValueError:
                pass
    return None


def _date(value: Any) -> str | None:
    dt = _parse_dt(value)
    return dt.date().isoformat() if dt else None


def _hour(value: Any) -> int | None:
    dt = _parse_dt(value)
    return dt.hour if dt else None


def _pretty_day(iso_day: str) -> str:
    try:
        return datetime.strptime(iso_day, "%Y-%m-%d").strftime("%b %d")
    except ValueError:
        return iso_day


def _fmt_duration(seconds_val: Any) -> str:
    try:
        sec = float(seconds_val)
    except (TypeError, ValueError):
        return "—"
    if sec < 0:
        return "—"
    s = int(round(sec))
    if s < 60:
        return f"{s}s"
    mins, rem = divmod(s, 60)
    if mins < 60:
        return f"{mins}m {rem:02d}s"
    hrs, rem_m = divmod(mins, 60)
    return f"{hrs}h {rem_m:02d}m"


def _clean_plate(value: str | None) -> bool:
    text = (value or "").strip().upper()
    if not text:
        return False
    return not any(text.startswith(prefix) for prefix in ("UNREADABLE", "PENDING", "UNKNOWN", "N/A"))


def _parse_json_list(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
        return [str(x) for x in parsed] if isinstance(parsed, list) else []
    except (ValueError, TypeError):
        return []


def _map_activity(raw_act: str | None) -> str:
    text = (raw_act or "Not specified").strip()
    base = _TRAIL_BRACKET_RE.sub("", text).strip() or text
    return ACTIVITY_NAME_MAP.get(base, base)


def build_dashboard_data() -> dict[str, Any]:
    people, people_file = _read_csv("YOLO_PERSON_CSV", "warehouse_person_visits.csv")
    gate, gate_file = _read_csv("YOLO_GATE_VEHICLE_CSV", "gate_vehicle_events.csv")
    warehouse, warehouse_file = _read_csv("YOLO_WAREHOUSE_VEHICLE_CSV", "warehouse_vehicle_visits.csv")

    # People tracking: a row is a tracking record, not proof of a unique human identity.
    people_daily: Counter[str] = Counter()
    people_hourly: Counter[int] = Counter()
    multi_cam_records = 0
    multi_cam_depth: Counter[str] = Counter()
    carried_item_records = 0
    carried_item_types: Counter[str] = Counter()
    phone_usage_records = 0
    phone_cameras: Counter[str] = Counter()
    activity_counts: Counter[str] = Counter()
    entry_cameras: Counter[str] = Counter()

    # Safe operational sample rows for KPI drill-down tables (no person_uid or snapshots).
    phone_detail_rows: list[dict[str, str]] = []
    multi_cam_samples: list[dict[str, str]] = []
    carried_samples: list[dict[str, str]] = []

    day_people_hourly: dict[str, Counter[int]] = defaultdict(Counter)
    day_people_multi: Counter[str] = Counter()
    day_people_carried: Counter[str] = Counter()
    day_people_phone: Counter[str] = Counter()
    day_people_activities: dict[str, Counter[str]] = defaultdict(Counter)

    for row in people:
        first_seen = (row.get("first_seen") or "").strip()
        last_seen = (row.get("last_seen") or "").strip()
        day = _date(first_seen)
        hr = _hour(first_seen)
        if day:
            people_daily[day] += 1
            if hr is not None:
                day_people_hourly[day][hr] += 1
        if hr is not None:
            people_hourly[hr] += 1

        cams = _parse_json_list(row.get("cams_visited"))
        entry_cam = (row.get("entry_cam") or "Unknown").strip().upper()
        cur_cam = (row.get("current_cam") or "Unknown").strip().upper()
        mapped_act = _map_activity(row.get("current_activity"))
        carried_raw = (row.get("carried_items") or "").strip()
        dur_label = _fmt_duration(row.get("duration_seconds"))

        if len(cams) > 1:
            multi_cam_records += 1
            bucket = f"{len(cams)} cameras" if len(cams) < 4 else "4+ cameras"
            multi_cam_depth[bucket] += 1
            if day:
                day_people_multi[day] += 1
            if len(multi_cam_samples) < 15:
                multi_cam_samples.append({
                    "first_seen": first_seen,
                    "route": f"{entry_cam} → {cur_cam}",
                    "zones": ", ".join(c.upper() for c in cams),
                    "duration": dur_label,
                    "activity": mapped_act,
                })
        else:
            multi_cam_depth["1 camera"] += 1

        if carried_raw:
            carried_item_records += 1
            if day:
                day_people_carried[day] += 1
            for part in carried_raw.split(","):
                item = part.strip()
                if item:
                    carried_item_types[item] += 1
            if len(carried_samples) < 15:
                carried_samples.append({
                    "first_seen": first_seen,
                    "camera": cur_cam,
                    "items": carried_raw,
                    "activity": mapped_act,
                    "duration": dur_label,
                })

        phone_val = str(row.get("is_holding_phone") or "").strip().lower()
        if phone_val in ("1", "true", "yes"):
            phone_usage_records += 1
            if day:
                day_people_phone[day] += 1
            phone_cameras[cur_cam] += 1
            phone_detail_rows.append({
                "first_seen": first_seen,
                "last_seen": last_seen or "—",
                "duration": dur_label,
                "camera": f"{entry_cam} → {cur_cam}",
                "zones": ", ".join(c.upper() for c in cams) if cams else cur_cam,
                "activity": mapped_act,
                "carried_items": carried_raw or "None",
            })

        activity_counts[mapped_act] += 1
        if day:
            day_people_activities[day][mapped_act] += 1
        entry_cameras[entry_cam] += 1

    people_total = len(people)
    top_activities = [
        {
            "name": name,
            "count": count,
            "share": round((count / people_total) * 100, 1) if people_total else 0.0,
        }
        for name, count in activity_counts.most_common(8)
    ]

    people_hourly_series = [
        {"hour": h, "label": f"{h:02d}:00", "count": people_hourly.get(h, 0)}
        for h in range(24)
    ]
    peak_people_hr = max(
        people_hourly_series,
        key=lambda x: x["count"],
        default={"hour": 0, "label": "00:00", "count": 0},
    )

    # Gate events.
    gate_type_counts = Counter((r.get("vehicle_type") or "Unknown").strip().title() for r in gate)
    gate_event_counts = Counter((r.get("event_type") or "UNKNOWN").strip().upper() for r in gate)
    gate_daily: dict[str, Counter[str]] = defaultdict(Counter)
    gate_hourly: dict[int, Counter[str]] = defaultdict(Counter)
    day_gate_hourly: dict[str, dict[int, Counter[str]]] = defaultdict(lambda: defaultdict(Counter))
    day_gate_types: dict[str, Counter[str]] = defaultdict(Counter)
    readable_gate_plates = 0
    gate_entry_samples: list[dict[str, str]] = []
    gate_exit_samples: list[dict[str, str]] = []

    for row in gate:
        ts = (row.get("timestamp") or "").strip()
        ev_type = (row.get("event_type") or "UNKNOWN").strip().upper()
        v_type = (row.get("vehicle_type") or "Unknown").strip().title()
        direction = (row.get("direction") or "—").strip().replace("_", " ")
        plate_side = (row.get("plate_side") or "—").strip().title()
        day = _date(ts)
        hr = _hour(ts)
        if day:
            gate_daily[day][ev_type] += 1
            day_gate_types[day][v_type] += 1
            if hr is not None:
                day_gate_hourly[day][hr][ev_type] += 1
        if hr is not None:
            gate_hourly[hr][ev_type] += 1
        if _clean_plate(row.get("license_plate")):
            readable_gate_plates += 1

        sample = {
            "timestamp": ts,
            "vehicle_type": v_type,
            "direction": direction,
            "plate_side": plate_side,
        }
        if ev_type == "ENTRY" and len(gate_entry_samples) < 15:
            gate_entry_samples.append(sample)
        elif ev_type == "EXIT" and len(gate_exit_samples) < 15:
            gate_exit_samples.append(sample)

    gate_hourly_series = [
        {
            "hour": h,
            "label": f"{h:02d}:00",
            "entries": gate_hourly[h].get("ENTRY", 0),
            "exits": gate_hourly[h].get("EXIT", 0),
            "total": gate_hourly[h].get("ENTRY", 0) + gate_hourly[h].get("EXIT", 0),
        }
        for h in range(24)
    ]
    peak_gate_hr = max(
        gate_hourly_series,
        key=lambda x: x["total"],
        default={"hour": 0, "label": "00:00", "total": 0},
    )

    # Warehouse vehicle status and shutter occupancy records.
    warehouse_status = Counter((r.get("status") or "UNKNOWN").strip().upper() for r in warehouse)
    shutter_counts = Counter(
        (r.get("docked_shutter") or "").strip().upper()
        for r in warehouse
        if (r.get("docked_shutter") or "").strip()
    )
    shutter_unassigned = sum(1 for r in warehouse if not (r.get("docked_shutter") or "").strip())
    warehouse_type_counts = Counter((r.get("vehicle_type") or "Unknown").strip().title() for r in warehouse)
    readable_warehouse_plates = sum(1 for r in warehouse if _clean_plate(r.get("license_plate")))

    day_warehouse_total: Counter[str] = Counter()
    day_warehouse_docked: Counter[str] = Counter()
    day_warehouse_parking: Counter[str] = Counter()
    docked_samples: list[dict[str, str]] = []
    parking_samples: list[dict[str, str]] = []

    for row in warehouse:
        upd = (row.get("updated_at") or row.get("entry_time") or "").strip()
        w_day = _date(row.get("updated_at")) or _date(row.get("entry_time"))
        st = (row.get("status") or "").strip().upper()
        v_type = (row.get("vehicle_type") or "Unknown").strip().title()
        cur_cam = (row.get("current_cam") or "—").strip().upper()
        shutter = (row.get("docked_shutter") or "Unassigned").strip().title()

        if w_day:
            day_warehouse_total[w_day] += 1
            if st == "DOCKED":
                day_warehouse_docked[w_day] += 1
            elif st in ("IN PARKING", "PARKED"):
                day_warehouse_parking[w_day] += 1

        if st == "DOCKED" and len(docked_samples) < 15:
            docked_samples.append({
                "updated_at": upd,
                "vehicle_type": v_type,
                "camera": cur_cam,
                "shutter": shutter,
                "status": "Docked",
            })
        elif st in ("IN PARKING", "PARKED") and len(parking_samples) < 15:
            parking_samples.append({
                "updated_at": upd,
                "vehicle_type": v_type,
                "camera": cur_cam,
                "status": "In parking" if st == "IN PARKING" else "Parked",
            })

    all_days = sorted(set(people_daily) | set(gate_daily) | set(day_warehouse_total))
    start_date = min(all_days) if all_days else None
    end_date = max(all_days) if all_days else None

    status_order = ["DOCKED", "AT DOCK", "IN PARKING", "PARKED", "IN YARD", "ENTERED", "EXITED"]
    status_labels = {
        "DOCKED": "Docked",
        "AT DOCK": "At dock",
        "IN PARKING": "In parking",
        "PARKED": "Parked",
        "IN YARD": "In yard",
        "ENTERED": "Entered",
        "EXITED": "Exited",
    }
    shutter_order = ["SHUTTER 1", "SHUTTER 2", "SHUTTER 3", "SHUTTER 4", "SHUTTER 5", "SHUTTER 6"]
    shutter_total = sum(shutter_counts.values())
    warehouse_total = len(warehouse)

    in_parking = warehouse_status.get("IN PARKING", 0)
    parked = warehouse_status.get("PARKED", 0)
    docked = warehouse_status.get("DOCKED", 0)

    people_daily_list = [
        {"date": d, "label": _pretty_day(d), "count": people_daily.get(d, 0)}
        for d in all_days
    ]
    peak_people_day = max(
        people_daily_list,
        key=lambda x: x["count"],
        default={"date": "", "label": "—", "count": 0},
    )

    daily_breakdown = []
    for d in all_days:
        p_cnt = people_daily.get(d, 0)
        g_in = gate_daily[d].get("ENTRY", 0)
        g_out = gate_daily[d].get("EXIT", 0)
        hourly_arr = [day_people_hourly[d].get(h, 0) for h in range(24)]
        gate_h_in = [day_gate_hourly[d][h].get("ENTRY", 0) for h in range(24)]
        gate_h_out = [day_gate_hourly[d][h].get("EXIT", 0) for h in range(24)]
        peak_h = max(range(24), key=lambda h: hourly_arr[h]) if any(hourly_arr) else 0
        daily_breakdown.append(
            {
                "date": d,
                "label": _pretty_day(d),
                "people_records": p_cnt,
                "multi_cam_records": day_people_multi.get(d, 0),
                "carried_item_records": day_people_carried.get(d, 0),
                "phone_usage_records": day_people_phone.get(d, 0),
                "people_hourly": hourly_arr,
                "gate_hourly_entries": gate_h_in,
                "gate_hourly_exits": gate_h_out,
                "people_peak_hour": f"{peak_h:02d}:00",
                "top_activities": [
                    {"name": act, "count": cnt}
                    for act, cnt in day_people_activities[d].most_common(5)
                ],
                "gate_entries": g_in,
                "gate_exits": g_out,
                "gate_total": g_in + g_out,
                "gate_diff": g_in - g_out,
                "gate_vehicle_types": [
                    {"name": vt, "count": cnt}
                    for vt, cnt in day_gate_types[d].most_common()
                ],
                "warehouse_records": day_warehouse_total.get(d, 0),
                "warehouse_docked": day_warehouse_docked.get(d, 0),
                "warehouse_parking": day_warehouse_parking.get(d, 0),
            }
        )

    top_hours_table = sorted(
        [
            {
                "hour_window": f"{h:02d}:00–{(h + 1) % 24:02d}:00",
                "people_count": people_hourly.get(h, 0),
                "gate_count": gate_hourly[h].get("ENTRY", 0) + gate_hourly[h].get("EXIT", 0),
                "share": round((people_hourly.get(h, 0) / people_total) * 100, 1) if people_total else 0.0,
            }
            for h in range(24)
        ],
        key=lambda x: x["people_count"],
        reverse=True,
    )[:10]

    return {
        "ok": True,
        "data_source": "CSV snapshot",
        "caution": CAUTION_TEXT,
        "period": {"from": start_date, "to": end_date, "days_with_data": len(all_days)},
        "files": [people_file, gate_file, warehouse_file],
        "people": {
            "tracked_records": people_total,
            "multi_cam_records": multi_cam_records,
            "multi_cam_share": round(multi_cam_records / people_total * 100, 1) if people_total else 0.0,
            "carried_item_records": carried_item_records,
            "carried_item_share": round(carried_item_records / people_total * 100, 1) if people_total else 0.0,
            "carried_items_breakdown": [
                {"name": name, "count": count} for name, count in carried_item_types.most_common(5)
            ],
            "phone_usage_records": phone_usage_records,
            "phone_usage_share": round(phone_usage_records / people_total * 100, 2) if people_total else 0.0,
            "phone_cameras": [{"name": name, "count": count} for name, count in phone_cameras.most_common()],
            "peak_hour": {
                "label": f"{peak_people_hr['hour']:02d}:00–{(peak_people_hr['hour'] + 1) % 24:02d}:00",
                "count": peak_people_hr["count"],
            },
            "peak_day": peak_people_day,
            "daily": people_daily_list,
            "hourly": people_hourly_series,
            "top_activities": top_activities,
            "entry_cameras": [{"name": name, "count": count} for name, count in entry_cameras.most_common()],
        },
        "gate": {
            "total_events": len(gate),
            "entries": gate_event_counts.get("ENTRY", 0),
            "exits": gate_event_counts.get("EXIT", 0),
            "net_event_difference": gate_event_counts.get("ENTRY", 0) - gate_event_counts.get("EXIT", 0),
            "peak_hour": {
                "label": f"{peak_gate_hr['hour']:02d}:00–{(peak_gate_hr['hour'] + 1) % 24:02d}:00",
                "count": peak_gate_hr["total"],
            },
            "vehicle_types": [{"name": name, "count": count} for name, count in gate_type_counts.most_common()],
            "daily": [
                {
                    "date": d,
                    "label": _pretty_day(d),
                    "entries": gate_daily[d].get("ENTRY", 0),
                    "exits": gate_daily[d].get("EXIT", 0),
                    "total": sum(gate_daily[d].values()),
                }
                for d in all_days
            ],
            "hourly": gate_hourly_series,
            "readable_plate_records": readable_gate_plates,
        },
        "warehouse": {
            "vehicle_records": warehouse_total,
            "docked_count": docked,
            "docked_share": round(docked / warehouse_total * 100, 1) if warehouse_total else 0.0,
            "in_parking_count": in_parking,
            "parked_count": parked,
            "parking_total": in_parking + parked,
            "parking_share": round((in_parking + parked) / warehouse_total * 100, 1) if warehouse_total else 0.0,
            "shutter_assigned_total": shutter_total,
            "shutter_unassigned_total": shutter_unassigned,
            "status_counts": [
                {
                    "name": status_labels[s],
                    "count": warehouse_status.get(s, 0),
                    "share": round(warehouse_status.get(s, 0) / warehouse_total * 100, 1) if warehouse_total else 0.0,
                }
                for s in status_order
                if warehouse_status.get(s, 0)
            ],
            "shutters": [
                {
                    "name": s.title(),
                    "count": shutter_counts.get(s, 0),
                    "share": round(shutter_counts.get(s, 0) / shutter_total * 100, 1) if shutter_total else 0.0,
                }
                for s in shutter_order
            ],
            "vehicle_types": [{"name": name, "count": count} for name, count in warehouse_type_counts.most_common()],
            "readable_plate_records": readable_warehouse_plates,
        },
        "daily_breakdown": daily_breakdown,
        "kpi_details": {
            "multi_cam_depth": [
                {"name": k, "count": multi_cam_depth.get(k, 0)}
                for k in ("1 camera", "2 cameras", "3 cameras", "4+ cameras")
                if multi_cam_depth.get(k, 0) > 0
            ],
            "multi_cam_samples": multi_cam_samples,
            "carried_samples": carried_samples,
            "top_hours": top_hours_table,
            "gate_entry_samples": gate_entry_samples,
            "gate_exit_samples": gate_exit_samples,
            "docked_samples": docked_samples,
            "parking_samples": parking_samples,
            "phone_records": phone_detail_rows,
        },
        "data_quality": {
            "gate_plate_readable": readable_gate_plates,
            "gate_plate_total": len(gate),
            "warehouse_plate_readable": readable_warehouse_plates,
            "warehouse_plate_total": warehouse_total,
            "caution": CAUTION_TEXT,
            "notes": [
                CAUTION_TEXT,
                "People totals count tracking records, not confirmed unique people.",
                "Warehouse vehicle totals count records across different vehicle states, not confirmed unique vehicles.",
                "Gate entry minus exit is an event-count difference, not a verified live yard balance.",
            ],
        },
    }


@bp.get("/")
def dashboard_home():
    return render_template("yolo_dashboard.html")


@bp.get("/api/summary")
def dashboard_summary():
    try:
        return jsonify(build_dashboard_data())
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 503
    except Exception:
        current_app.logger.exception("Could not build YOLO dashboard summary")
        return jsonify({"ok": False, "error": "Dashboard data could not be loaded. Check the server logs."}), 500


@bp.post("/api/assistant")
def dashboard_assistant():
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        return jsonify({"ok": False, "error": "AI assistant is not configured. Add GROQ_API_KEY to the server environment."}), 503

    body = request.get_json(silent=True) or {}
    question = str(body.get("message", "")).strip()
    if not question:
        return jsonify({"ok": False, "error": "Please enter a question."}), 400
    if len(question) > 1200:
        return jsonify({"ok": False, "error": "Please keep the question under 1,200 characters."}), 400

    try:
        context = build_dashboard_data()
    except Exception:
        current_app.logger.exception("Could not load data for the YOLO AI assistant")
        return jsonify({"ok": False, "error": "Dashboard data is not available for the assistant."}), 503

    # Send aggregate metrics only. Do not send person IDs, plate fields, snapshots or raw event rows.
    assistant_context = {
        "caution": context["caution"],
        "period": context["period"],
        "people": {
            "tracked_records": context["people"]["tracked_records"],
            "multi_cam_records": context["people"]["multi_cam_records"],
            "multi_cam_share": context["people"]["multi_cam_share"],
            "carried_item_records": context["people"]["carried_item_records"],
            "carried_item_share": context["people"]["carried_item_share"],
            "phone_usage_records": context["people"]["phone_usage_records"],
            "phone_usage_share": context["people"]["phone_usage_share"],
            "phone_cameras": context["people"]["phone_cameras"],
            "peak_hour": context["people"]["peak_hour"],
            "peak_day": context["people"]["peak_day"],
            "top_activities": context["people"]["top_activities"],
            "entry_cameras": context["people"]["entry_cameras"],
            "daily": context["people"]["daily"],
        },
        "gate": {
            "total_events": context["gate"]["total_events"],
            "entries": context["gate"]["entries"],
            "exits": context["gate"]["exits"],
            "net_event_difference": context["gate"]["net_event_difference"],
            "peak_hour": context["gate"]["peak_hour"],
            "vehicle_types": context["gate"]["vehicle_types"],
            "daily": context["gate"]["daily"],
            "readable_plate_records": context["gate"]["readable_plate_records"],
        },
        "warehouse": {
            "vehicle_records": context["warehouse"]["vehicle_records"],
            "docked_count": context["warehouse"]["docked_count"],
            "parking_total": context["warehouse"]["parking_total"],
            "in_parking_count": context["warehouse"]["in_parking_count"],
            "parked_count": context["warehouse"]["parked_count"],
            "status_counts": context["warehouse"]["status_counts"],
            "shutters": context["warehouse"]["shutters"],
            "shutter_unassigned_total": context["warehouse"]["shutter_unassigned_total"],
            "vehicle_types": context["warehouse"]["vehicle_types"],
        },
        "daily_breakdown": [
            {
                "date": d["date"],
                "people_records": d["people_records"],
                "multi_cam_records": d["multi_cam_records"],
                "carried_item_records": d["carried_item_records"],
                "phone_usage_records": d["phone_usage_records"],
                "gate_entries": d["gate_entries"],
                "gate_exits": d["gate_exits"],
                "warehouse_records": d["warehouse_records"],
                "warehouse_docked": d["warehouse_docked"],
                "warehouse_parking": d["warehouse_parking"],
            }
            for d in context["daily_breakdown"]
        ],
        "data_quality": context["data_quality"],
    }
    system_prompt = (
        "You are an AI Operations Assistant for a YOLO warehouse and CCTV analytics dashboard. "
        "Answer in simple, clear English using ONLY the supplied aggregate dashboard JSON.\n\n"
        "MANDATORY FORMATTING RULES:\n"
        "1. Structure every answer using clear bullet points (`- `).\n"
        "2. Highlight key labels, numbers, and main takeaways in **bold** (`**like this**`).\n"
        "3. Keep answers concise, scannable, and factual.\n\n"
        "MANDATORY DATA & CAUTION RULES:\n"
        "- If anyone asks about vehicle number plates, ANPR accuracy, or identifying the same vehicle across multiple cameras, you MUST clearly explain: "
        f"\"{CAUTION_TEXT}\"\n"
        "- Never invent a metric, event, person identity, vehicle identity, trend cause, or alert.\n"
        "- Clarify that totals are tracking/state records or crossing events, not verified unique people or unique vehicles.\n"
        "- The CSVs are snapshot exports, not guaranteed live feeds. If asked for data not present, state clearly that the available dashboard data does not show it.\n\n"
        "Dashboard data (JSON): " + json.dumps(assistant_context, ensure_ascii=False)
    )
    model = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b").strip()
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": question},
        ],
        "temperature": 0.2,
        "max_tokens": 650,
    }
    try:
        response = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=payload,
            timeout=35,
        )
        if response.status_code >= 400:
            current_app.logger.warning("Groq API returned %s: %s", response.status_code, response.text[:500])
            return jsonify({"ok": False, "error": "The AI service could not answer right now. Check the Groq model and API limits."}), 502
        result = response.json()
        answer = result["choices"][0]["message"]["content"].strip()
        return jsonify({"ok": True, "answer": answer, "model": model})
    except requests.RequestException:
        current_app.logger.exception("Groq API request failed")
        return jsonify({"ok": False, "error": "Could not reach the AI service. Please try again."}), 502
    except (KeyError, IndexError, ValueError):
        current_app.logger.exception("Unexpected Groq API response")
        return jsonify({"ok": False, "error": "The AI service returned an unexpected response."}), 502


def register_yolo_dashboard(app_or_server, auth_check=None):
    """Register /yolo routes on a Flask server or a Dash app's underlying server.

    Optional auth_check is a zero-argument callable. Return True for an authenticated
    request; False returns HTTP 401. Connect this to the authentication used by your app.
    """
    server = getattr(app_or_server, "server", app_or_server)
    if auth_check is not None:
        @bp.before_request
        def _require_authentication():
            if not auth_check():
                return jsonify({"ok": False, "error": "Sign in is required."}), 401
    if "yolo_dashboard" not in server.blueprints:
        server.register_blueprint(bp, url_prefix="/yolo")
    return bp
