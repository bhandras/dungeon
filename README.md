# Dungeon Blackout

A browser-based top-down dungeon survival shooter built with Three.js.

## Run locally

Because the game uses ES modules, serve the folder with a simple local web server and open `index.html` in your browser.

Examples:

```bash
cd dungeon_scroller
python -m http.server 8000
```

Then open `http://localhost:8000/`.

## Controls

- Move: `WASD`
- Aim: mouse
- Fire: left mouse
- Throw grenade: right mouse or `Space`
- Switch weapons: `1` to `5`
- Restart: `R`

## Notes

- The torch is a real Three.js spotlight with shadow casting enabled.
- A second lantern-style light around the player reveals nearby architecture and shadows.
- The minimap reveals only explored dungeon space and stays uncovered as you survive.
- The dungeon is procedurally generated.
- Pickups include health, ammo, grenades, and weapon crates.
