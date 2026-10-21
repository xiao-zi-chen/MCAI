package local.agx.prototype;

import java.util.*;
import org.bukkit.*;
import org.bukkit.block.data.type.Bed;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.ItemSpawnEvent;
import org.bukkit.event.inventory.*;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.inventory.*;
import org.bukkit.inventory.meta.*;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.potion.*;
import org.screamingsandals.bedwars.Main;
import org.screamingsandals.bedwars.api.RunningTeam;
import org.screamingsandals.bedwars.api.events.*;
import org.screamingsandals.bedwars.api.game.Game;
import org.screamingsandals.bedwars.api.game.GameStatus;

/** The classic economy extension; all prices and stage times come from rules.json. */
final class ClassicRules implements Listener {
    private final SkyDuelReferee plugin;
    private final YamlConfiguration rules;
    private final NamespacedKey permanent, token, upgradeKey;
    private final Map<String,Map<String,Integer>> levels=new LinkedHashMap<>();
    private final Map<UUID,Integer> armor=new HashMap<>();
    private final Map<UUID,Map<String,Integer>> tools=new HashMap<>();
    private final Map<String,Integer> trapCooldown=new HashMap<>();
    private final Set<String> stages=new HashSet<>();
    private Game game;
    private int elapsed;
    private String stage="regular";

    ClassicRules(SkyDuelReferee plugin,YamlConfiguration rules) {
        this.plugin=plugin;this.rules=rules;
        permanent=new NamespacedKey(plugin,"permanent");token=new NamespacedKey(plugin,"purchase_token");upgradeKey=new NamespacedKey(plugin,"upgrade_id");
        Bukkit.getPluginManager().registerEvents(this,plugin);
        plugin.getCommand("teamshop").setExecutor((sender,cmd,label,args)->{
            if(sender instanceof Player p&&inGame(p)&&nearShop(p))open(p);return true;
        });
        plugin.getCommand("skyduel").setExecutor((sender,cmd,label,args)->{
            if(sender instanceof Player)return true;
            if(args.length>0&&args[0].equals("abort")){plugin.abortMatch();sender.sendMessage("Local match stopped; replay marked aborted");return true;}
            if(args.length>0&&args[0].equals("test")){plugin.getConfig().set("debug-controls",true);plugin.markTest();sender.sendMessage("Current match marked as test; console test controls enabled until locked");return true;}
            if(args.length>0&&args[0].equals("lock")){plugin.getConfig().set("debug-controls",false);plugin.saveConfig();sender.sendMessage("Debug controls locked");return true;}
            if(!plugin.getConfig().getBoolean("debug-controls",false)){sender.sendMessage("Debug controls disabled");return true;}
            if(args.length==4&&args[0].equals("grant")){
                Player p=Bukkit.getPlayerExact(args[1]);var resource=Main.getSpawnerType(args[2]);int amount=Integer.parseInt(args[3]);
                if(p!=null&&resource!=null&&amount>0&&amount<=256){plugin.markTest();p.getInventory().addItem(resource.getStack(amount));sender.sendMessage("Granted test resources");}
            }else if(args.length==2&&args[0].equals("phase")&&game!=null&&game.getStatus()==GameStatus.RUNNING){
                rules.getMapList("phases").stream().filter(p->args[1].equals(p.get("type"))).findFirst().ifPresent(p->{plugin.markTest();phase(p);sender.sendMessage("Applied test phase");});
            }
            return true;
        });
    }
    Map<String,Object> snapshot(){Map<String,Object> copy=new LinkedHashMap<>();levels.forEach((k,v)->copy.put(k,new LinkedHashMap<>(v)));return Map.of("stage",stage,"elapsed_seconds",elapsed,"upgrades",copy);}
    private boolean inGame(Player p){return game!=null&&game.getStatus()==GameStatus.RUNNING&&game.getConnectedPlayers().contains(p)&&p.getGameMode()==GameMode.SURVIVAL;}
    private RunningTeam team(Player p){return game.getTeamOfPlayer(p);}
    private Map<String,Integer> levelMap(String team){return levels.computeIfAbsent(team,k->new LinkedHashMap<>());}
    private int level(String team,String id){return levelMap(team).getOrDefault(id,0);}
    private boolean nearShop(Player p){
        RunningTeam t=team(p);if(t==null)return false;
        List<?> coords=rules.getList("map.teams."+t.getName()+".upgrade_shop");
        return coords!=null&&p.getLocation().distance(new Location(p.getWorld(),((Number)coords.get(0)).doubleValue(),((Number)coords.get(1)).doubleValue(),((Number)coords.get(2)).doubleValue()))<=4.5;
    }
    @EventHandler public void start(BedwarsGameStartedEvent e){
        if(!e.getGame().getName().equals("SkyDuel"))return;
        game=e.getGame();levels.clear();armor.clear();tools.clear();trapCooldown.clear();stages.clear();elapsed=0;stage="regular";
        game.getGameWorld().getWorldBorder().setCenter(0.5,0.5);game.getGameWorld().getWorldBorder().setSize(256);
        for(RunningTeam t:game.getRunningTeams())levelMap(t.getName());
        Bukkit.getScheduler().runTaskLater(plugin,()->game.getConnectedPlayers().forEach(this::kit),2);
    }
    @EventHandler public void end(BedwarsGameEndEvent e){if(e.getGame()==game){game.getGameWorld().getWorldBorder().setSize(256);stage="waiting";}}
    @EventHandler public void openShop(BedwarsOpenShopEvent e){
        if(e.getGame()==game&&"team-upgrades.yml".equals(e.getStore().getShopFile())){e.setCancelled(true);if(nearShop(e.getPlayer()))open(e.getPlayer());}
    }
    private static final class Menu implements InventoryHolder {
        Inventory inventory;
        public Inventory getInventory(){return inventory;}
    }
    private void open(Player player){
        if(!inGame(player))return;
        Menu holder=new Menu();holder.inventory=Bukkit.createInventory(holder,27,"SkyDuel · 团队升级");
        int slot=10;String team=team(player).getName();
        for(Map<?,?> spec:rules.getMapList("team_upgrades")){
            String id=spec.get("id").toString();int lvl=level(team,id);List<?> costs=(List<?>)spec.get("costs");
            ItemStack item=new ItemStack(Material.valueOf(spec.get("icon").toString()));ItemMeta meta=item.getItemMeta();
            meta.setDisplayName(ChatColor.AQUA+spec.get("label").toString()+" · "+lvl+"/"+costs.size());
            meta.setLore(List.of(lvl>=costs.size()?"已达到上限":"价格: "+costs.get(lvl)+" 钻石","升级全队生效，本局内保留"));
            meta.getPersistentDataContainer().set(upgradeKey,PersistentDataType.STRING,id);item.setItemMeta(meta);holder.inventory.setItem(slot++,item);
        }
        player.openInventory(holder.inventory);
    }
    @EventHandler(priority=EventPriority.HIGHEST) public void menuClick(InventoryClickEvent e){
        if(!(e.getView().getTopInventory().getHolder() instanceof Menu))return;e.setCancelled(true);
        if(!(e.getWhoClicked() instanceof Player p)||!inGame(p)||!nearShop(p)||e.getRawSlot()>=e.getView().getTopInventory().getSize())return;
        ItemStack item=e.getCurrentItem();if(item==null||!item.hasItemMeta())return;
        String id=item.getItemMeta().getPersistentDataContainer().get(upgradeKey,PersistentDataType.STRING);if(id==null)return;
        Map<?,?> spec=rules.getMapList("team_upgrades").stream().filter(s->id.equals(s.get("id"))).findFirst().orElse(null);if(spec==null)return;
        String name=team(p).getName();int old=level(name,id);List<?> costs=(List<?>)spec.get("costs");if(old>=costs.size())return;
        int cost=((Number)costs.get(old)).intValue();if(count(p,Material.DIAMOND)<cost){p.sendMessage(ChatColor.RED+"钻石不足");return;}
        remove(p,Material.DIAMOND,cost);levelMap(name).put(id,old+1);applyUpgrades();
        plugin.record("upgrade",Map.of("player",p.getName(),"team",name,"upgrade",id,"level",old+1,"diamonds",cost));
        p.sendMessage(ChatColor.GREEN+"团队升级完成："+spec.get("label"));Bukkit.getScheduler().runTask(plugin,()->open(p));
    }
    @EventHandler public void drag(InventoryDragEvent e){if(e.getView().getTopInventory().getHolder() instanceof Menu)e.setCancelled(true);}
    private int count(Player p,Material material){int n=0;for(ItemStack item:p.getInventory().getStorageContents())if(item!=null&&item.getType()==material)n+=item.getAmount();return n;}
    private void remove(Player p,Material material,int count){for(int i=0;i<36&&count>0;i++){ItemStack item=p.getInventory().getItem(i);if(item==null||item.getType()!=material)continue;int n=Math.min(count,item.getAmount());item.setAmount(item.getAmount()-n);count-=n;p.getInventory().setItem(i,item.getAmount()==0?null:item);}}
    private void mark(ItemStack item,NamespacedKey key){ItemMeta meta=item.getItemMeta();meta.getPersistentDataContainer().set(key,PersistentDataType.BYTE,(byte)1);meta.setUnbreakable(true);item.setItemMeta(meta);}
    private boolean marked(ItemStack item,NamespacedKey key){return item!=null&&item.hasItemMeta()&&item.getItemMeta().getPersistentDataContainer().has(key,PersistentDataType.BYTE);}
    @EventHandler public void purchase(BedwarsApplyPropertyToBoughtItem e){
        if(e.getGame()!=game)return;
        if(e.getPropertyName().equals("SkyDuelPotion")){
            ItemStack item=e.getStack();if(item.getItemMeta() instanceof PotionMeta meta){
                PotionEffectType effect=PotionEffectType.getByName(e.getStringProperty("effect"));
                if(effect!=null){meta.setBasePotionType(PotionType.WATER);meta.clearCustomEffects();meta.addCustomEffect(new PotionEffect(effect,((Number)e.getProperty("duration")).intValue()*20,((Number)e.getProperty("amplifier")).intValue()),true);meta.setColor(effect.getColor());item.setItemMeta(meta);e.setStack(item);}
            }return;
        }
        if(!Set.of("SkyDuelArmor","SkyDuelTool").contains(e.getPropertyName()))return;
        Player p=e.getPlayer();ItemStack item=e.getStack();mark(item,token);e.setStack(item);
        String kind=e.getPropertyName();String tier=e.getStringProperty("tier");
        Bukkit.getScheduler().runTask(plugin,()->{
            if(!inGame(p))return;
            for(int i=0;i<p.getInventory().getSize();i++)if(marked(p.getInventory().getItem(i),token))p.getInventory().setItem(i,null);
            if(kind.equals("SkyDuelArmor")){
                int next=List.of("leather","chainmail","iron","diamond").indexOf(tier),old=armor.getOrDefault(p.getUniqueId(),0);
                if(next<=old){refund(p,e);return;}armor.put(p.getUniqueId(),next);
            }else{
                String tool=e.getStringProperty("tool");int next=Integer.parseInt(tier);Map<String,Integer> state=tools.computeIfAbsent(p.getUniqueId(),k->new HashMap<>());
                if(next<=state.getOrDefault(tool,0)){refund(p,e);return;}state.put(tool,next);
            }
            kit(p);plugin.record("permanent_item",Map.of("player",p.getName(),"kind",kind,"tier",tier));
        });
    }
    private void refund(Player p,BedwarsApplyPropertyToBoughtItem e){
        String currency=e.getStringProperty("currency");int price=Integer.parseInt(e.getProperty("price").toString());
        p.getInventory().addItem(Main.getSpawnerType(currency).getStack(price));p.sendMessage(ChatColor.YELLOW+"已拥有同级或更高装备，已退还资源。");
    }
    private ItemStack armorPiece(String material,Player p){
        ItemStack item=new ItemStack(Material.valueOf(material));mark(item,permanent);
        if(item.getItemMeta() instanceof LeatherArmorMeta meta){meta.setColor(team(p).getName().equals("Red")?Color.fromRGB(195,68,58):Color.fromRGB(65,105,190));item.setItemMeta(meta);}return item;
    }
    private void kit(Player p){
        if(!inGame(p)||team(p)==null)return;
        String tier=List.of("LEATHER","CHAINMAIL","IRON","DIAMOND").get(armor.getOrDefault(p.getUniqueId(),0));
        p.getInventory().setHelmet(armorPiece("LEATHER_HELMET",p));p.getInventory().setChestplate(armorPiece("LEATHER_CHESTPLATE",p));
        p.getInventory().setLeggings(armorPiece(tier+"_LEGGINGS",p));p.getInventory().setBoots(armorPiece(tier+"_BOOTS",p));
        for(var entry:tools.getOrDefault(p.getUniqueId(),Map.of()).entrySet()){
            String tool=entry.getKey(),material=tool.equals("shears")?"SHEARS":List.of("","WOODEN","STONE","IRON","DIAMOND").get(entry.getValue())+"_"+tool.toUpperCase();
            for(int i=0;i<36;i++){ItemStack item=p.getInventory().getItem(i);if(item!=null&&(tool.equals("shears")?item.getType()==Material.SHEARS:item.getType().name().endsWith("_"+tool.toUpperCase())))p.getInventory().setItem(i,null);}
            ItemStack item=new ItemStack(Material.valueOf(material));mark(item,permanent);p.getInventory().addItem(item);
        }
        enchants(p);
    }
    private void enchant(ItemStack item,String key,int level){if(item==null||level==0)return;Enchantment enchant=Registry.ENCHANTMENT.get(NamespacedKey.minecraft(key));if(enchant!=null)item.addUnsafeEnchantment(enchant,level);}
    private void enchants(Player p){
        if(!inGame(p)||team(p)==null)return;String name=team(p).getName();
        for(ItemStack item:p.getInventory().getContents())if(item!=null&&item.getType().name().endsWith("_SWORD"))enchant(item,"sharpness",level(name,"sharpness"));
        for(ItemStack item:p.getInventory().getArmorContents())enchant(item,"protection",level(name,"protection"));
        if(level(name,"haste")>0)p.addPotionEffect(new PotionEffect(PotionEffectType.HASTE,60,level(name,"haste")-1,true,false));
    }
    @EventHandler public void death(BedwarsPlayerKilledEvent e){
        if(e.getGame()!=game)return;e.getDrops().removeIf(i->marked(i,permanent));
        var tool=tools.get(e.getPlayer().getUniqueId());if(tool!=null)tool.replaceAll((kind,lvl)->kind.equals("shears")?lvl:Math.max(1,lvl-1));
    }
    @EventHandler public void respawn(BedwarsPlayerRespawnedIngameEvent e){if(e.getGame()==game)Bukkit.getScheduler().runTask(plugin,()->kit(e.getPlayer()));}
    @EventHandler public void drop(PlayerDropItemEvent e){if(inGame(e.getPlayer())&&marked(e.getItemDrop().getItemStack(),permanent))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true) public void permanentDrop(ItemSpawnEvent e){
        if(marked(e.getEntity().getItemStack(),permanent)||marked(e.getEntity().getItemStack(),token))e.setCancelled(true);
    }
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true) public void boundInventory(InventoryClickEvent e){
        if(!(e.getWhoClicked() instanceof Player p)||!inGame(p))return;
        if(e.getSlotType()==InventoryType.SlotType.ARMOR&&marked(e.getCurrentItem(),permanent)){e.setCancelled(true);return;}
        var top=e.getView().getTopInventory();if(top.getType()==InventoryType.CRAFTING||top.getType()==InventoryType.PLAYER)return;
        boolean depositing=e.getRawSlot()>=0&&e.getRawSlot()<top.getSize();
        if((e.isShiftClick()&&marked(e.getCurrentItem(),permanent))||(depositing&&marked(e.getCursor(),permanent))||(depositing&&e.getHotbarButton()>=0&&marked(p.getInventory().getItem(e.getHotbarButton()),permanent)))e.setCancelled(true);
    }
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true) public void boundDrag(InventoryDragEvent e){
        if(!(e.getWhoClicked() instanceof Player p)||!inGame(p)||!marked(e.getOldCursor(),permanent))return;
        var top=e.getView().getTopInventory();if(top.getType()==InventoryType.CRAFTING||top.getType()==InventoryType.PLAYER)return;
        if(e.getRawSlots().stream().anyMatch(slot->slot<top.getSize()))e.setCancelled(true);
    }
    private void applyUpgrades(){
        if(game==null)return;
        for(var spawner:game.getItemSpawners())if(spawner.getTeam()!=null){
            int forge=level(spawner.getTeam().getName(),"forge");String type=spawner.getItemSpawnerType().getConfigKey();
            if(type.equals("iron")||type.equals("gold"))spawner.setCurrentLevel(new int[]{1,2,3,3,4}[forge]);
            if(type.equals("emerald")){spawner.setCurrentLevel(1);if(spawner instanceof org.screamingsandals.bedwars.game.ItemSpawner concrete)concrete.currentCycle=forge>=4?15:30;}
        }
        game.getConnectedPlayers().forEach(this::enchants);
    }
    @EventHandler public void lockedForge(BedwarsResourceSpawnEvent e){
        var spawner=e.getSpawner();
        if(e.getGame()==game&&spawner.getTeam()!=null&&spawner.getItemSpawnerType().getConfigKey().equals("emerald")&&level(spawner.getTeam().getName(),"forge")<3)e.setCancelled(true);
    }
    @EventHandler public void tick(BedwarsGameTickEvent e){
        if(e.getGame()!=game||e.getStatus()!=GameStatus.RUNNING)return;elapsed=game.getGameTime()-e.getCountdown();
        applyUpgrades();
        for(var phase:rules.getMapList("phases"))if(elapsed>=((Number)phase.get("at_seconds")).intValue()&&stages.add(phase.get("type").toString()+phase.get("at_seconds")))phase(phase);
        for(RunningTeam team:game.getRunningTeams()){
            String name=team.getName();Location center=team.getTeamSpawn();
            if(level(name,"heal_pool")>0)for(Player p:team.getConnectedPlayers())if(p.getGameMode()==GameMode.SURVIVAL&&p.getLocation().distance(center)<8)p.addPotionEffect(new PotionEffect(PotionEffectType.REGENERATION,60,0,true,true));
            if(level(name,"trap")>0&&elapsed>=trapCooldown.getOrDefault(name,0))for(Player p:game.getConnectedPlayers()){
                if(p.getGameMode()!=GameMode.SURVIVAL||team.isPlayerInTeam(p)||p.getLocation().distance(center)>9)continue;
                levelMap(name).put("trap",level(name,"trap")-1);trapCooldown.put(name,elapsed+15);
                p.addPotionEffect(new PotionEffect(PotionEffectType.BLINDNESS,100,0));p.addPotionEffect(new PotionEffect(PotionEffectType.SLOWNESS,100,0));p.removePotionEffect(PotionEffectType.INVISIBILITY);
                team.getConnectedPlayers().forEach(ally->{ally.sendMessage(ChatColor.RED+"警报：敌人触发了基地陷阱！");ally.playSound(ally.getLocation(),Sound.BLOCK_BELL_USE,1,1);});
                plugin.record("trap_triggered",Map.of("team",name,"player",p.getName()));break;
            }
        }
    }
    private void phase(Map<?,?> phase){
        String type=phase.get("type").toString();stage=type;
        if(type.endsWith("_level")) {
            for(var spawner:game.getItemSpawners())if(spawner.getTeam()==null&&spawner.getItemSpawnerType().getConfigKey().equals(type.replace("_level","")))spawner.setCurrentLevel(((Number)phase.get("level")).intValue());
        } else if(type.equals("beds_gone")){
            var concrete=(org.screamingsandals.bedwars.game.Game)game;
            for(RunningTeam team:game.getRunningTeams())if(team.isTargetBlockExists()){
                var block=team.getTargetBlock().getBlock();var data=block.getBlockData();
                concrete.getRegion().putOriginalBlock(block.getLocation(),block.getState());
                if(data instanceof Bed bed){var other=block.getRelative(bed.getPart()==Bed.Part.HEAD?bed.getFacing().getOppositeFace():bed.getFacing());concrete.getRegion().putOriginalBlock(other.getLocation(),other.getState());other.setType(Material.AIR,false);}
                concrete.bedDestroyed(team.getTargetBlock(),null,true,false,false,false);block.setType(Material.AIR,false);
            }
        } else if(type.equals("sudden_death")){
            var border=game.getGameWorld().getWorldBorder();border.setCenter(.5,.5);border.setSize(Math.max(rules.getIntegerList("map.build_max").get(0)-rules.getIntegerList("map.build_min").get(0),rules.getIntegerList("map.build_max").get(2)-rules.getIntegerList("map.build_min").get(2))+8);border.setDamageBuffer(1);border.setDamageAmount(1);border.setWarningDistance(5);border.setSize(16,180L);
        }
        game.getConnectedPlayers().forEach(p->p.sendMessage(ChatColor.GOLD+"比赛阶段更新："+type));plugin.record("phase",Map.of("phase",type,"elapsed_seconds",elapsed));
    }
    @EventHandler public void border(EntityDamageEvent e){if(e.getCause()==EntityDamageEvent.DamageCause.WORLD_BORDER&&e.getEntity() instanceof Player p&&!inGame(p))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST)
    public void nativePearlDamage(EntityDamageByEntityEvent e){
        // SBW 0.2.44's generic projectile friendly-fire filter also cancels a
        // player's own pearl damage on modern Paper. Keep the vanilla 5-point
        // damage event, while preserving the mode's explicit spawn protection.
        if(!(e.getEntity() instanceof Player p)||!inGame(p))return;
        if(!(e.getDamager() instanceof org.bukkit.entity.EnderPearl pearl)||!p.equals(pearl.getShooter()))return;
        if(((org.screamingsandals.bedwars.game.Game)game).isProtectionActive(p))return;
        e.setCancelled(false);
    }
}
