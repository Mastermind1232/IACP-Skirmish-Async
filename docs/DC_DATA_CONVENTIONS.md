# Deployment Card Data Conventions

When entering Deployment Card ability text in `dc-effects.json` (via the DC Effect Editor):

**Updated card images:** When given an updated card image for a DC, fully read the card and update all fields (image file, dc-effects, dc-images path if needed, dc-stats if used)—unless the user says otherwise. Do not do a partial update (e.g. image only).

**Unique for card effects:** A DC is considered unique if there is only one copy in the deck and that DC has only one figure in its DG. See `CC_DATA_CONVENTIONS.md` for the full definition used by all card effects.

## Ability text

- **Use full card text** — Type out passives, abilities, and trait text as printed on the card.
- **Keywords in ALL CAPS** — Put keywords (e.g. MASSIVE, MOBILE) in all caps so they stand out and are easy to parse later.
- **Ranged and Melee** — Always capitalize when used in ability text: "Ranged attack", "Melee attack", "during a Ranged attack", etc.

## Keywords field

- Comma-separated list of keywords that affect rules (e.g. Massive, Mobile). These can drive movement, line-of-sight, or other automation. Sync with `data/dc-keywords.json` if you maintain that file separately.

## Surge abilities

- **surgeAbilities** — Array of surge options that cost 1 surge each (e.g. `"damage 1"`, `"blast 2"`).
- **doubleSurgeAbilities** — Array of surge options that cost 2 surges each. Use the same value strings as single surges (e.g. `"blast 3 (2 surges)"`). Edited in the DC Effect Editor under "Double surge abilities (2 surges)".

## Related files

- **dc-stats.json** — Cost, health, figures, speed, attack, defense, specials (per card). Update from physical/Vassal card or IACP reference.
- **dc-keywords.json** — Keywords that affect rules (e.g. AT-ST → Massive). Used by the bot for movement/LOS.
- **dc-specials-reference.md** — Reference for special ability names (⚡ special action icon only).
