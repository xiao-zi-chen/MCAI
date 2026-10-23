"""Build an offline plan view of the imported block artwork and its published layout."""
import gzip
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def build_columns(rules):
    columns={}
    def put(x,y,z,block):
        col=columns.setdefault((x,z),{})
        if block=='air':col.pop(y,None)
        else:col[y]=block
    def turn(x,z,n):
        for _ in range(n):x,z=-z,x
        return x,z
    def rotated(x,y,z,n,block):
        x,z=turn(x,z,n);put(x,y,z,block)
    m=rules['map'];surface=m['surface_y']
    for island in m['islands']:
        r=island['radius']
        for dx in range(-r,r+1):
            for dz in range(-r,r+1):
                if dx*dx+dz*dz>r*r:continue
                material=island['accent'].lower() if dx*dx+dz*dz>(r-1)**2 else 'grass_block' if dx*dx+dz*dz>(r-3)**2 else 'smooth_sandstone'
                if (abs(dz-2)<=1 or abs(dx)<=1) and dx*dx+dz*dz<=(r-1)**2:material='stone_bricks'
                put(island['x']+dx,surface,island['z']+dz,material)
    for spec in m['structures']:
        with gzip.open(ROOT/m['asset_directory']/spec['file'],'rt') as file:
            for line in file:
                x,y,z,state=line.split();x,z=turn(int(x),int(z),spec['rotation']);ox,oy,oz=spec['origin']
                state=state.split('[')[0].removeprefix('minecraft:')
                if 'color' in spec and state.startswith('red_'):state=spec['color'].lower()+state[3:]
                put(ox+x,oy+int(y),oz+z,state)
    for x in range(-24,25):
        for z in range(-24,25):
            if abs(x)>=19 or abs(z)>=19 or abs(x)<=3 or abs(z)<=3:
                put(x,surface,z,'polished_andesite' if abs(x)==24 or abs(z)==24 else 'stone_bricks')
                for y in range(1,4):put(x,surface+y,z,'air')
    for team in m['teams'].values():
        n=team['rotation'];color=team['color'].lower()+'_concrete'
        for x in range(-18,19):
            for z in range(-89,-67):
                rotated(x,surface,z,n,color if abs(x) in [2,18] or z==-89 else 'stone_bricks' if (x//3+z//3)%2==0 else 'smooth_stone')
                for y in range(1,4):rotated(x,surface+y,z,n,'air')
        for z in range(-69,-63):
            for x in [-1,0,1]:rotated(x,surface,z,n,'stone_bricks')
        for sign in [-1,1]:
            for x in range(12,18):
                for z in range(-87,-82):rotated(sign*x,surface+4,z,n,'dark_oak_planks')
            for y in range(1,4):rotated(sign*17,surface+y,-86,n,'stone_bricks')
        for x in [-5,5]:
            for z in [-54,-44]:
                for y in range(1,4):rotated(x,surface+y,z,n,'stone_bricks')
                rotated(x,surface+4,z,n,'sea_lantern')
        for x in range(-7,8):
            if abs(x)>2:
                for z in [-56,-42]:rotated(x,surface+1,z,n,'mossy_stone_bricks')
        for key in ['bed','bed_foot','chest','ender_chest']:
            put(*team[key],team['color'].lower()+'_bed' if key.startswith('bed') else key)
    for spawn in m['spawners']:
        import math
        x,z=math.floor(spawn['position'][0]),math.floor(spawn['position'][2])
        for dx in range(-2,3):
            for dz in range(-2,3):
                put(x+dx,surface,z+dz,'stone_bricks')
                for y in range(1,4):put(x+dx,surface+y,z+dz,'air')
        put(x,surface,z,spawn['resource']+'_block')
    return columns

def main():
    rules=json.loads((ROOT/'competition/squads/rules.json').read_text(encoding='utf-8'))
    columns=build_columns(rules)
    top=[[x,z,max(col),col[max(col)]] for (x,z),col in columns.items() if col]
    payload=json.dumps(dict(rules=rules,top=top),ensure_ascii=False,separators=(',',':'))
    template=(ROOT/'maps/crypt-squads/preview.template.html').read_text(encoding='utf-8')
    (ROOT/'maps/crypt-squads/preview.html').write_text(template.replace('/*MAP_DATA*/',payload),encoding='utf-8')
    print(f'Preview: {len(top)} columns, {len(rules["map"]["islands"])} islands')

if __name__=='__main__':main()
