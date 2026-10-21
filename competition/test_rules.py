import json
import math
import unittest
from pathlib import Path
from jsonschema import Draft202012Validator
from build_rules import load_rules, server_configs, action_schema

class RuleTests(unittest.TestCase):
    def setUp(self):
        self.rules=load_rules()
        self.schema=Draft202012Validator(action_schema(self.rules))

    def test_continuous_locations_are_mirrored(self):
        red,blue=(self.rules['map']['teams'][k] for k in ['Red','Blue'])
        for field in ['spawn','shop']:
            self.assertAlmostEqual(red[field][0]+blue[field][0],1)
            self.assertEqual(red[field][1:3],blue[field][1:3])

    def test_block_locations_are_mirrored(self):
        red,blue=(self.rules['map']['teams'][k] for k in ['Red','Blue'])
        for field in ['bed','chest','ender_chest']:
            self.assertEqual(red[field][0],-blue[field][0])
            self.assertEqual(red[field][1:],blue[field][1:])

    def test_spawners_have_equal_price_and_timing(self):
        for resource in ['iron','gold']:
            red,blue=[next(s for s in self.rules['map']['spawners'] if s['resource']==resource and s['team']==team) for team in ['Red','Blue']]
            self.assertAlmostEqual(red['position'][0]+blue['position'][0],1)
            self.assertEqual(red['cap'],blue['cap'])
            self.assertEqual(red['position'][1:],blue['position'][1:])

    def test_obsidian_has_a_counter_tool(self):
        items={i['id']:i for i in self.rules['shop']}
        self.assertIn('diamond_pickaxe',items)
        self.assertLessEqual(items['diamond_pickaxe']['price'],items['obsidian']['price'])

    def test_schema_accepts_wool_bundles(self):
        for quantity in [16,32,64]:
            self.schema.validate({'v':1,'order':{'type':'buy','item':'wool','quantity':quantity}})

    def test_schema_rejects_partial_purchase_and_unknown_commands(self):
        for action in [
            {'v':1,'order':{'type':'buy','item':'wool','quantity':17}},
            {'v':1,'order':{'type':'command','text':'op test'}},
            {'v':1,'order':{'type':'wait'},'admin':True},
            {'v':1,'order':{'type':'place','item':'obsidian','block':{'x':0.5,'y':65,'z':0}}},
            {'v':1,'order':{'type':'move','target':{'x':999,'y':65,'z':0}}},
        ]: self.assertFalse(self.schema.is_valid(action))

    def test_all_prices_and_spawns_come_from_source(self):
        arena,shop,settings=server_configs(self.rules)
        self.assertEqual(arena['gameTime'],self.rules['match']['duration_seconds'])
        self.assertEqual(arena['minPlayers'],2)
        self.assertEqual(len(shop['data']),len(self.rules['shop']))
        for source,compiled in zip(self.rules['shop'],shop['data']):
            self.assertEqual(compiled['price'],f"{source['price']} of {source['currency']}")
            self.assertEqual(compiled['stack']['amount'],source['amount'])
        self.assertEqual(settings['respawn-cooldown']['time'],self.rules['match']['respawn_seconds'])

    def test_spawner_levels_never_create_empty_item_stacks(self):
        arena,_,_=server_configs(self.rules)
        self.assertTrue(all(s['startLevel']>=1 for s in arena['spawners']))
        locked=[s for s in self.rules['map']['spawners'] if s['team'] and s['resource']=='emerald']
        self.assertEqual(len(locked),2)
        self.assertTrue(all(s['requires_forge']==3 for s in locked))

    def test_phase_schedule_leaves_time_for_final_elimination(self):
        phases=self.rules['phases']
        self.assertEqual([p['at_seconds'] for p in phases],sorted(p['at_seconds'] for p in phases))
        beds=next(p['at_seconds'] for p in phases if p['type']=='beds_gone')
        final=next(p['at_seconds'] for p in phases if p['type']=='sudden_death')
        self.assertLess(beds,final)
        self.assertLessEqual(final+180,self.rules['match']['duration_seconds'])

    def test_schema_supports_special_items_and_team_upgrades(self):
        for item in self.rules['shop']:
            self.schema.validate({'v':1,'order':{'type':'buy','item':item['id'],'quantity':item['amount']}})
        for upgrade in self.rules['team_upgrades']:
            self.schema.validate({'v':1,'order':{'type':'upgrade','id':upgrade['id']}})
        self.assertFalse(self.schema.is_valid({'v':1,'order':{'type':'upgrade','id':'creative'}}))

    def test_resource_banking_cannot_transfer_permanent_gear(self):
        for operation in ['deposit','withdraw']:
            self.schema.validate({'v':1,'order':{'type':operation,'container':'ender_chest','item':'gold','quantity':7}})
            self.assertFalse(self.schema.is_valid({'v':1,'order':{'type':operation,'container':'ender_chest','item':'diamond_pickaxe','quantity':1}}))

    def test_declared_orders_match_executable_schema(self):
        schema_orders={o['properties']['type']['const'] for o in action_schema(self.rules)['properties']['order']['oneOf']}
        self.assertEqual(schema_orders,set(self.rules['submission']['orders']))

    def test_generated_artifacts_are_current(self):
        arena,shop,settings=server_configs(self.rules)
        for name,obj in [('arena.yml',arena),('shop.yml',shop),('settings.yml',settings)]:
            self.assertEqual(json.loads((Path(__file__).parent/'generated'/name).read_text(encoding='utf-8')),obj)

    def test_side_generators_have_actual_mirror_symmetry(self):
        islands=[i for i in self.rules['map']['islands'] if i['id'].startswith('diamond_')]
        self.assertEqual(len(islands),4)
        for island in islands:
            self.assertTrue(any(i['x']==-island['x'] and i['z']==island['z'] and i['radius']==island['radius'] for i in islands))

    def test_native_timing_and_mode_overrides_are_explicit(self):
        mechanics=self.rules['mechanics']
        self.assertEqual(mechanics['native']['food_use_ticks'],32)
        self.assertEqual(mechanics['native']['drink_use_ticks'],32)
        self.assertEqual(mechanics['native']['bow_full_draw_ticks'],20)
        self.assertFalse(mechanics['bedwars']['natural_regeneration'])
        self.assertTrue(mechanics['bedwars']['permanent_gear_unbreakable'])

    def test_special_item_parameters_match_plugin_settings(self):
        _,_,settings=server_configs(self.rules)
        items={i['id']:i for i in self.rules['shop']}
        tnt=items['tnt']['properties'][0]
        self.assertEqual(tnt['explosion-time']*20,self.rules['mechanics']['bedwars']['tnt_fuse_ticks'])
        self.assertEqual(tnt['damage'],settings['specials']['auto-igniteable-tnt']['damage'])
        fireball=items['fireball']['properties'][0]
        self.assertEqual(fireball['damage'],settings['specials']['throwable-fireball']['damage'])
        self.assertEqual(fireball['incendiary'],settings['specials']['throwable-fireball']['incendiary'])

if __name__=='__main__':unittest.main()
