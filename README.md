# Dungeon Blackout

A browser-based top-down dungeon survival shooter built with Three.js.

Source repository: https://github.com/bhandras/dungeon

If GitHub Pages is enabled for the repository, the game can be hosted directly from the `main` branch root at:

https://bhandras.github.io/dungeon/

## Run locally

Because the game uses ES modules, serve the folder with a simple local web server and open `index.html` in your browser.

Examples:

```bash
cd dungeon
python -m http.server 8000
```

Then open `http://localhost:8000/`.

## Controls

### Touch

- Drag the left stick to move.
- Drag the right stick to aim and keep it held to fire. Release to stop firing and keep your last aim direction.
- Tap **Grenade** to throw in your current aim direction, or **Swap** to cycle unlocked weapons.
- Tap **Map** to toggle exploration or **Pause** to resume or restart from the menu.
- Play in portrait or landscape. Leaving the tab pauses a run.

### Keyboard and mouse

- Move: `WASD`
- Aim: mouse
- Fire: left mouse
- Throw grenade: right mouse or `Space`
- Cycle weapons: `Q`
- Switch directly: `1` to `5`
- Restart: `R`
- Pause or resume: `Esc`

## Notes

- The title screen uses ImageGen concept art for the Explorer and dungeon creatures. The in-game models are faceted 3D meshes built in Three.js.

- The torch uses a long forward cone with softer spill around the player.
- Weapons use layered projectile, glow, shockwave, and particle effects.
- The minimap reveals only explored dungeon space and stays uncovered as you survive.
- The dungeon is procedurally generated.
- Pickups include health, ammo, grenades, and weapon crates.
