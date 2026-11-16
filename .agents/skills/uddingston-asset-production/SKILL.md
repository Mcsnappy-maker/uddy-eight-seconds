---
name: uddingston-asset-production
description: Use when creating, importing, styling, or reviewing 3D models, materials, kits, sticks, goalkeeper equipment, or venue assets for Uddingston Hockey Club.
---

# Uddingston Asset Production

Enforce accurate **outdoor field-hockey** equipment, **Uddingston Hockey Club** visual identity, clean 1:1 metric scale, and strict asset licensing provenance.

## Critical Equipment Standard (Field Hockey vs Ice Hockey)

NEVER reuse or mimic ice-hockey equipment. Every goalkeeper and attacker asset must pass these physical checks:

| Item | Required Field-Hockey Design | Forbidden Ice-Hockey Errors |
|---|---|---|
| **Footwear** | Studded synthetic turf shoes (both attacker & keeper) | Ice skates / steel blades |
| **Keeper Kickers** | Strapped high-density closed-cell foam kickers wrapping turf shoes | Skate boots or thin guards |
| **Keeper Leg Guards** | Rectangular chamfered foam pads with strap channels & wrap-around knee wings | Ice butterfly thigh-rise pads |
| **Keeper Left Hand** | Flat rectangular foam **hand protector / blocker** with thumb guard | Ice catcher / webbed glove |
| **Keeper Right Hand** | Stick-holding padded glove/mit keeping palm/fingers around stick handle | Oversized ice blocker |
| **Sticks** | Curved J-hook field-hockey stick (`~0.92–0.98m`), **flat left playing face**, rounded right back | Ice hockey L-blade stick, flat tape paddle |
| **Ball** | Dimpled Chalk-white spherical field-hockey ball (`r = 0.0365 m`) | Black vulcanized puck |
| **Pitch** | Water-based blue synthetic turf with white FIH markings & run-off perimeter | Ice rink, red/blue ice lines, Plexiglas boards |

## Uddingston Club Identity & Provisional Palette

- **Club Name:** Always spell **Uddingston Hockey Club** accurately.
- **Colours:** Verified blue and yellow/gold club identity. Until an official club vector brand sheet is supplied, use these **labelled provisional digital tokens** and never import Kelloch orange:
  - `Deep Blue`: `#123A78` (kit primaries, menus, turf accent)
  - `Gold`: `#F4C431` (trim, hoop accents, key focus states)
  - `Night`: `#091321` (interface backdrops)
  - `Chalk`: `#F7F9FC` (match ball, pitch markings, primary text)
  - `Slate`: `#A8B4C6` (secondary UI labels)
- **Label gaps honestly:** Mark procedural kits, fictional adult athletes, and the Uddingston-inspired ground as provisional until verified club assets/photos are integrated.

## Scale, Pivots & Licensing Rules

1. **1:1 Metric Units:** `1.0` scene unit = `1.0 metre`, Y-up (`y = 0` is pitch surface, `z = 0` is goal-line, `+z` points toward the 23 m line).
2. **Anatomical & Grip Integrity:** Athlete hands must visibly grip the stick handle with no broken wrists, floating feet (`foot y >= 0`), or stick passing through torso/legs.
3. **Zero-Cost Licensing Register:** Every external or generated asset (NPM package, texture, mesh, audio) must have an entry in `docs/asset-register/asset-and-licence-register.md` with creator, source URL, license (`Apache-2.0`, `MIT`, `CC0`, `Original Procedural`, etc.), and commercial/redistribution status.

## Validation Helper

Run the asset register validation script before closing an asset milestone:

```bash
python scripts/validate_asset_manifest.py <path-to-asset-register.md>
```
