# PrimeSight YOLO Dashboard — UI / coding prompt

Act as a senior product designer and senior Python/Flask frontend engineer. Design and implement a premium, futuristic, light-theme dashboard for PrimeSight's YOLO warehouse surveillance and operations platform.

## Product goal
Give managers a simple view of people movement, vehicle entry/exit, warehouse vehicle locations, loading-shutter activity and data quality. Use simple English. The interface should feel like a polished enterprise SaaS product, not a generic AI-generated admin template.

## Visual direction
- Light theme with soft off-white / pale blue-gray background.
- Futuristic glassmorphism: translucent white cards, subtle backdrop blur, fine borders, soft shadows and restrained ambient gradients.
- Primary accent: electric blue. Secondary accents: teal, violet and warm amber, used sparingly.
- Premium typography, balanced whitespace, consistent 8px spacing rhythm and clear hierarchy.
- Rounded cards (roughly 18–22px), small refined status pills and subtle hover lift.
- Use inline SVG icons for every icon. Do not use emojis.
- Use tasteful, short animations for page reveal, card hover, chart bars and button feedback. Respect `prefers-reduced-motion`.
- Fully responsive on desktop, tablet and mobile. Avoid horizontal overflow.

## Dashboard information architecture
1. Header: PrimeSight brand, breadcrumb, data period, refresh action and snapshot/live state.
2. KPI cards: people tracking records, active tracking records, vehicle entry events, vehicle exit events, vehicles docked, vehicles at dock, vehicles in parking and median completed people-tracking duration.
3. Charts: people tracking records by day; gate entries versus exits by day.
4. Warehouse operations: vehicle status distribution and loading-shutter counts.
5. People activity: most common detected activities, using short plain-English labels.
6. Data quality: readable number-plate count and an honest warning when plate values are missing/unreadable.
7. AI assistant: visible quick-question chips, a compact chat area and a clear loading/error state.

## Data and metric rules
- People CSV: `warehouse_person_visits.csv`.
- Gate events CSV: `gate_vehicle_events.csv`.
- Warehouse vehicle CSV: `warehouse_vehicle_visits.csv`.
- A people row is a tracking record, not proof of a unique person.
- A warehouse vehicle row is a vehicle-state record, not proof of a unique vehicle.
- Entry count minus exit count is an event-count difference, not a verified live vehicle balance.
- Do not claim ANPR accuracy or plate-read success from confidence values that are all zero or plate strings that are unreadable/pending.
- Do not use average vehicle stay duration when most duration values are zero.
- Clearly label the figures as CSV snapshot data unless connected to a real-time database/API.
- Never invent metrics, alerts, trend causes or unique identity counts.

## AI assistant
Use the Groq Chat Completions API from the Python backend only. Keep `GROQ_API_KEY` in a server environment variable. Never expose the key in browser JavaScript or HTML. Send aggregate KPI JSON only; do not send personal IDs, plate values, snapshots or raw events. Use short, simple English and make the assistant say when data does not support an answer. Include quick chips:
- Summarize this dashboard
- Vehicle movement
- Warehouse status
- People activity
- Data quality check

## Technical constraints
- Mount the feature at `https://primesight.utkarshconnect.com/yolo/` on the existing PrimeSight application and existing port 5012.
- Use a Flask Blueprint registered on the existing Flask server (or `dash_app.server` if the existing app is Dash).
- Do not create a second web server, replace `dashboard/main.py`, or change the existing Nginx proxy when the domain already forwards to the application.
- Use same-origin endpoints under `/yolo/api/summary` and `/yolo/api/assistant`.
- Preserve the existing login/authentication and protect both the page and its API routes.
- Keep the Groq model configurable with `GROQ_MODEL`.
- Use inline SVG icons and lightweight SVG charts; avoid emoji icons.
- Keep backend calculations testable and keep display labels separate from raw CSV values.
- Add useful loading, empty and error states.

Deliver clean, maintainable, production-minded code and explain exactly how to register it with the existing application without disturbing other PrimeSight modules.
