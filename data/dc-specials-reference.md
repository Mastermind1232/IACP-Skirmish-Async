# Deployment Card Special Abilities Reference

This file lists the correct special ability names for each deployment card. Update `dc-stats.json` based on this reference.

## Instructions

- **RULE: Only list abilities with the arrow symbol (⚡ special action icon)**
- If it has the arrow → it's a special → add to `specials` array
- If it does NOT have the arrow → it's a passive/keyword → do NOT add
- Units can have 0, 1, or multiple special abilities
- Special ability names should match the card text exactly

## Figure count (group size)

- **Source:** The **grey notches/pips** in the **top-left** of the deployment card indicate how many figures are in that deployment group (1 notch = 1 figure, 2 = 2, 3 = 3).
- In `dc-stats.json`, set `"figures": N` to match the card. This drives deploy buttons (e.g. 3 figures → "1a", "1b", "1c") and health display per figure.
- The bot does not read card images; figure counts are maintained manually in `dc-stats.json` from the physical/Vassal card.

## Known Special Abilities

### Rebel

- **Luke Skywalker**: Saber Strike
- **Luke Skywalker (Jedi Knight)**: (TBD)
- **Rebel Trooper (Elite)**: (None - no special action)
- **Rebel Trooper (Regular)**: (None - no special action)

### Imperial

- **Darth Vader**: Force Choke (verify exact name)
- **Stormtrooper (Elite)**: (None - no special action)
- **Stormtrooper (Regular)**: (None - no special action)

### Mercenary

(TBD)

---

## How to Extract from Vassal Module

1. Open the `.vmod` file in VASSAL
2. Navigate to the deployment card images in `vassal_extracted/`
3. For each card, look for abilities with the special action icon (⚡ or similar)
4. Note the exact ability name and cost
5. Update this file and then `dc-stats.json`

## Alternate: Extract from IACP Document

The IACP Official Changes document may list card updates. Cross-reference with original FFG cards for base stats.
