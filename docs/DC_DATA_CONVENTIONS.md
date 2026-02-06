# Deployment Card Data Conventions

When entering Deployment Card ability text in `dc-effects.json` (via the DC Effect Editor):

## Ability text

- **Use full card text** — Type out passives, abilities, and trait text as printed on the card.
- **Keywords in ALL CAPS** — Put keywords (e.g. MASSIVE, MOBILE) in all caps so they stand out and are easy to parse later.

## Keywords field

- Comma-separated list of keywords that affect rules (e.g. Massive, Mobile). These can drive movement, line-of-sight, or other automation. Sync with `data/dc-keywords.json` if you maintain that file separately.

## Related files

- **dc-stats.json** — Cost, health, figures, speed, attack, defense, specials (per card). Update from physical/Vassal card or IACP reference.
- **dc-keywords.json** — Keywords that affect rules (e.g. AT-ST → Massive). Used by the bot for movement/LOS.
- **dc-specials-reference.md** — Reference for special ability names (⚡ special action icon only).
