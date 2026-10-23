"""Reproducible four-team layout around act-bedwars' GPL Crypt block artwork."""
import copy
import json
from pathlib import Path
from build_rules import build, load_rules

ROOT = Path(__file__).resolve().parent
TEAMS = ['Red', 'Blue', 'Green', 'Yellow']

def rotate(p, turns, continuous=False):
    x, y, z, *rest = p
    for _ in range(turns):
        x, z = (1-z if continuous else -z), x
    return [x, y, z, *rest]

def squads_rules():
    r = copy.deepcopy(load_rules())
    r.update(id='crypt-squads', version='crypt-squads-0.9.1', title='古堡争床 · 4v4v4v4')
    r['match'].update(arena_name='CryptSquads', teams=4, players_per_team=4, countdown_seconds=12, duration_seconds=900)
    r['match']['series'] = dict(games_per_group=1, rotate_teams=False, win_points=3, draw_points=1, loss_points=0)
    r['resources']['gold']['interval_seconds'] = 6
    r['phases'] = [dict(at_seconds=120,type='diamond_level',level=2),
                   dict(at_seconds=240,type='emerald_level',level=2),
                   dict(at_seconds=360,type='diamond_level',level=3),
                   dict(at_seconds=480,type='beds_gone'),
                   dict(at_seconds=600,type='sudden_death')]
    m = dict(id='crypt-squads-1', world='crypt-squads-v1', surface_y=64,
             build_min=[-116,0,-116], build_max=[116,100,116], symmetry='quarter_turn_about_0.5',
             source='act-bedwars / Crypt; enlarged and adapted for MCAI',
             attribution='Crypt by atomic-cogwheel0 · GPL-3.0 · modified by MCAI',
             source_url='https://github.com/atomic-cogwheel0/act-bedwars',
             description='233×233 格赛区；四座扩建古堡基地、四座前哨、四座钻石岛及中央城堡。四队目标点与主路线按 90 度旋转对称；中心原作建筑保留非对称细节，外围环路与四个资源点等距。',
             islands=[], teams={}, spawners=[], structures=[], landings=[], tactical_positions=[],
             features=['crypt_castles','four_courtyards','four_forge_lanes','wide_bridge_mouths','four_outposts','diamond_flanks','central_ring'],
             lobby_spawn=[.5,111,118.5,180,20], lobby_min=[-8,109,110], lobby_max=[8,116,126],
             spectator_spawn=[.5,96,.5,0,35], navigation=dict(waypoints=[],links=[]),
             asset_directory='maps/crypt-squads')
    r['map'] = m
    for i, name in enumerate(TEAMS):
        color=name.upper(); key=name.lower()
        pos=lambda p: rotate(p,i)
        loc=lambda p: rotate(p,i,True)
        center=pos([0,64,-88]); head=pos([0,65,-73]); foot=pos([0,65,-74])
        t=dict(color=color,rotation=i,base_block_x=center[0],base_block_z=center[2],
               bed=head,bed_foot=foot,bed_facing=['SOUTH','WEST','NORTH','EAST'][i],
               spawn=loc([.5,65,-84.5])+[i*90,0],
               shop=loc([-14.5,65,-84.5])+[0,0],upgrade_shop=loc([14.5,65,-84.5])+[0,0],
               shop_approach=loc([-14.5,65,-82.5]),upgrade_approach=loc([14.5,65,-82.5]),
               chest=pos([-17,65,-78]),ender_chest=pos([17,65,-78]),
               approach=loc([.5,65,-69.5]),home=loc([.5,65,-80.5]),
               defense_stand=loc([3.5,65,-73.5]))
        m['teams'][name]=t
        for suffix,x,z,rad,accent in [('',0,-88,23,color+'_TERRACOTTA'),('_outpost',0,-49,10,'STONE_BRICKS'),('_diamond',52,-52,13,'PRISMARINE')]:
            xyz=pos([x,64,z]);m['islands'].append(dict(id=key+suffix,x=xyz[0],z=xyz[2],radius=rad,accent=accent))
        m['structures'] += [dict(file='red_base.blocks.gz',origin=pos([-10,60,-107]),rotation=i,color=color),dict(file='diamond.blocks.gz',origin=pos([41,51,-61]),rotation=i)]
        for lane,x in enumerate([-12,-4,4,12]):
            for resource,z,cap in [('iron',-79.5,32),('gold',-79.5,8)]:
                m['spawners'].append(dict(position=loc([x+.5,65.2,z]),resource=resource,team=name,cap=cap,lane=lane,hologram_enabled=False))
        m['spawners'].append(dict(position=loc([.5,65.2,-81.5]),resource='emerald',team=name,cap=4,requires_forge=3,hologram_enabled=False))
        m['spawners'].append(dict(position=loc([52.5,65.2,-51.5]),resource='diamond',team=None,cap=8))
        m['spawners'].append(dict(position=loc([.5,65.2,-21.5]),resource='emerald',team=None,cap=8))
        for ident,p in [(key,t['approach']), (key+'_outpost',loc([.5,65,-48.5])),(key+'_diamond',loc([52.5,65,-51.5])),(key+'_center',loc([.5,65,-21.5]))]:
            m['navigation']['waypoints'].append(dict(id=ident,position=p))
        neighbor=TEAMS[(i+1)%4].lower()
        m['navigation']['links'] += [[key,key+'_outpost'],[key+'_outpost',key+'_center'],[key+'_outpost',key+'_diamond'],[key+'_diamond',neighbor+'_outpost'],[key+'_center',neighbor+'_center']]
    m['islands'].append(dict(id='center',x=0,z=0,radius=34,accent='SMOOTH_STONE'))
    m['structures'].append(dict(file='emerald.blocks.gz',origin=[-21,56,-17],rotation=0))
    # The center's ring carries traversal; do not force agents through decorative interiors.
    for i,name in enumerate(TEAMS):
        corner=name.lower()+'_ring';m['navigation']['waypoints'].append(dict(id=corner,position=rotate([22.5,65,-21.5],i,True)))
        a=name.lower()+'_center';b=TEAMS[(i+1)%4].lower()+'_center'
        m['navigation']['links'].remove([a,b]);m['navigation']['links'] += [[a,corner],[corner,b]]
    return r

def main():
    out=ROOT/'squads';out.mkdir(exist_ok=True)
    (out/'rules.json').write_text(json.dumps(squads_rules(),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    build(out/'rules.json')

if __name__=='__main__':main()
