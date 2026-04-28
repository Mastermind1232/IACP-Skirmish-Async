#!/usr/bin/env python3
"""Import Nick Hansen's per-map JSONs into data/nick-los.json — kept
SEPARATE from data/map-spaces.json so the in-browser map tool (which
re-serializes map-spaces.json on save) can never strip the LOS data.

The engine reads map-spaces.json AND nick-los.json and merges nickLos
into each map record at load time (see src/data-loader.js).

Lothal Wastes transform (verified across 13 blocking tiles, 1 spire,
all wall endpoints):
  nick.x = our_row - 3
  nick.y = 23 - our_col
"""
import json
import os

NICK_REPO = '/tmp/ia-los-ref/ia-los/maps'
OUT_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'nick-los.json')

# Per-map config: nick filename + transform from our (col, row) → Nick (x, y).
# Transforms are encoded as { xFromRow: [a, b], yFromCol: [c, d] }
# meaning x = a*row + b, y = c*col + d.
MAPS = {
    'lothal-wastes': {
        'nick_file': 'Lothal_Wastes.json',
        'transform': {
            'xFromRow': [1, -3],
            'yFromCol': [-1, 23],
        },
    },
    # Add more maps here as you import them.
}


def main():
    out = {'source': 'github.com/Nick-Hansen/ia-los', 'maps': {}}
    for map_id, cfg in MAPS.items():
        nick_path = os.path.join(NICK_REPO, cfg['nick_file'])
        if not os.path.exists(nick_path):
            print(f'  SKIP {map_id}: {nick_path} missing')
            continue
        nick = json.load(open(nick_path))
        out['maps'][map_id] = {
            'transform':             cfg['transform'],
            'walls':                 nick.get('walls', []),
            'blockingTiles':         nick.get('blockingTiles', []),
            'blockingEdges':         nick.get('blockingEdges', []),
            'blockingIntersections': nick.get('blockingIntersections', []),
            'offMapTiles':           nick.get('offMapTiles', []),
            'spireTiles':            nick.get('spireTiles', []),
        }
        n = out['maps'][map_id]
        print(f'  {map_id}: {len(n["walls"])} walls, '
              f'{len(n["blockingTiles"])} blocking, '
              f'{len(n["offMapTiles"])} off-map, '
              f'{len(n["blockingIntersections"])} BIs, '
              f'{len(n["spireTiles"])} spires')

    with open(OUT_PATH, 'w') as f:
        json.dump(out, f, indent=2)
    print(f'wrote {OUT_PATH}')


if __name__ == '__main__':
    main()
