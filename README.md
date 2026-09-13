# SUSPECT — 3D social deduction in the browser

A first-person, voice-chat social deduction game for 4–10 players. No game server, no binary assets:
every mesh is built from Three.js primitives, every texture is drawn to a canvas at runtime, every sound
is synthesized with the Web Audio API, and networking is peer-to-peer over WebRTC (PeerJS for signaling).

**Play:** https://sburrell23.github.io/Suspect/

## How to play

1. One player clicks **Create room** and shares the 6-character code.
2. Everyone else enters the code and clicks **Join**. Click **Enable microphone** in the lobby (optional — the game works text-only with `T`).
3. The host picks the map and settings, then **Start game** (4+ players; append `?dev` to the URL to allow fewer while testing).

| Key | Action |
| --- | --- |
| `WASD` / `Shift` | Move / sprint |
| Mouse | Look (click the view to capture the pointer, `Esc` to release) |
| `E` | Use: task station, fix panel, emergency button |
| `R` | Report body |
| `Q` | Kill (impostor) |
| `F` | Enter / exit vent (impostor; the Orbital Ring's Zero-G Spine is a public vent) |
| `C` | Sabotage menu (impostor) |
| `Tab` | Player list, per-player volume and mute |
| `T` | Text chat |
| `V` | Push-to-talk (when enabled in settings) · `M` mute mic |
| `Space` / `Ctrl` | Fly up / down (ghosts, Zero-G Spine) |

Crewmates win by finishing every task or ejecting every impostor. Impostors win when they equal the
living crew, or when a Reactor / O2 sabotage timer runs out.

## Maps

- **The Foundry** — vertical. Three stacked levels around a molten shaft; grating catwalks let you see
  two floors down. The shaft flares periodically (host-synchronized) — "I saw you during the flare."
- **Orbital Ring** — curved. A genuine 360° ring corridor: nothing is visible at range, people rise into
  view around the bend. Rooms hang off the ring; the central Zero-G Spine has no gravity.
- **The Greenhouse** — occlusion. A seeded hedge maze, a bioluminescent cavern (vision halved), and an
  elevated observation walk. You will hear people you cannot see.

Adding a map is one data file in `src/world/levels/` — see `lobby.js` for the smallest example.

## Development

```bash
npm install
npm run dev      # http://localhost:5173/Suspect/
npm run build    # static output in dist/
```

Deploys to GitHub Pages from `main` via `.github/workflows/deploy.yml`.

### Operator notes

- **TURN.** `src/config.js` ships with STUN only. Roughly 10–15% of friend groups will have one person
  behind a symmetric NAT who cannot connect without TURN. Drop credentials from a free tier (Metered,
  Twilio, Cloudflare) into `ICE_SERVERS`.
- **Signaling.** The public PeerJS broker is rate-limited. Set `PEER_SERVER` to a self-hosted
  `peerjs-server` for anything serious; run one locally while developing.
- **Trust.** The host's browser holds the authoritative state, including the impostor list. Play with
  friends, or have a non-player host. Nothing here is cryptographically protected — the threat model is
  "friends being annoying."
- **Base path.** `vite.config.js` uses `/Suspect/` for GitHub Pages. Set `VITE_BASE=/` to build for a
  root domain.

## Architecture

```
src/
  config.js            ICE/TURN, tuning constants, all magic numbers
  net/                 PeerJS mesh (2 channels per peer), binary snapshots, prediction, interpolation
  game/                hostLogic.js is authoritative; clientLogic.js mirrors it; roles/tasks/voting/sabotage
  world/               LevelBuilder (data -> merged meshes + AABB colliders), collision, fog-of-war pass,
                       procedural props & canvas textures, levels/
  entities/            procedural characters, local controller, remote interpolation, dead bodies
  voice/               per-peer Web Audio graph, proximity panning, occlusion, faction gating
  audio/               synthesized SFX, step-sequencer music, procedural reverb
  minigames/           ten task minigames + four sabotage fix panels (2D canvas)
  ui/                  DOM overlays: menu, lobby, HUD, meeting, player list, settings
```

- Host and clients run the same fixed-step (20 Hz) movement simulation. Clients predict locally and
  reconcile against the host's acked tick, smoothing corrections over 150 ms.
- Snapshots go out at 15 Hz on an unordered channel as 12 bytes per player; inputs go up at 20 Hz
  carrying the last three ticks for loss redundancy.
- Vision is a depth-based post-process: pixels beyond the vision radius go black, and remote player
  meshes beyond the radius are not rendered at all (with a 1 m hysteresis band).
- Voice: each remote stream is attached to a muted, playing `<audio>` element (required on Chromium),
  then routed source → faction gate → volume → occlusion filter → PositionalAudio (round) or straight
  to the bus (meetings). Living players never receive ghost audio; this is gated at the gain node and
  re-verified every frame.

### Known deviations from the design spec

- **Orbital Ring gravity** is straight down everywhere (the spec's re-oriented up-vector torus was
  shipped as its own stated fallback). The curvature is horizontal — a true 360° ring corridor built
  from ~160 curved segments with matching colliders — which delivers the "rises into view" sightline.
- **Snapshot record** is 12 bytes, not 10: a `u16 ackTick` was added so clients can reconcile
  prediction against the last input the host processed.
- **Room culling** is by distance to each zone's bounding box (everything beyond the vision radius is
  black anyway) rather than portal line-of-sight through the room graph.
- **Coolant Purge** holds one valve with the mouse and the other with `Space`, since a mouse has one
  pointer.
- PeerJS's `reliable: false` only disables ordering on the data channel; retransmits are not disabled.

## License

MIT
