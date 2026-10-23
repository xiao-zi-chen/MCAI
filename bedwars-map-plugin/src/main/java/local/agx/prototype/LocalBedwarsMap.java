package local.agx.prototype;

import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.bukkit.*;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.type.Bed;
import org.bukkit.block.data.type.Stairs;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.configuration.file.YamlConfiguration;

/** Creates only the dedicated, initially empty local bedwars world. */
public final class LocalBedwarsMap extends JavaPlugin implements Listener {
    private World world;
    private YamlConfiguration rules;
    private int surfaceY;

    @Override public void onEnable() {
        Path localRules=getDataFolder().toPath().resolve("competition-rules.json");
        try (var input = Files.exists(localRules)?Files.newInputStream(localRules):getResource("competition-rules.json")) {
            if (input == null) throw new IllegalStateException("Missing competition rules resource");
            rules = YamlConfiguration.loadConfiguration(new InputStreamReader(input, StandardCharsets.UTF_8));
        } catch (IOException e) { throw new IllegalStateException("Cannot load competition rules", e); }
        surfaceY = rules.getInt("map.surface_y");
        var worldNames=getConfig().getStringList("arena-worlds");
        if(worldNames.isEmpty())worldNames=java.util.List.of(rules.getString("map.world"));
        for(String worldName:worldNames){
            if(!worldName.matches("[a-zA-Z0-9_-]{1,64}"))throw new IllegalArgumentException("Invalid arena world name");
            prepareWorld(worldName);
        }
        world=Bukkit.getWorld(rules.getString("map.world"));
        Bukkit.getPluginManager().registerEvents(this, this);
        getCommand("localbw").setExecutor((sender, command, label, args) -> {
            if (args.length > 0 && args[0].equalsIgnoreCase("rules")) {
                if(sender instanceof Player p)openRuleBook(p);
                else sender.sendMessage("规则页面：http://127.0.0.1:3007/rules");
            } else if (sender instanceof Player player) player.performCommand("bw join " + rules.getString("match.arena_name"));
            else sender.sendMessage("Join in-game with /localbw");
            return true;
        });
        getLogger().info("SkyDuel map ready, rules=" + rules.getString("version") + ". Join with /localbw.");
    }

    private void prepareWorld(String worldName){
        world = Bukkit.getWorld(worldName);
        if (world == null) {
            if(worldName.equals(rules.getString("map.world")))throw new IllegalStateException("Configured base world missing");
            world = new WorldCreator(worldName).generateStructures(false).generator(new org.bukkit.generator.ChunkGenerator(){
                @Override public boolean shouldGenerateNoise(){return false;}
                @Override public boolean shouldGenerateSurface(){return false;}
                @Override public boolean shouldGenerateCaves(){return false;}
                @Override public boolean shouldGenerateDecorations(){return false;}
                @Override public boolean shouldGenerateMobs(){return false;}
                @Override public boolean shouldGenerateStructures(){return false;}
            }).createWorld();
        }
        String mapId = rules.getString("map.id", "map").replaceAll("[^a-zA-Z0-9_-]", "_");
        Path marker = getDataFolder().toPath().resolve("map-" + mapId + (worldName.equals(rules.getString("map.world"))?"":"-"+worldName) + ".ready");
        if (!Files.exists(marker)) {
            // Never clear an existing map. The launch script creates an air-only world.
            if (!world.getBlockAt(0, surfaceY, 0).getType().isAir()) {
                getLogger().severe("World is not empty at the map origin; refusing to overwrite it.");
                Bukkit.getPluginManager().disablePlugin(this);
                return;
            }
            generateMap();
            world.save();
            try {
                Files.createDirectories(marker.getParent());
                Files.writeString(marker, mapId + "\n");
            } catch (IOException e) { throw new IllegalStateException("Cannot save map marker", e); }
        }
        var lobby = lobbyLocation();
        world.setSpawnLocation(lobby.getBlockX(), lobby.getBlockY(), lobby.getBlockZ());
        world.setGameRule(GameRule.DO_DAYLIGHT_CYCLE, false);
        world.setGameRule(GameRule.DO_WEATHER_CYCLE, false);
        world.setGameRule(GameRule.DO_MOB_SPAWNING, false);
        world.setGameRule(GameRule.NATURAL_REGENERATION, rules.getBoolean("match.natural_regeneration"));
        world.setGameRule(GameRule.DO_IMMEDIATE_RESPAWN, true);
        world.setGameRule(GameRule.SPAWN_RADIUS, 0);
        world.setTime(6000);
        world.setStorm(false);
    }

    private void generateMap() {
        for (var island : rules.getMapList("map.islands")) {
            island(((Number)island.get("x")).intValue(), ((Number)island.get("z")).intValue(),
                ((Number)island.get("radius")).intValue(), Material.valueOf((String)island.get("accent")));
        }
        if(rules.contains("map.structures"))cryptMap();
        else {
        base(rules.getInt("map.teams.Red.base_block_x"), Material.RED_CONCRETE, Material.RED_BED, BlockFace.WEST);
        base(rules.getInt("map.teams.Blue.base_block_x"), Material.BLUE_CONCRETE, Material.BLUE_BED, BlockFace.EAST);
        centerGarden();
        for(var island:rules.getMapList("map.islands"))if(island.get("id").toString().startsWith("diamond_"))
            diamondPavilion(((Number)island.get("x")).intValue(),((Number)island.get("z")).intValue());
        for(var island:rules.getMapList("map.islands"))if(island.get("id").toString().startsWith("approach_"))
            outpost(((Number)island.get("x")).intValue(),((Number)island.get("z")).intValue());
        bridgeLandings();
        }
        for (var spawner : rules.getMapList("map.spawners")) {
            if (spawner.get("team") != null) continue;
            var position = (java.util.List<?>) spawner.get("position");
            String resource = (String) spawner.get("resource");
            set((int)Math.floor(((Number)position.get(0)).doubleValue()), surfaceY,
                (int)Math.floor(((Number)position.get(2)).doubleValue()), Material.valueOf(resource.toUpperCase() + "_BLOCK"));
        }
        int lobbyZ = lobbyLocation().getBlockZ(), lobbyY=lobbyLocation().getBlockY()-1;
        for (int x = -5; x <= 5; x++) for (int z = lobbyZ-5; z <= lobbyZ+5; z++) {
            set(x, lobbyY, z, Material.SMOOTH_QUARTZ);
            if (Math.abs(x) == 5 || z == lobbyZ-5 || z == lobbyZ+5) {
                set(x, lobbyY+1, z, Material.GLASS);
                set(x, lobbyY+2, z, Material.GLASS);
            }
        }
        for (int x : new int[]{-5, 5}) for (int z : new int[]{lobbyZ-5, lobbyZ+5}) set(x, lobbyY+3, z, Material.SEA_LANTERN);
    }

    private int[] turn(int x,int z,int turns){for(int i=0;i<turns;i++){int previous=x;x=-z;z=previous;}return new int[]{x,z};}
    private void rotatedSet(int x,int y,int z,int turns,Material material){var p=turn(x,z,turns);set(p[0],y,p[1],material);}
    /** Crypt artwork plus wider, level courtyards and four equivalent public approaches. */
    private void cryptMap(){
        for(var spec:rules.getMapList("map.structures")){
            String file=spec.get("file").toString();if(!file.matches("[a-z_]+\\.blocks\\.gz"))throw new IllegalArgumentException("Invalid structure asset");
            int turns=((Number)spec.get("rotation")).intValue();var origin=(java.util.List<?>)spec.get("origin");
            var transform=switch(turns){case 1->org.bukkit.block.structure.StructureRotation.CLOCKWISE_90;case 2->org.bukkit.block.structure.StructureRotation.CLOCKWISE_180;case 3->org.bukkit.block.structure.StructureRotation.COUNTERCLOCKWISE_90;default->org.bukkit.block.structure.StructureRotation.NONE;};
            var palette=new java.util.HashMap<String,org.bukkit.block.data.BlockData>();
            try(var in=new java.io.BufferedReader(new InputStreamReader(new java.util.zip.GZIPInputStream(Files.newInputStream(getDataFolder().toPath().resolve("structures").resolve(file))),StandardCharsets.UTF_8))){
                String line;while((line=in.readLine())!=null){var parts=line.split(" ",4);var p=turn(Integer.parseInt(parts[0]),Integer.parseInt(parts[2]),turns);
                    String state=parts[3];if(spec.containsKey("color"))state=state.replace("minecraft:red_","minecraft:"+spec.get("color").toString().toLowerCase(java.util.Locale.ROOT)+"_");
                    var data=palette.computeIfAbsent(state,key->{var b=Bukkit.createBlockData(key);b.rotate(transform);return b;});
                    world.getBlockAt(((Number)origin.get(0)).intValue()+p[0],((Number)origin.get(1)).intValue()+Integer.parseInt(parts[1]),((Number)origin.get(2)).intValue()+p[1]).setBlockData(data,false);
                }
            }catch(IOException e){throw new IllegalStateException("Missing Crypt asset "+file,e);}
        }
        // Keep all essential routes and resources at y=65. Upper artwork remains reachable.
        for(int x=-24;x<=24;x++)for(int z=-24;z<=24;z++)if(Math.abs(x)>=19||Math.abs(z)>=19||Math.abs(x)<=3||Math.abs(z)<=3){
            set(x,surfaceY,z,Math.abs(x)==24||Math.abs(z)==24?Material.POLISHED_ANDESITE:Material.STONE_BRICKS);for(int y=1;y<=3;y++)set(x,surfaceY+y,z,Material.AIR);
        }
        for(String name:rules.getConfigurationSection("map.teams").getKeys(false)){
            String prefix="map.teams."+name+".";int turns=rules.getInt(prefix+"rotation");Material color=Material.valueOf(rules.getString(prefix+"color")+"_CONCRETE");
            for(int x=-18;x<=18;x++)for(int z=-89;z<=-68;z++){
                Material paving=(Math.abs(x)==18||z==-89||Math.abs(x)==2)?color:Math.floorMod(Math.floorDiv(x,3)+Math.floorDiv(z,3),2)==0?Material.STONE_BRICKS:Material.SMOOTH_STONE;
                rotatedSet(x,surfaceY,z,turns,paving);
                for(int y=1;y<=3;y++)rotatedSet(x,surfaceY+y,z,turns,Material.AIR);
            }
            // Three-block bridge mouths and roofed shops leave the central lane clear.
            for(int z=-69;z<=-64;z++)for(int x=-1;x<=1;x++)rotatedSet(x,surfaceY,z,turns,Material.STONE_BRICKS);
            for(int sign:new int[]{-1,1}){
                for(int x=12;x<=17;x++)for(int z=-87;z<=-83;z++)rotatedSet(sign*x,surfaceY+4,z,turns,Material.DARK_OAK_PLANKS);
                for(int y=1;y<=3;y++)rotatedSet(sign*17,surfaceY+y,-86,turns,Material.STONE_BRICKS);
            }
            // Lit forward pavilions provide cover without obstructing either exit axis.
            for(int x:new int[]{-5,5})for(int z:new int[]{-54,-44}){
                for(int y=1;y<=3;y++)rotatedSet(x,surfaceY+y,z,turns,Material.STONE_BRICKS);
                rotatedSet(x,surfaceY+4,z,turns,Material.SEA_LANTERN);
            }
            for(int x=-7;x<=7;x++)if(Math.abs(x)>2)for(int z:new int[]{-56,-42})rotatedSet(x,surfaceY+1,z,turns,Material.MOSSY_STONE_BRICKS);
            var foot=rules.getIntegerList(prefix+"bed_foot");bed(foot.get(0),foot.get(1),foot.get(2),Material.valueOf(rules.getString(prefix+"color")+"_BED"),BlockFace.valueOf(rules.getString(prefix+"bed_facing")));
            for(String key:new String[]{"chest","ender_chest"}){var p=rules.getIntegerList(prefix+key);set(p.get(0),p.get(1),p.get(2),key.equals("chest")?Material.CHEST:Material.ENDER_CHEST);}
        }
        for(var spawner:rules.getMapList("map.spawners")){
            var p=(java.util.List<?>)spawner.get("position");int x=(int)Math.floor(((Number)p.get(0)).doubleValue()),z=(int)Math.floor(((Number)p.get(2)).doubleValue());
            for(int dx=-2;dx<=2;dx++)for(int dz=-2;dz<=2;dz++){
                set(x+dx,surfaceY,z+dz,Material.STONE_BRICKS);for(int y=1;y<=3;y++)set(x+dx,surfaceY+y,z+dz,Material.AIR);
            }
            set(x,surfaceY,z,Material.valueOf(spawner.get("resource").toString().toUpperCase(java.util.Locale.ROOT)+"_BLOCK"));
        }
    }

    private void island(int cx, int cz, int radius, Material accent) {
        for (int layer = 0; layer < 10; layer++) {
            int r = Math.max(1, radius - (int)Math.ceil(layer*0.85));
            for (int dx = -r; dx <= r; dx++) for (int dz = -r; dz <= r; dz++) {
                int d = dx * dx + dz * dz;
                if (d > r * r) continue;
                Material material;
                if (layer==0) {
                    material=d>(r-1)*(r-1)?accent:d>(r-3)*(r-3)?Material.GRASS_BLOCK:Material.SMOOTH_SANDSTONE;
                    if (Math.abs(dz-2)<=1 || Math.abs(dx)<=1) material=Material.STONE_BRICKS;
                    if (d>(r-1)*(r-1)) material=accent;
                } else {
                    int texture=Math.floorMod(Math.abs(dx)*7+Math.abs(dz)*11+layer*3,9);
                    material=texture<2?Material.MOSSY_COBBLESTONE:texture<5?Material.ANDESITE:Material.STONE;
                }
                set(cx + dx, surfaceY - layer, cz + dz, material);
            }
        }
        for (int dx : new int[]{-2, 2}) for (int dz : new int[]{-2, 2}) set(cx + dx, surfaceY, cz + dz, Material.SEA_LANTERN);
    }

    private void base(int cx, Material color, Material bedType, BlockFace facing) {
        int side = Integer.signum(cx);
        int footX = cx - side * 3;
        bed(footX, surfaceY + 1, 0, bedType, facing);
        // The merchant arcade has a three-block aisle and two distinct stalls.
        for(int x:new int[]{cx-2,cx+2,cx+side*6})for(int y=1;y<=3;y++)set(x,surfaceY+y,-6,Material.STRIPPED_DARK_OAK_LOG);
        for(int dx=-3;dx<=6;dx++)for(int z=-7;z<=-4;z++)set(cx+side*dx,surfaceY+4,z,z==-4?color:Material.DARK_OAK_PLANKS);
        for(int dx=-2;dx<=5;dx++)set(cx+side*dx,surfaceY,-3,Material.SMOOTH_STONE);
        set(cx + side * 5, surfaceY, 3, Material.IRON_BLOCK);
        set(cx + side * 5, surfaceY, 4, Material.GOLD_BLOCK);
        set(cx, surfaceY+1, 5, Material.CHEST);
        set(cx + side * 2, surfaceY+1, 5, Material.ENDER_CHEST);
        // A usable fort roof, reached by real stairs, overlooks the front bridge.
        for(int offset=5;offset<=10;offset++) for(int z=-6;z<=6;z++) {
            int x=cx+side*offset;
            set(x,surfaceY,z,Material.STONE_BRICKS);set(x,surfaceY-1,z,Material.COBBLED_DEEPSLATE);
            set(x,surfaceY+5,z,Material.DARK_OAK_PLANKS);
            if(offset==10 || Math.abs(z)==6)for(int y=1;y<=4;y++){
                boolean window=(y==2||y==3)&&Math.abs(z)<5&&Math.abs(z)>1;
                set(x,surfaceY+y,z,window?Material.GLASS_PANE:y==1?Material.STONE_BRICKS:Material.SMOOTH_SANDSTONE);
            }
            if((offset==10||Math.abs(z)==6)&&((offset+Math.abs(z))%2==0))set(x,surfaceY+6,z,Material.STONE_BRICK_WALL);
        }
        for(int step=0;step<5;step++)for(int lane=7;lane<=8;lane++){
            int x=cx+side*lane,z=6-step;
            for(int y=1;y<=step;y++)set(x,surfaceY+y,z,Material.STONE_BRICKS);
            stair(x,surfaceY+1+step,z,Material.STONE_BRICK_STAIRS,BlockFace.NORTH);
            for(int y=surfaceY+2+step;y<=surfaceY+5;y++)set(x,y,z,Material.AIR);
        }
        for(int z:new int[]{-8,8})lamp(cx+side*2,z);
        for(int z:new int[]{-9,9}){
            for(int y=1;y<=4;y++)set(cx+side*3,surfaceY+y,z,Material.STONE_BRICKS);
            set(cx+side*3,surfaceY+5,z,Material.STONE_BRICK_SLAB);
            set(cx+side*2,surfaceY+3,z,color);set(cx+side,surfaceY+3,z,color);
        }
        for(int dx=-4;dx<=3;dx++)for(int z:new int[]{-1,1})if(Math.abs(dx)>2)set(cx+dx,surfaceY,z,color);
    }

    private void lamp(int x,int z) {
        for(int y=surfaceY+1;y<=surfaceY+3;y++)set(x,y,z,Material.DARK_OAK_FENCE);
        set(x,surfaceY+4,z,Material.LANTERN);
    }
    private void planter(int x,int z) {
        set(x,surfaceY+1,z,Material.MOSSY_STONE_BRICKS);
        set(x,surfaceY+2,z,Material.FLOWERING_AZALEA);
    }
    private void centerGarden() {
        // Two galleries have upper firing positions and a walkable lower passage.
        for(int side:new int[]{-1,1}){
            for(int x=-4;x<=4;x++)for(int z=8;z<=12;z++)set(x,surfaceY+3,side*z,Material.STONE_BRICKS);
            for(int x:new int[]{-4,4})for(int z:new int[]{8,12}){
                for(int y=1;y<=5;y++)set(x,surfaceY+y,side*z,Material.CHISELED_STONE_BRICKS);
                set(x,surfaceY+6,side*z,Material.LANTERN);
            }
            for(int x=-3;x<=3;x++)if(Math.abs(x)>1)set(x,surfaceY+4,side*12,Material.STONE_BRICK_WALL);
            for(int step=0;step<3;step++)for(int x=-1;x<=1;x++){
                for(int y=1;y<=step;y++)set(x,surfaceY+y,side*(5+step),Material.STONE_BRICKS);
                stair(x,surfaceY+step+1,side*(5+step),Material.STONE_BRICK_STAIRS,side<0?BlockFace.NORTH:BlockFace.SOUTH);
            }
            for(int x:new int[]{-9,9})planter(x,side*9);
        }
        for(int x=-3;x<=3;x++)for(int z=-3;z<=3;z++)if(Math.abs(x)==3||Math.abs(z)==3)set(x,surfaceY,z,Material.POLISHED_ANDESITE);
        for(int x:new int[]{-7,7})for(int z:new int[]{-3,4})set(x,surfaceY, z,Material.SEA_LANTERN);
    }
    private void diamondPavilion(int cx,int cz) {
        for(int x:new int[]{cx-3,cx+3})for(int z:new int[]{cz-3,cz+3}){
            for(int y=surfaceY+1;y<=surfaceY+3;y++)set(x,y,z,Material.STONE_BRICKS);
            set(x,surfaceY+4,z,Material.LANTERN);
        }
        for(int x=cx-3;x<=cx+3;x++)for(int z=cz-3;z<=cz+3;z++)if(Math.abs(x-cx)==3||Math.abs(z-cz)==3)set(x,surfaceY+4,z,Material.PRISMARINE_BRICKS);
        for(int dx=-2;dx<=2;dx++)for(int dz=-2;dz<=2;dz++)set(cx+dx,surfaceY,cz+dz,Math.abs(dx)==2||Math.abs(dz)==2?Material.POLISHED_DEEPSLATE:Material.SMOOTH_STONE);
    }

    /** Clear bridge mouths and side cover serve actual approach/retreat routes. */
    private void bridgeLandings(){
        for(var landing:rules.getMapList("map.landings")){
            var lo=(java.util.List<?>)landing.get("min");var hi=(java.util.List<?>)landing.get("max");
            for(int x=((Number)lo.get(0)).intValue();x<=((Number)hi.get(0)).intValue();x++)
                for(int z=((Number)lo.get(2)).intValue();z<=((Number)hi.get(2)).intValue();z++){
                    set(x,surfaceY,z,Material.STONE_BRICKS);set(x,surfaceY-1,z,Material.POLISHED_ANDESITE);
                }
        }
        for(int side:new int[]{-1,1}){
            Material team=side<0?Material.RED_CONCRETE:Material.BLUE_CONCRETE;
            // Cover has gaps at either end; the central combat lane stays open.
            for(int x=4;x<=6;x++)for(int z:new int[]{-5,5})set(side*x,surfaceY+1,z,Material.MOSSY_STONE_BRICKS);
            for(int x=7;x<=10;x++)for(int z:new int[]{-4,4})set(side*x,surfaceY,z,Material.CUT_SANDSTONE);
            int base=rules.getInt("map.teams."+(side<0?"Red":"Blue")+".base_block_x");
            for(int x=0;x<=5;x++)set(base+side*x,surfaceY,3,team);
            set(base+side*5,surfaceY,3,Material.IRON_BLOCK);
            set(base+side*5,surfaceY,4,Material.GOLD_BLOCK);
            for(int z=-6;z<=6;z++)set(base+side*10,surfaceY+1,z,team);
        }
    }

    private void outpost(int cx,int cz){
        // A clear central lane with optional cover on each side. No mandatory doors.
        for(int side:new int[]{-1,1}){
            for(int dx=-2;dx<=2;dx++)set(cx+dx,surfaceY+1,cz+side*4,Material.MOSSY_STONE_BRICKS);
            for(int dx:new int[]{-3,3}){
                for(int y=1;y<=4;y++)set(cx+dx,surfaceY+y,cz+side*4,Material.STONE_BRICKS);
                set(cx+dx,surfaceY+5,cz+side*4,Material.LANTERN);
            }
        }
        for(int dx=-4;dx<=4;dx++)for(int dz=-1;dz<=1;dz++)set(cx+dx,surfaceY,cz+dz,Material.POLISHED_ANDESITE);
    }

    private void bed(int x, int y, int z, Material material, BlockFace facing) {
        Bed foot = (Bed) Bukkit.createBlockData(material);
        foot.setFacing(facing);
        foot.setPart(Bed.Part.FOOT);
        world.getBlockAt(x, y, z).setBlockData(foot, false);
        Bed head = (Bed) foot.clone();
        head.setPart(Bed.Part.HEAD);
        world.getBlockAt(x + facing.getModX(), y, z + facing.getModZ()).setBlockData(head, false);
    }

    private void set(int x, int y, int z, Material material) { world.getBlockAt(x, y, z).setType(material, false); }
    private void stair(int x,int y,int z,Material material,BlockFace facing){set(x,y,z,material);Stairs data=(Stairs)world.getBlockAt(x,y,z).getBlockData();data.setFacing(facing);world.getBlockAt(x,y,z).setBlockData(data,false);}
    private void openRuleBook(Player player){
        var book=new org.bukkit.inventory.ItemStack(Material.WRITTEN_BOOK);
        var meta=(org.bukkit.inventory.meta.BookMeta)book.getItemMeta();meta.setTitle("悬空夺床规则");meta.setAuthor("SkyDuel");
        var pages=new java.util.ArrayList<String>();
        pages.add("§l悬空夺床§r\n\nJava 1.21\n"+rules.getString("version")+"\n\n原版负责移动、碰撞、攻击冷却和物品基础使用。\n\n拆床复活、资源生成、商店与永久装备是起床战争扩展。");
        pages.add("§l胜负与复活§r\n\n"+rules.getInt("match.teams")+" 队各 "+rules.getInt("match.players_per_team")+" 人。\n每局 "+rules.getInt("match.duration_seconds")/60+" 分钟。\n\n床还在：死亡后 "+rules.getInt("match.respawn_seconds")+" 秒复活。\n出生保护 "+rules.getInt("match.respawn_protection_seconds")+" 秒。\n\n床已毁：再次死亡淘汰。\n最后存活队获胜。\n超时多队仍在则平局。");
        pages.add("§l原版物品操作§r\n\n剑按 1.21 冷却攻击。\n弓持续拉满约 1 秒。\n食物、药水持续使用约 1.6 秒。\n\n金苹果给予再生与吸收生命。\n\n喝药后的瓶子、珍珠落点与伤害、水和海绵由原版处理。");
        pages.add("§l装备与储物§r\n\n护甲升级护腿、靴子；头盔、胸甲保留队色。\n永久装备不耗耐久。\n\n镐、斧死亡降一级，最低木制；剪刀保留。\n\n普通箱可被对方打开。\n所有末影箱访问同一份个人储物。");
        pages.add("§l特殊物品§r\n\nTNT 放置后自动点燃，"+rules.getInt("mechanics.bedwars.tnt_fuse_ticks")/20+" 秒爆炸，会伤自己。\n火球可投掷、会点火。\n\n防爆玻璃和原始地图不被爆炸拆除。\n\n这些是起床战争扩展，不是原版生存默认规则。");
        pages.add("§l地图与通路§r\n\n"+rules.getMapList("map.islands").size()+" 座岛屿。\n主桥留有搭建缺口。\n\n基地屋顶可沿楼梯到达。各岛有掩体和侧翼通路。钻石在外围，绿宝石在中心。\n\n原始建筑受保护。");
        StringBuilder resources=new StringBuilder("§l资源与升级§r\n\n");
        for(String key:rules.getConfigurationSection("resources").getKeys(false))resources.append(rules.getString("resources."+key+".label")).append("：每 ").append(rules.getInt("resources."+key+".interval_seconds")).append(" 秒\n");
        resources.append("\n己方升级商人出售团队升级；普通商店可在任一基地使用。");pages.add(resources.toString());
        StringBuilder upgrades=new StringBuilder("§l团队升级§r\n\n");for(var u:rules.getMapList("team_upgrades"))upgrades.append(u.get("label")).append("\n").append(u.get("costs")).append(" 钻石\n");pages.add(upgrades.toString());
        var entries=rules.getMapList("shop");for(int i=0;i<entries.size();i+=5){StringBuilder page=new StringBuilder("§l商店价目§r\n\n");for(int j=i;j<Math.min(i+5,entries.size());j++){var e=entries.get(j);page.append(e.get("label")).append(" ×").append(e.get("amount")).append("\n").append(e.get("price")).append(" ").append(rules.getString("resources."+e.get("currency")+".label")).append("\n");}pages.add(page.toString());}
        meta.setPages(pages);book.setItemMeta(meta);player.openBook(book);
    }
    private Location lobbyLocation() {
        var p=rules.getList("map.lobby_spawn");
        return new Location(world,((Number)p.get(0)).doubleValue(),((Number)p.get(1)).doubleValue(),((Number)p.get(2)).doubleValue(),((Number)p.get(3)).floatValue(),((Number)p.get(4)).floatValue());
    }

    @EventHandler public void onJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        Bukkit.getScheduler().runTask(this, () -> {
            player.teleport(lobbyLocation());
            player.sendMessage(ChatColor.AQUA + "悬空夺床 · 天空港湾");
            player.sendMessage(ChatColor.WHITE + "输入 /localbw 加入；"+(rules.getInt("match.teams")*rules.getInt("match.players_per_team"))+" 人开局。托管场地由比赛中心分配。右键村民购物。");
        });
    }
}
