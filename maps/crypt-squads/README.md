# Crypt Squads

Crypt artwork by [atomic-cogwheel0 / act-bedwars](https://github.com/atomic-cogwheel0/act-bedwars), adapted for MCAI's Minecraft Java 1.21 four-team BedWars experiment. The upstream README recommends Crypt and Ships and describes the maps as hand-crafted. This adaptation uses Crypt's actual block structures.

Pinned source: [`aad1a8e250016ef1283f823367249cc0b8f0d15b`](https://github.com/atomic-cogwheel0/act-bedwars/tree/aad1a8e250016ef1283f823367249cc0b8f0d15b/datapack/bedwars/data/crypt/structure).

The map artwork, the original NBT files in `upstream/`, and the derived `.blocks.gz` assets are distributed under [GPL version 3](LICENSE). This directory's artwork is **not covered by the repository's MIT license**. Retain the attribution and license when distributing these files. Original, editable NBT sources and the conversion recipe are included.

Changes by MCAI:

- Expand the playable bounds to 233 × 233 blocks, with four bases centered 88 blocks from the center.
- Rotate one shared base structure into four equivalent bases and recolor its team accents. The original diamond island is rotated onto four side positions. Preserve the original central castle's asymmetric architectural detail.
- Add 37 × 22 block level courtyards, four separate iron/gold collection lanes per team, wider entrances, four forward islands, and a clear central ring.
- Move beds, shops and resource generators into published, accessible positions. Each bed has explicit head, foot and facing coordinates.
- Retain void gaps for bridging. The original datapack, its commands, mobs, marker entities, treasure contents and gameplay are not imported. Rules are provided by the local Paper/BedWars/referee stack.

Rebuild the assets with `node scripts/import-crypt-map.cjs`, and the rules with `python competition/squads_rules.py`. Both commands run from the repository root. The importer verifies pinned SHA-256 hashes and Minecraft 1.21 block names. `manifest.json` records source and output hashes. The Paper importer also validates every complete block state when placing the map.

The upstream *datapack* targets newer Minecraft releases. The Java 1.21 adaptation here imports only block data; compatibility of the upstream gameplay is not assumed. See [the running and verification guide](../../docs/SQUADS_4V4V4V4.zh-CN.md) for the actual validation status.
