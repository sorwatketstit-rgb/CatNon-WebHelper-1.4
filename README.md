# CatNon School Helper

A lightweight, Progressive Web App for students. Stores all data locally on the device (no account required). An internet connection is needed — the app is no longer offline-safe.

---

## AI Agent Entry Point & Startup Sequence

All AI agents working on this repository must start here and follow this exact sequence:

1. **Read this entry point:** [README.md](file:///d:/CatNonHelper/README.md) & [AGENTS.md](file:///d:/CatNonHelper/AGENTS.md)
2. **Read workflow rules & status:** [Context/Rules.md](file:///d:/CatNonHelper/Context/Rules.md) and [Context/Status.md](file:///d:/CatNonHelper/Context/Status.md)
3. **Inspect the Active Quest Board:** [Context/Agent-Handoff.md](file:///d:/CatNonHelper/Context/Agent-Handoff.md)
   - First read *only* the names, statuses, and owners of open tasks.
   - Do not scan entire archives or unrelated quest files.
4. **Read assigned or relevant Quest details:** Located under [Context/quests/](file:///d:/CatNonHelper/Context/quests/)
5. **Inspect source code or topic documents:** Only inspect files directly within the scope of the active task.

---

## Application Overview

### Files
- `index.html`: Main app. All UI, logic, and styles in one file
- `sw.js`: Service worker. Asset caching, and share target handling. Note: the app is NOT offline-safe — service worker only speeds up repeat loads; core libraries (Leaflet, PeerJS, jsPDF, three.js) may still require network access
- `manifest.json`: PWA manifest. Allows "Add to Home Screen" and system share sheet integration
- `icon.jpeg`: App icon

### Features
- **Home:** Displays storage usage via `navigator.storage.estimate()` and IndexedDB breakdown.
- **Gallery:** Organize photos into named albums, drag & drop upload, lightbox, custom album sort order.
- **Notes:** Rich-text note editor (Undo/Redo, Bold, Italic, font sizes, colors) with debounced auto-save.
- **Network Info:** Connection status, effective signal type, downlink speed, RTT latency, live throughput check.
- **Backtracker:** GPS path tracing on OpenStreetMap, snap-to-location, compass heading overlay.
- **FileDrop:** P2P file transfers via WebRTC (PeerJS) using a 4-character code.
- **Image to PDF:** Online image-to-PDF conversion (jsPDF loaded from CDN) with page reordering.
- **QR Code Generator:** QR generation with single-tap PNG export.

### Connectivity
This app is **no longer offline-safe**: core libraries (Leaflet, PeerJS, jsPDF, three.js) are partly loaded from CDN or ship local but expect network availability.

### Known Limitations
- Photos are stored as base64 in IndexedDB — large libraries may approach browser quota limits.
- Map tiles require an internet connection (no offline tile cache).
- FileDrop requires internet for the initial peer handshake.
- CDN libraries (Leaflet, PeerJS, jsPDF) fail when the device has no connectivity.
- No remote cloud sync (single-user, local-device architecture).
