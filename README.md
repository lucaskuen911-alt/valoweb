# Hairline

A server-authoritative tactical FPS framework that runs in the browser. Zero runtime dependencies: a custom WebGL2 renderer, a 128-tick deterministic simulation, client prediction with reconciliation, lag-compensated hitscan, a data-driven weapon pipeline, procedural layered audio and a decoupled HUD. Ships with one map (Saltworks), four weapons, six attachments, three skins, four abilities and server-side bots.

```
node tools/build.mjs        # bundle src/ into dist/hairline.html (single file, ~330 KB)
node test/sim.test.mjs      # 31 headless gameplay/netcode tests
```

Open `index.html` in a desktop browser with WebGL2.

### Put it on GitHub Pages
1. Create a new GitHub repository and upload the contents of this folder (keep `.github/` and `.nojekyll`).
2. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to `main`. The workflow runs the tests, rebuilds `index.html` and publishes it to `https://<user>.github.io/<repo>/`.

No Actions? Choose **Source: Deploy from a branch**, branch `main`, folder `/ (root)`: the committed `index.html` is served as-is.

---

## 1. Architecture

```
            ┌──────────── CLIENT (browser main thread) ────────────────────────────┐
 mouse/kbd ─► Input ──► CameraRig (rotation applied same frame, never smoothed)    │
            │   │                                                                  │
            │   └─► UserCmd {seq, buttons, yaw, pitch, weapon, viewTime} ──────────┼──► Transport ──┐
            │           │                                                          │               │
            │           ▼                                                          │               ▼
            │   ClientPredictor ── runPlayerCmd() ◄── same pure code ─────────────┼──── AuthorityServer
            │           │  ▲ reconcile(ack, serverState) + silent replay          │      Simulation (128 Hz)
            │           │  └──────────────────────────── snapshots (64 Hz) ◄──────┼──────  players, bots,
            │           ▼                                                          │        rounds, smokes,
            │   predicted events ──► Presentation (Viewmodel, Fx, Audio)           │        lag-comp history
            │   server events ─────► Presentation + HudPresenter ─► Hud facade     │
            │   bot snapshots ─────► interpolation buffer ─► BotView               │
            └──────────────────────────────────────────────────────────────────────┘
```

Layer rules, enforced by import direction:

| Layer | May import | Never imports |
|---|---|---|
| `data/` | nothing | everything |
| `core/` | nothing | sim, render, ui |
| `sim/` | `core/`, `data/` | render, audio, ui, DOM, `window` |
| `net/` | `sim/`, `core/` | render, audio, ui |
| `presentation/` | `data/`, `sim/WeaponBuilder` (op format only) | gameplay state |
| `render/`, `audio/`, `ui/` | anything below | each other's internals (HUD only via `HudFacade`) |
| `client/` | everything (composition root) | — |

`sim/` and `net/` run unmodified in Node (that is what the tests do), so moving the authority to a real server is a transport swap, not a rewrite.

## 2. Source tree

```
hairline/
├─ README.md
├─ package.json
├─ tools/
│  ├─ build.mjs                 zero-dependency ES-module bundler -> dist/hairline.html
│  └─ template.html             HUD + menu markup and CSS
├─ test/
│  └─ sim.test.mjs              movement, recoil, netcode, lag comp, bots, round rules
├─ dist/
│  └─ hairline.html             single-file build
└─ src/
   ├─ main.js                   composition root, boot + fatal error screen
   ├─ core/                     engine-agnostic utilities
   │  ├─ MathUtil.js            clamp/damp/easing, critically-damped Spring
   │  ├─ Rng.js                 seeded mulberry32 + hash32 (shared by client and server)
   │  ├─ EventBus.js            pub/sub for presentation fan-out
   │  └─ ObjectPool.js          ring pools: FX never allocate in combat
   ├─ data/                     DATA ASSETS (the "ScriptableObjects")
   │  ├─ weapons.js             stats, spray patterns, recovery curves, ADS
   │  ├─ attachments.js         stat ops + presentation ops per attachment
   │  ├─ skins.js               presentation-only decorators
   │  ├─ presentation.js        weapon prefabs: model id, palette, audio/FX keys, reload timeline
   │  ├─ movement.js            speeds, accel/decel, counter-strafe, jump, hull
   │  ├─ abilities.js           C/Q/E/X definitions (ultimate reuses stat ops)
   │  ├─ rules.js               round timings, armour, hitboxes, bot difficulty
   │  ├─ surfaces.js            physical materials: tint, decal, particles, step/impact audio
   │  ├─ settings.js            default player settings and loadout
   │  └─ maps/saltworks.js      ASCII layout + legend, sun/sky/fog, signage, callouts
   ├─ sim/                      AUTHORITATIVE GAMEPLAY (pure, no DOM)
   │  ├─ UserCmd.js             button bits, command shape, edge detection
   │  ├─ MapCompiler.js         layout -> heightfield, ramps, zones, spawns, markers
   │  ├─ Heightfield.js         hull collision + exact DDA raycast (hitscan, LOS, bake)
   │  ├─ Movement.js            accel/friction, counter-strafe dead-zone, step/ramp snap
   │  ├─ Recoil.js              fixed pattern -> procedural, recovery, spread model
   │  ├─ WeaponBuilder.js       base stats + modifier ops -> effective stats
   │  ├─ PlayerState.js         replicated state shape
   │  ├─ PlayerController.js    one command: abilities -> movement -> weapon -> plant
   │  ├─ Hitscan.js             hitboxes, damage, falloff, armour, smoke occlusion
   │  ├─ Bots.js                hold/react/counter-strafe/burst AI, hearing
   │  └─ Simulation.js          world tick, rounds, lag-comp history, events
   ├─ net/
   │  ├─ Transport.js           ordered channel with latency + jitter (loopback)
   │  ├─ AuthorityServer.js     applies commands, ticks world, 64 Hz snapshots
   │  └─ ClientPredictor.js     predict, reconcile, replay, visual error decay
   ├─ presentation/
   │  └─ PresentationProfile.js decorator chain: prefab -> attachments -> skin
   ├─ render/
   │  ├─ gl/Mat4.js, gl/GLUtil.js, gl/MeshBuilder.js
   │  ├─ Shaders.js             world, depth pre-pass, lit, sky, decal, FX
   │  ├─ Renderer.js            pass order, culling, shadow pass, viewmodel pass
   │  ├─ LightBaker.js          per-vertex sky + sun + one-bounce bake, runtime probes
   │  ├─ MapGeometry.js         chunked, hidden-face-free environment mesh
   │  ├─ MapDecals.js           site paint, signage, elevation markers
   │  ├─ Textures.js            procedural surface, decal, FX and text atlases
   │  ├─ WeaponModels.js        procedural viewmodels with named sockets
   │  ├─ Viewmodel.js           hip/ADS, sway, bob, kick springs, equip/reload/inspect
   │  ├─ BotView.js             character meshes, gait, death, x-ray reveal
   │  └─ Fx.js                  tracers, impacts, casings, smokes, pulses, decals
   ├─ audio/
   │  ├─ Synth.js               offline DSP primitives
   │  ├─ SoundBank.js           recipes: 3-layer reports, foley, feedback, UI
   │  └─ AudioEngine.js         voices, pan/distance/air absorption/occlusion
   ├─ client/
   │  ├─ Input.js               raw pointer lock, coalesced deltas, latched presses
   │  ├─ CameraRig.js           view, punch, FOV transitions, step smoothing
   │  └─ GameClient.js          frame loop and wiring
   └─ ui/
      ├─ HudFacade.js           the HUD interface + DOM implementation
      ├─ HudPresenter.js        game state -> facade calls
      ├─ Minimap.js             cached static layer + dynamic markers
      ├─ Menu.js                play / loadout / settings / field manual
      └─ Settings.js            guarded localStorage profile
```

### Production asset tree (engine port)

The `data/` files map one-to-one onto engine data assets. When moving to Unreal (Primary Data Assets) or Unity (ScriptableObjects), keep gameplay data and presentation references in separate assets exactly as here:

```
Content/                                   (Unity: Assets/)
├─ Core/                     Tick, RNG, pools, event channels
├─ Data/
│  ├─ Weapons/               DA_Weapon_Halberd ...       (stats, patterns, recovery curves)
│  ├─ Attachments/           DA_Att_Suppressor ...       (StatOps[], PresentationOps[])
│  ├─ Skins/                 DA_Skin_Glacier ...         (PresentationOps[] only)
│  ├─ Abilities/             DA_Ability_Haze ...
│  ├─ Movement/              DA_Movement_Default
│  ├─ Surfaces/              PM_Plaster, PM_Metal ...    (physical materials)
│  └─ Rules/                 DA_Round_Standard, DA_BotDifficulty_*
├─ Presentation/
│  ├─ Weapons/<Weapon>/      SK_ mesh, ABP_ anim, sockets: Muzzle, Eject, Sight, MagWell, LeftHand
│  │   ├─ Animations/        Equip, Reload (with notifies at MagOut/MagIn/Bolt), Inspect_Tilt/Spin/Flip
│  │   ├─ Audio/             Click, Boom, Tail (+ Suppressed set), Reload foley
│  │   └─ FX/                Muzzle_Standard/Suppressed/Ported, Tracer, Casing
│  ├─ Skins/<Skin>/          Material instances, tracer + impact FX, reload/kill audio layers
│  ├─ Characters/            Agent meshes, x-ray material
│  └─ Impacts/<Surface>/     Decals, particles, impact + footstep audio
├─ Maps/Saltworks/
│  ├─ Geometry/              blockout -> art pass, collision kept as simple volumes
│  ├─ Lighting/              baked lightmaps, light probes for dynamic objects
│  └─ Gameplay/              plant zones, spawns, callout volumes, elevation markers
└─ UI/
   ├─ HUD/                   facade implementation (UMG / UI Toolkit)
   └─ Menus/
```

## 3. Systems

### Movement and camera (`sim/Movement.js`, `client/CameraRig.js`)
- Run 6.75 m/s, walk 3.75 (silent), crouch 2.6. Ground accel 72 m/s², decel 92 m/s²: top speed in 94 ms, release-to-accurate in 55 ms (tested).
- Counter-strafe dead-zone: velocity is integrated per local axis. When input opposes velocity on an axis, that axis is zeroed on that tick. Below 27% of run speed the player is "standing" and fires at base accuracy (tested: 6.75 → 0.56 m/s in one tick, spread exactly 0.25°).
- Square hull vs heightfield with contact bisection (flush against walls), 0.45 m step-up, ramp and step snapping, mantle onto 1.1 m cover.
- Camera rotation is applied from raw counts on the frame they arrive (0.07°/count × sensitivity, ADS scaled by zoom). Position is interpolated between 128 Hz ticks. Head-bob is a 12 mm vertical, step heights are smoothed, landings dip on a critically damped spring. Horizontal FOV 103°, ADS zoom eases out cubic over each weapon's `ads.time` (100–260 ms).

### Recoil and spread (`sim/Recoil.js`, `data/weapons.js`)
- `recoil.pattern`: fixed [yaw, pitch] increments for the opening shots (10 on the Halberd). Learnable, identical every spray.
- After the pattern: `pitchPerShot × max(0.12, 1 − climb/pitchMax)` so climb flattens; horizontal = persistent drift (flips with `driftFlipChance`) + seeded random. Seeds are `hash(playerSeed, shotSeq)`, so the server reproduces the client's exact shot (tested).
- Camera shows `viewKick` (45%) of the offset; the rest must be pulled down by the player.
- Recovery waits `max(recoveryDelay, 1.2 × fire interval)` (never mid-spray), then rewinds the spray index at `recoveryRate` shots/s and decays the offset with `offsetHalfLife`.
- Spread = base (ADS/crouch multipliers, scoped sniper → 0) + movement (lerp walk→run above the accurate threshold) + air + spray bloom.

### Weapons, attachments, skins (`sim/WeaponBuilder.js`, `presentation/PresentationProfile.js`)
One op format for everything: `{ path, op: mul | add | set | push | scalePattern, value }`.
- Attachments carry `stats` (read only by the sim) and `presentation` (read only by presentation). One per slot, validated on both sides.
- Skins are decorators with presentation ops only: palette, tracer and muzzle tint, `inspect` clip (`tilt` / `spin` / `flip`), extra reload audio layers keyed to the reload timeline, kill audio layer, impact particle extra (`frost` / `embers`). No base class or weapon definition changes.
- The ultimate (Overclock) is the same op list applied as a temporary stat table.

### Feedback loop (`client/GameClient.js#onLocalEvent`)
A predicted `shot` event fires on the tick the trigger is processed, and in that same frame: layered audio (click + boom + tail, all `start()`ed on the same audio-clock instant from pre-rendered buffers), viewmodel kick springs and muzzle flash (35 ms sprite + point light on world and weapon), camera punch, casing ejection from the `Eject` socket (bounces play surface-specific tinkles), tracer from the `Muzzle` socket, surface impact (decal + particles + impact sound by physical material). Hitmarkers, damage numbers and kill confirmation come from the authority. Remote shots add distance delay (d/343), air-absorption low-pass, stereo pan and wall occlusion.

### Environment and lighting (`data/maps/saltworks.js`, `render/LightBaker.js`)
- Saltworks: 96 × 80 m on a 2 m grid. Two 4 m chokes from A/B Main, A Link and B Link off mid (offset so there is no cross-map line), mid catwalk at +1.2 m, A Heaven and B Tower at +2.5 m with ramps, hatched plant zones, painted elevation markers and wayfinding signage, a 10 cm grid spray wall and strafing dummies in spawn.
- Bake: every environment vertex stores sky irradiance with one sun bounce (10 cosine-weighted rays) and a soft sun term (3 jittered shadow rays). ~49k vertices, ~760k rays, ~300 ms at load.
- Runtime: only characters render into a 2048² shadow map; the world shader multiplies that into the baked sun term so dynamic shadows sit naturally in baked light. Characters and the viewmodel use per-object light probes (sun visibility + sky openness).

### Rendering performance (`render/Renderer.js`)
- Environment split into 16 m chunks × surface: frustum culled, sorted by texture.
- Depth pre-pass with an invariant position path, then colour with `LEQUAL` and depth writes off: each environment pixel is shaded once.
- Shaders are one texture fetch + multiply-add + shadow lookup + fog; muzzle light is a uniform (no permutations, no recompiles).
- WebGL2 context with `desynchronized: true`, MSAA, sRGB textures with mips and anisotropy, shadow texel snapping, render scale setting.
- Zero per-frame allocation in FX hot paths (ring pools, preallocated vertex arrays).
- Perf overlay (`` ` ``): FPS, CPU frame time, draw calls, triangles, chunks visible, tick rate, measured RTT, prediction error, audio output latency.

### HUD (`ui/HudFacade.js`)
The facade interface is documented at the top of the file. `HudPresenter` is the only caller and the only place formatting happens. Every setter is dirty-checked, so pushing state each frame costs nothing when nothing changed. Shows health/armour, ammo/reserve/reload, round timer and score, hostiles remaining, ability charges/cooldowns/ult points, minimap with callout, plant progress, scope overlay, damage direction, hitmarkers, damage numbers, kill feed.

### Networking (`net/`)
- Clients send intent only. The authority runs every `UserCmd` through the same `runPlayerCmd()` the client predicted with, ticks the world at 128 Hz and sends 64 Hz snapshots with the acknowledged sequence.
- Reconciliation rebuilds from the server state and silently replays unacknowledged commands; residual error becomes a visual offset decaying over ~55 ms. Teleports (>2 m) snap. Measured error under 140 ms RTT + 25 ms jitter: 0 (bit-exact; tested).
- Lag compensation: the server keeps 1 s of bot pose history and tests each shot against poses interpolated at the shooter's `viewTime` (tested: hit lands on a target that has moved 0.39 m since that snapshot).
- Bots are rendered from a snapshot interpolation buffer (2 snapshots + jitter allowance).
- Server-owned fields (health, armour, alive, ult points) are never trusted from prediction.

## 4. Implementation steps (from here to production)

1. **Dedicated server.** Run `sim/` + `net/AuthorityServer.js` in Node. Replace `Transport.Channel` with WebTransport datagrams (unreliable commands, redundant last-3 commands per packet) plus a reliable stream for events. Keep the message shapes.
2. **Snapshot compression.** Quantise positions (1 mm) and angles (16-bit), delta-encode against the last acked snapshot, send only changed fields.
3. **Multiple players.** `Simulation` already keys players by id; extend lag-comp history to players and add per-player interest management (PVS from the heightfield).
4. **Anti-cheat posture.** Validate command rate and `dt`, clamp angle deltas, cap `viewTime` rewind (already clamped to the 1 s window), never accept state from clients.
5. **Art pass.** Swap procedural meshes/textures for authored assets behind the same IDs and sockets (`WeaponModels` socket contract, `SURFACES.texture`, `presentation.js` keys). Bake real lightmaps offline; keep probes for dynamic objects.
6. **Audio.** Replace synthesized buffers with recorded layers using the same names; keep the three-layer report and the voice caps.
7. **Map tooling.** The ASCII layout is a blockout format; add an editor export that writes the same compiled heightfield + zone data so collision stays exact.
8. **Off-main-thread.** Move the authority and light baking into a Worker (`sim/` has no DOM dependency).

## 5. Extending

- **New weapon:** add an entry to `data/weapons.js` (stats + pattern), a prefab in `data/presentation.js`, a model function in `render/WeaponModels.js` with the five sockets. Add it to `WEAPON_ORDER` and `Input.WEAPON_KEYS`.
- **New attachment:** add to `data/attachments.js` with `stats` and `presentation` ops. If it adds geometry, handle its `model.parts` id in `WeaponModels.buildAttachments`.
- **New skin:** add presentation ops to `data/skins.js`. Nothing else.
- **New map:** author a layout + legend like `saltworks.js`; everything else (collision, mesh, bake, minimap, decals, spawns) is derived.

## 6. Limits of this build
- Single human player against server-side bots; the loopback server runs on the main thread.
- Bullets do not penetrate walls; hitboxes are capsule-approximating boxes and a head sphere.
- Procedural placeholder art and audio stand in for authored assets.
- Needs a desktop browser with WebGL2, keyboard and mouse. Ctrl-crouch only works in fullscreen (keyboard lock); `V` always works.
