#!/usr/bin/env python3
"""Import Nick Hansen's per-map LOS data into data/nick-los.json.

Kept SEPARATE from data/map-spaces.json so the in-browser map tool (which
re-serializes map-spaces.json on save) can never strip the LOS data.

For every map we have, this script:
  1. Finds the matching Nick JSON in /tmp/ia-los-ref/ia-los/maps/.
  2. Auto-discovers the (col, row) ↔ (x, y) transform by matching
     `blocking` (and `spireTiles`) cells between Nick's data and ours.
  3. Verifies the transform reproduces ALL Nick blocking + spire tiles.
  4. Writes Nick's raw walls / blocking / off-map / intersections into
     data/nick-los.json under the map id.

Transform model (linear, axis-flipping):
  nick.x = a * row + b   with  a ∈ {-1, +1}
  nick.y = c * col + d   with  c ∈ {-1, +1}

We try all 4 sign combinations × pick a candidate (b, d) from one matched
tile, then verify every Nick tile maps to a known cell in ours. The first
combination that maps every Nick blocking+spire tile to one of OUR
blocking+spire tiles wins.

src/data-loader.js merges this file into each map record at load time as
mapSpaces.nickLos. spatial.js consumes that field directly.
"""
import json
import os
import sys
from itertools import product

NICK_REPO = '/tmp/ia-los-ref/ia-los/maps'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUR_MAPS = os.path.join(ROOT, 'data', 'map-spaces.json')
OUT_PATH = os.path.join(ROOT, 'data', 'nick-los.json')

# Map id → Nick filename. Keys are our map ids; values are filenames in
# /tmp/ia-los-ref/ia-los/maps/. Set to None to skip a map (no Nick data).
NICK_FILENAMES = {
    '30th-floor-plaza':           '30th_Floor_Plaza.json',
    'anchorhead-cantina-bar':     'Anchorhead_Cantina.json',
    'bespin-tibanna-facility':    'Bespin_Tibanna_Facility.json',
    'chopper-base-atollon':       'Chopper_Base_Atollon.json',
    'climate-research-camp':      'Climate_Research_Camp.json',
    'corellian-underground':      'Corellian_Underground.json',
    'coruscant-back-alleys':      'Coruscant_Back_Alleys.json',
    'coruscant-landfill':         'Coruscant_Landfill.json',
    'coruscant-senate-office':    'Coruscant_Senate_Office.json',
    'devaron-garrison':           'Devaron_Garrison.json',
    'development-facility':       'Development_Facility.json',
    'the-dune-sea':               'The_Dune_Sea.json',
    'echo-base':                  'Echo_Base.json',
    'endor-defense-station':      'Endor_Defense_Station.json',
    'endor-wilderness':           'Endor_Wilderness.json',
    'geonosis-foundry':           'Geonosis_Foundry.json',
    'hangar-bay':                 'Hangar_Bay.json',
    'hoth-battle-station':        'Hoth_Battle_Station.json',
    'hoth-weather-shelter':       'Hoth_Weather_Shelter.json',
    'imperial-command-hub':       'Imperial_Command_Hub.json',
    'imperial-labor-camp':        'Imperial_Labour_Camp.json',
    'imperial-research-lab':      'Imperial_Research_Lab.json',
    'imperial-space-station':     'Imperial_Space_Station.json',
    'imperial-tower':             'Imperial_Tower.json',
    'isb-headquarters':           'ISB_Headquarters.json',
    'isb-training-grounds':       'ISB_Training_Grounds.json',
    'jabba-s-palace':             'Jabbas_Palace.json',
    'kashyyyk-station':           'Kashyyyk_Station.json',
    'kuat-space-station':         'Kuat_Space_Station.json',
    'lothal-battlefront':         'Lothal_Battlefront.json',
    'lothal-safehouse':           'Lothal_Safehouse.json',
    'lothal-spaceport':           'Lothal_Spaceport.json',
    'lothal-wastes':              'Lothal_Wastes.json',
    'massassi-ruins':             'Massassi_Ruins.json',
    'moisture-farm':              'Moisture_Farm.json',
    'mos-eisley-back-alleys':     'Mos_Eisley_Back_Alleys.json',
    'mos-eisley-cantina':         'Mos_Eisley_Cantina.json',
    'mos-eisley-outskirts':       'Mos_Eisley_Outskirts.json',
    'nal-hutta-swamps':           'Nal_Hutta_Swamps.json',
    'nelvaanian-war-zone':        'Nelvaanian_Warzone.json',
    'ord-mantell-junkyard':       'Ord_Mantell_Junkyard.json',
    'the-pit-of-carkoon':         'The_Pit_of_Carkoon.json',
    'sewers-of-nar-shaddaa':      'Sewers_of_Nar_Shaddaa.json',
    'tarkin-initiative-labs':     'Tarkin_Initiative_Labs.json',
    'training-ground':            'Training_Ground.json',
    'tython-meditation-field':    'Tython_Meditation_Field.json',
    'uscru-entertainment-district': 'Uscru_Entertainment_District.json',
    'wasskah-hunting-ground':     'Wasskah_Hunting_Ground.json',
    'wasteland-outpost':          'Wasteland_Outpost.json',
    # 3-/4-player variants — Nick has Hoth_Battlefield, Nal_Hutta_Borderlands,
    # Temple_Gardens; the other two don't ship with his repo.
    'hoth-battlefield-4-player':  'Hoth_Battlefield.json',
    'nal-hutta-borderlands-4-player': 'Nal_Hutta_Borderlands.json',
    'temple-gardens-4-player':    'Temple_Gardens.json',
    'b-omarr-subterranean-passageways-3-player': None,
    'scarif-imperial-hotel-3-player': None,
}


def parse_coord(s):
    s = s.lower()
    return (ord(s[0]) - 97, int(s[1:]) - 1)  # (col, row)


def find_transform(our_map, nick):
    """Return a transform that aligns Nick's grid with ours.

    Output format:
      {
        'x': { 'from': 'col'|'row', 'scale': -1|1, 'offset': int },
        'y': { 'from': 'col'|'row', 'scale': -1|1, 'offset': int },
      }
    Forward: x = scale_x * (col or row) + offset_x; same for y.

    Tries all 8 axis-preserving grid isometries: x and y each derived
    from {col, row} × {-1, +1}. Scored by topology match (off-map vs
    playable cells) with hard 1-1 gates on blocking + spire tiles.
    """
    nick_blocking = [(t['x'], t['y']) for t in nick.get('blockingTiles', [])]
    nick_spire    = [(t['x'], t['y']) for t in nick.get('spireTiles', [])]
    nick_offmap   = [(t['x'], t['y']) for t in nick.get('offMapTiles', [])]
    nick_W = nick.get('width')
    nick_H = nick.get('height')

    our_blocking = set(s.lower() for s in our_map.get('blocking', []))
    our_spire    = set(s.lower() for s in our_map.get('spireTiles', []))
    our_spaces   = set(s.lower() for s in our_map.get('spaces', []))

    nick_offmap_set   = set(nick_offmap)
    nick_blocking_set = set(nick_blocking)
    nick_spire_set    = set(nick_spire)

    nick_anchors = nick_blocking + nick_spire
    our_anchors  = list(our_blocking | our_spire)
    if not nick_anchors or not our_anchors:
        nick_anchors = [(0, 0), (nick_W - 1, 0), (0, nick_H - 1), (nick_W - 1, nick_H - 1)]
        our_anchors = list(our_spaces)
        if not our_anchors:
            return None

    def coord_str(col, row):
        if col < 0 or row < 0: return None
        return chr(97 + col) + str(row + 1)

    def apply_forward(t, col, row):
        """Compute (x, y) from (col, row) under transform t."""
        ax = t['x']; ay = t['y']
        x = ax['scale'] * (col if ax['from'] == 'col' else row) + ax['offset']
        y = ay['scale'] * (col if ay['from'] == 'col' else row) + ay['offset']
        return x, y

    def apply_inverse(t, nx, ny):
        """Recover (col, row) from Nick (nx, ny). Returns None if non-integer
        or if the transform isn't a valid invertible one (e.g., x and y
        both derived from the same axis)."""
        ax = t['x']; ay = t['y']
        if ax['from'] == ay['from']: return None  # degenerate
        # Solve: nx = sx * P_x + ox, ny = sy * P_y + oy, where P_x ∈ {col, row}.
        if ax['from'] == 'row':
            row_val = (nx - ax['offset']) // ax['scale']
            col_val = (ny - ay['offset']) // ay['scale']
            row_rem = (nx - ax['offset']) % ax['scale']
            col_rem = (ny - ay['offset']) % ay['scale']
        else:
            col_val = (nx - ax['offset']) // ax['scale']
            row_val = (ny - ay['offset']) // ay['scale']
            col_rem = (nx - ax['offset']) % ax['scale']
            row_rem = (ny - ay['offset']) % ay['scale']
        if row_rem != 0 or col_rem != 0: return None
        return col_val, row_val

    def score(t):
        s = 0
        for nx in range(nick_W):
            for ny in range(nick_H):
                inv = apply_inverse(t, nx, ny)
                if inv is None: return -10**9
                col, row = inv
                cs = coord_str(col, row)
                if cs is None: return -10**9
                is_off = (nx, ny) in nick_offmap_set
                in_spaces = cs in our_spaces
                if is_off and not in_spaces: s += 1
                elif (not is_off) and in_spaces: s += 1
                if (nx, ny) in nick_blocking_set and cs in our_blocking: s += 5
                if (nx, ny) in nick_spire_set and cs in our_spire: s += 10
                if is_off and in_spaces: s -= 1
                if (not is_off) and not in_spaces: s -= 1
        return s

    def all_anchors_map(t, nick_anchors_list, our_anchor_set):
        """Strict 1-1: every Nick anchor must map to a unique coord in
        our_anchor_set. Reject the transform if any anchor fails."""
        seen = set()
        for nx, ny in nick_anchors_list:
            inv = apply_inverse(t, nx, ny)
            if inv is None: return False
            col, row = inv
            if col < 0 or row < 0: return False
            cs = coord_str(col, row)
            if cs is None or cs not in our_anchor_set: return False
            if cs in seen: return False
            seen.add(cs)
        return True

    must_match_blocking = len(nick_blocking) > 0 and len(our_blocking) > 0
    must_match_spire = len(nick_spire) > 0 and len(our_spire) > 0

    best = (None, -10**9)
    # All 8 axis-preserving grid isometries: x ∈ (row|col) × ±1, same for y,
    # with x and y deriving from DIFFERENT axes.
    for x_axis, y_axis in [('row', 'col'), ('col', 'row')]:
        for sx, sy in product([-1, 1], [-1, 1]):
            # Derive offsets from each anchor pair.
            for nx0, ny0 in nick_anchors:
                for cand in our_anchors:
                    col, row = parse_coord(cand)
                    px = col if x_axis == 'col' else row
                    py = col if y_axis == 'col' else row
                    ox = nx0 - sx * px
                    oy = ny0 - sy * py
                    t = {
                        'x': {'from': x_axis, 'scale': sx, 'offset': ox},
                        'y': {'from': y_axis, 'scale': sy, 'offset': oy},
                    }
                    if must_match_blocking and not all_anchors_map(t, nick_blocking, our_blocking):
                        continue
                    if must_match_spire and not all_anchors_map(t, nick_spire, our_spire):
                        continue
                    sc = score(t)
                    if sc > best[1]:
                        best = (t, sc)
    return best[0] if best[1] > 0 else None


def import_map(map_id, nick_path, our_map):
    nick = json.load(open(nick_path))
    transform = find_transform(our_map, nick)
    if not transform:
        return None, 'no transform found'

    return {
        'transform':             transform,
        'walls':                 nick.get('walls', []),
        'blockingTiles':         nick.get('blockingTiles', []),
        'blockingEdges':         nick.get('blockingEdges', []),
        'blockingIntersections': nick.get('blockingIntersections', []),
        'offMapTiles':           nick.get('offMapTiles', []),
        'spireTiles':            nick.get('spireTiles', []),
    }, None


def main():
    our_data = json.load(open(OUR_MAPS))
    out = {'source': 'github.com/Nick-Hansen/ia-los', 'maps': {}}

    succeeded = []
    skipped = []
    failed = []

    for map_id, nick_filename in NICK_FILENAMES.items():
        if map_id not in our_data['maps']:
            skipped.append((map_id, 'not in our data'))
            continue
        if nick_filename is None:
            skipped.append((map_id, 'no Nick equivalent'))
            continue
        nick_path = os.path.join(NICK_REPO, nick_filename)
        if not os.path.exists(nick_path):
            failed.append((map_id, f'Nick file missing: {nick_filename}'))
            continue
        try:
            entry, err = import_map(map_id, nick_path, our_data['maps'][map_id])
            if err:
                failed.append((map_id, err))
                continue
            out['maps'][map_id] = entry
            t = entry['transform']
            tx, ty = t['x'], t['y']
            succeeded.append((
                map_id,
                f'x={tx["scale"]:+d}*{tx["from"]}{tx["offset"]:+d}, '
                f'y={ty["scale"]:+d}*{ty["from"]}{ty["offset"]:+d}, '
                f'{len(entry["walls"])}w / {len(entry["blockingTiles"])}b / '
                f'{len(entry["offMapTiles"])}o / {len(entry["spireTiles"])}s'
            ))
        except Exception as e:
            failed.append((map_id, repr(e)))

    with open(OUT_PATH, 'w') as f:
        json.dump(out, f, indent=2)

    print(f'\n=== Imported {len(succeeded)}/{len(succeeded)+len(failed)+len(skipped)} maps ===')
    print('\n--- SUCCEEDED ---')
    for m, info in sorted(succeeded):
        print(f'  {m:35s}  {info}')
    if skipped:
        print('\n--- SKIPPED ---')
        for m, why in skipped:
            print(f'  {m:35s}  {why}')
    if failed:
        print('\n--- FAILED ---')
        for m, why in failed:
            print(f'  {m:35s}  {why}')

    print(f'\nwrote {OUT_PATH}')
    sys.exit(0 if not failed else 1)


if __name__ == '__main__':
    main()
