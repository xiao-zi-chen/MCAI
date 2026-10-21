"""Prepare an isolated local BedWars server. Does not accept the Minecraft EULA."""
import json
from pathlib import Path
import shutil
import argparse
import socket
import sys
import secrets
from datetime import datetime

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "runs/bedwars-local"
SERVER.mkdir(parents=True, exist_ok=True)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--apply-rules", action="store_true", help="Back up and replace controlled settings while server is stopped")
args = parser.parse_args()
try:
    with socket.create_connection(("127.0.0.1", 25567), timeout=0.3):
        raise SystemExit("Stop the playtest server before updating its files")
except OSError:
    pass
sys.path.insert(0, str(ROOT / "competition"))
from build_rules import build, load_rules, server_configs
build()
rules = load_rules()


def write_once(relative, content):
    target = SERVER / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        target.write_text(content, encoding="utf-8")


(SERVER / "plugins").mkdir(parents=True, exist_ok=True)
shutil.copy2(ROOT / "downloads/paper-1.21.jar", SERVER / "paper.jar")
shutil.copy2(ROOT / "bedwars-map-plugin/build/libs/local-bedwars-map-0.2.0.jar", SERVER / "plugins/LocalBedwarsMap.jar")
shutil.copy2(ROOT / "referee-plugin/build/libs/skyduel-referee-0.1.0.jar", SERVER / "plugins/SkyDuelReferee.jar")
write_once("eula.txt", "eula=false\n")
write_once("server.properties", """server-ip=127.0.0.1
server-port=25567
online-mode=false
enforce-secure-profile=false
spawn-protection=0
view-distance=4
simulation-distance=4
max-players=8
allow-flight=true
allow-nether=false
difficulty=normal
gamemode=survival
pvp=true
level-name=bedwars
level-type=minecraft:flat
generator-settings={"layers":[{"block":"minecraft:air","height":1}],"biome":"minecraft:the_void","structure_overrides":[]}
generate-structures=false
motd=Local BedWars - SkyDuel
enable-command-block=false
""")
write_once("bukkit.yml", "settings:\n  allow-end: false\n")
properties=SERVER/'server.properties'
values=dict(line.split('=',1) for line in properties.read_text(encoding='utf-8').splitlines() if '=' in line and not line.startswith('#'))
if args.apply_rules or values.get('level-name')=='bedwars':
    saved=SERVER/'config-backups'/datetime.now().strftime('%Y%m%d-%H%M%S')/'server.properties'
    saved.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(properties,saved)
    values.update({'level-name':rules['map']['world'],'view-distance':str(max(6,(max(abs(rules['map']['build_min'][0]),abs(rules['map']['build_max'][0]))+15)//16+1))})
values.setdefault('enable-rcon','true');values.setdefault('rcon.port','25578');values.setdefault('rcon.password',secrets.token_hex(24))
properties.write_text(''.join(f'{k}={v}\n' for k,v in values.items()),encoding='utf-8')
write_once("plugins/bStats/config.yml", "enabled: false\n")
write_once("plugins/BedWars/team-upgrades.yml", '{"data": []}\n')

def merge(base, overlay):
    for key, value in overlay.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            merge(base[key], value)
        else:
            base[key] = value
    return base

arena, shop, settings = server_configs(rules)
files = {"plugins/BedWars/arenas/skyduel.yml": arena, "plugins/BedWars/shop.yml": shop, "plugins/BedWars/config.yml": settings}
backup = SERVER / "config-backups" / datetime.now().strftime("%Y%m%d-%H%M%S")
for relative, data in files.items():
    target = SERVER / relative
    if args.apply_rules and target.exists():
        saved = backup / relative
        saved.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(target, saved)
        if relative.endswith("config.yml"):
            import yaml
            data = merge(yaml.safe_load(target.read_text(encoding="utf-8")) or {}, data)
        target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    else:
        write_once(relative, json.dumps(data, ensure_ascii=False, indent=2) + "\n")
print(f"Prepared: {SERVER}; rules={rules['version']}")
print("Minecraft Java 1.21; localhost:25567; /localbw; EULA remains unchanged.")
