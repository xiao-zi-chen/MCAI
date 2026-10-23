package local.agx.prototype;

import com.google.gson.Gson;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.bukkit.*;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.block.*;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.player.PlayerAnimationEvent;
import org.bukkit.event.player.PlayerItemConsumeEvent;
import org.bukkit.event.player.PlayerBucketEmptyEvent;
import org.bukkit.event.player.PlayerBucketFillEvent;
import org.bukkit.event.entity.EntityShootBowEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.PotionMeta;
import org.bukkit.inventory.meta.LeatherArmorMeta;
import org.bukkit.inventory.meta.Damageable;
import org.screamingsandals.bedwars.api.events.*;
import org.screamingsandals.bedwars.api.game.Game;
import org.screamingsandals.bedwars.api.game.GameStatus;
import org.screamingsandals.bedwars.api.RunningTeam;

/** Local observer/recorder. It never chooses actions or supplies training rewards. */
final class ArenaReferee implements Listener {
    private final SkyDuelReferee plugin;
    final String arenaId, arenaName, worldName;
    final boolean managed;
    private final int observerPort;
    private final ArenaLease lease;
    private final Gson gson = new Gson();
    private ReplayRecorder recorder;
    private int frameCount;
    private Map<String,Object> firstFrame,lastFrame;
    private final Set<String> framePlayers=new LinkedHashSet<>();
    private CompletableFuture<Void> recordingDone=CompletableFuture.completedFuture(null);
    private final List<Map<String,Object>> events = new ArrayList<>();
    private final AtomicInteger clients = new AtomicInteger();
    private final Set<Socket> sockets = ConcurrentHashMap.newKeySet();
    private volatile String current = "{\"phase\":\"waiting\"}",controllerCurrent=current;
    private volatile boolean stopping;
    private ServerSocket listener;
    private Game game;
    private String matchId = "", winner = "", reason = "", rulesVersion, rulesHash;
    private long tick;
    private int frameSequence;
    private long snapshotSequence;
    private Map<String,Object> worldObjects=Map.of();
    private final List<int[]> bedPositions=new ArrayList<>();
    private boolean recorded;
    private ClassicRules classic;
    private Map<?,?> ruleDocument;
    private int maxFrames=9100;
    private int maxEvents=50000;
    private double projectileRadiusX=64,projectileRadiusZ=64;
    private boolean recordingTruncated;
    private boolean testRun,testControlsPaused;
    private final Map<String,Long> respawnUntil=new HashMap<>();
    private final Map<String,Long> swingTicks=new HashMap<>(),damageTicks=new HashMap<>(),useStarted=new HashMap<>();
    private final Map<String,List<Integer>> digging=new HashMap<>();
    private final Map<String,org.bukkit.block.Block> changedBlocks=new LinkedHashMap<>();

    ArenaReferee(SkyDuelReferee plugin, String arenaId, String arenaName, String worldName, int observerPort, boolean managed) {
        this.plugin=plugin;this.arenaId=arenaId;this.arenaName=arenaName;this.worldName=worldName;this.observerPort=observerPort;this.managed=managed;
        this.lease=new ArenaLease(plugin,this);
        try {
            byte[] bytes = plugin.ruleBytes();
            rulesHash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
            ruleDocument = gson.fromJson(new String(bytes, StandardCharsets.UTF_8), Map.class);
            rulesVersion = ruleDocument.get("version").toString();
            var settings=YamlConfiguration.loadConfiguration(new StringReader(new String(bytes,StandardCharsets.UTF_8)));
            maxFrames=settings.getInt("match.duration_seconds")*10+100;
            maxEvents=settings.getInt("recording.max_events",Math.max(50000,lease.requiredPlayers*15000));
            var lo=settings.getIntegerList("map.build_min");var hi=settings.getIntegerList("map.build_max");
            projectileRadiusX=Math.max(Math.abs(lo.get(0)),Math.abs(hi.get(0)))+16;
            projectileRadiusZ=Math.max(Math.abs(lo.get(2)),Math.abs(hi.get(2)))+16;
            for(String team:settings.getConfigurationSection("map.teams").getKeys(false)){
                var b=settings.getIntegerList("map.teams."+team+".bed");int sign=Integer.signum(settings.getInt("map.teams."+team+".base_block_x"));
                var foot=settings.getIntegerList("map.teams."+team+".bed_foot");
                bedPositions.add(new int[]{b.get(0),b.get(1),b.get(2)});bedPositions.add(foot.size()==3?new int[]{foot.get(0),foot.get(1),foot.get(2)}:new int[]{b.get(0)-sign,b.get(1),b.get(2)});
            }
            classic=new ClassicRules(plugin,this,settings);
            listener = new ServerSocket(); listener.bind(new InetSocketAddress("127.0.0.1", observerPort));
        } catch (Exception e) { throw new IllegalStateException(e); }
        Thread accept = new Thread(this::acceptClients, "skyduel-observers"); accept.setDaemon(true); accept.start();
        Bukkit.getPluginManager().registerEvents(this, plugin);
        Bukkit.getScheduler().runTaskTimer(plugin, () -> {
            if(game==null)game=resolveGame();
            if(game==null||game.getGameWorld()==null)return;
            if (game.getStatus() == GameStatus.RUNNING) tick++;
            if(game.getStatus()==GameStatus.RUNNING){for(var block:changedBlocks.values())event("block_state",Map.of("pos",List.of(block.getX(),block.getY(),block.getZ()),"block",block.getBlockData().getAsString()));}
            changedBlocks.clear();
            if(++frameSequence%2!=0)return;
            if(frameSequence%4==0||worldObjects.isEmpty())worldObjects=worldObjects();
            Map<String,Object> state = state();
            current = gson.toJson(state);
            var lean=new LinkedHashMap<>(state);lean.remove("world_objects");controllerCurrent=gson.toJson(lean);
            if (game.getStatus() == GameStatus.RUNNING&&!recorded) {
                if(frameCount<maxFrames&&recorder!=null&&recorder.append(current)) {
                    var small=Map.<String,Object>of("tick",tick,"players",state.get("players"));
                    if(firstFrame==null)firstFrame=small;lastFrame=small;frameCount++;
                    for(Player player:game.getConnectedPlayers())framePlayers.add(player.getName());
                }else recordingTruncated=true;
            }
        }, 1, 1);
        plugin.getLogger().info("Local observer stream on 127.0.0.1:" + observerPort);
    }
    private void acceptClients() {
        while (!stopping) try {
            Socket socket = listener.accept();
            if (clients.incrementAndGet() > 8) { clients.decrementAndGet(); socket.close(); continue; }
            sockets.add(socket);
            Thread stream = new Thread(() -> {
                try (socket; var out = new BufferedWriter(new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8))) {
                    boolean lean=false;socket.setSoTimeout(200);
                    try{lean="controller".equals(new BufferedReader(new InputStreamReader(socket.getInputStream(),StandardCharsets.UTF_8)).readLine());}catch(SocketTimeoutException ignored){}
                    while (!stopping && !socket.isClosed()) { out.write(lean?controllerCurrent:current); out.newLine(); out.flush(); Thread.sleep(100); }
                } catch (Exception ignored) {} finally { sockets.remove(socket); clients.decrementAndGet(); }
            }, "skyduel-observer-client"); stream.setDaemon(true); stream.start();
        } catch (IOException e) { if (!stopping) plugin.getLogger().warning(e.getMessage()); }
    }
    Game resolveGame(){return org.screamingsandals.bedwars.api.BedwarsAPI.getInstance().getGameByName(arenaName);}
    ClassicRules classic(){return classic;}
    ArenaLease lease(){return lease;}
    @EventHandler(priority=EventPriority.HIGHEST) public void admission(BedwarsPlayerJoinEvent e){
        if(managed&&e.getGame().getName().equals(arenaName)&&(!lease.players.contains(e.getPlayer().getName())||!lease.launched||!lease.startedId.isEmpty())){
            e.setCancelled(true);e.setCancelMessage("This arena is assigned by the local scheduler.");
        }
    }
    @EventHandler public void rebuilt(BedwarsPostRebuildingEvent e){if(e.getGame().getName().equals(arenaName))lease.resetObserved=true;}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true) public void checkRoster(BedwarsGameStartEvent e){
        if(!e.getGame().getName().equals(arenaName)||!managed)return;
        var actual=e.getGame().getConnectedPlayers().stream().map(Player::getName).collect(java.util.stream.Collectors.toSet());
        if(!lease.launched||!actual.equals(new HashSet<>(lease.players))){e.setCancelled(true);return;}
        // Assign from the reservation before teleporting. Joining order cannot shuffle squads.
        if(lease.playersPerTeam>1){
            var concrete=(org.screamingsandals.bedwars.game.Game)e.getGame();
            for(Player player:concrete.getConnectedPlayers()){
                String team=lease.teamOf(player.getName());
                concrete.selectTeam(org.screamingsandals.bedwars.Main.getPlayerGameProfile(player),team,true,true,true);
            }
            for(Player player:concrete.getConnectedPlayers())if(concrete.getTeamOfPlayer(player)==null||!concrete.getTeamOfPlayer(player).getName().equals(lease.teamOf(player.getName())))e.setCancelled(true);
        }
    }
    void reserved(){matchId="";recorded=false;testRun=false;testControlsPaused=false;recorder=null;frameCount=0;firstFrame=null;lastFrame=null;framePlayers.clear();events.clear();current="{\"phase\":\"waiting\"}";}
    private Map<String,Object> state() {
        List<Map<String,Object>> players = new ArrayList<>();
        List<Map<String,Object>> teams = new ArrayList<>();
        for (Player player : game.getConnectedPlayers()) {
            Location p = player.getLocation(); RunningTeam team = game.getTeamOfPlayer(player);
            Map<String,Object> row=new LinkedHashMap<>(Map.of("name", player.getName(), "team", team == null ? "" : team.getName(),
                "pos", List.of(p.getX(),p.getY(),p.getZ()), "yaw", p.getYaw(), "pitch", p.getPitch(),
                "hp", player.getHealth(), "mode", player.getGameMode().name()));
            boolean pendingRespawn=player.getGameMode()==GameMode.SPECTATOR&&respawnUntil.containsKey(player.getName());
            row.put("respawn_pending",pendingRespawn);
            row.put("respawn_seconds",pendingRespawn?Math.max(0,(respawnUntil.get(player.getName())-tick)/20.0):0);
            row.put("held_item",player.getInventory().getItemInMainHand().getType().name());
            row.put("held_stack",itemState(player.getInventory().getItemInMainHand()));
            row.put("offhand_stack",itemState(player.getInventory().getItemInOffHand()));
            row.put("armor_stacks",Arrays.stream(player.getInventory().getArmorContents()).map(this::itemState).toList());
            row.put("eye_height",player.getEyeHeight());row.put("body_yaw",player.getBodyYaw());row.put("main_hand",player.getMainHand().name());
            row.put("entity_id",player.getEntityId());
            var velocity=player.getVelocity();row.put("velocity",List.of(velocity.getX(),velocity.getY(),velocity.getZ()));
            row.put("attack_cooldown",player.getAttackCooldown());row.put("hurt_time",player.getNoDamageTicks());row.put("on_ground",player.isOnGround());
            row.put("absorption",player.getAbsorptionAmount());
            row.put("item_cooldowns",Map.of("ender_pearl",player.getCooldown(Material.ENDER_PEARL)));
            row.put("sneaking",player.isSneaking());row.put("sprinting",player.isSprinting());
            boolean using=player.isHandRaised();
            row.put("using_item",using);row.put("use_ticks",using?player.getActiveItemUsedTime():0);
            row.put("use_remaining_ticks",using?player.getActiveItemRemainingTime():0);
            row.put("use_action",using?useAction(player.getActiveItem()):"NONE");
            row.put("active_hand",using?player.getActiveItemHand().name():"HAND");row.put("sample_tick",tick);
            row.put("swing_tick",swingTicks.getOrDefault(player.getName(),-1000L));
            row.put("swing_duration",swingDuration(player));
            row.put("damage_tick",damageTicks.getOrDefault(player.getName(),-1000L));
            if(digging.containsKey(player.getName()))row.put("dig_target",digging.get(player.getName()));
            row.put("effects",player.getActivePotionEffects().stream().map(e->Map.of("name",e.getType().getKey().getKey(),"amplifier",e.getAmplifier(),"ticks",e.getDuration())).toList());
            row.put("armor",Arrays.stream(player.getInventory().getArmorContents()).map(i->i==null?"AIR":i.getType().name()).toList());
            players.add(row);
        }
        for (RunningTeam team : game.getRunningTeams()) teams.add(Map.of("name",team.getName(),"bed",team.isTargetBlockExists(),"alive",team.isAlive()));
        Map<String,Object> s = new LinkedHashMap<>();
        s.put("arena_id",arenaId);s.put("arena_name",arenaName);s.put("match_id",matchId);s.put("rules_version",rulesVersion);s.put("rules_sha256",rulesHash);s.put("sample_hz",10);
        s.put("phase", game.getStatus().name().toLowerCase());s.put("tick",tick);s.put("players",players);s.put("teams",teams);
        s.put("winner",winner);s.put("reason",reason);s.put("events",new ArrayList<>(events.subList(Math.max(0,events.size()-12),events.size())));
        s.put("test_run",testRun);s.put("test_controls_paused",testControlsPaused);s.put("snapshot_seq",++snapshotSequence);s.put("world_objects",worldObjects);
        s.put("classic",classic.snapshot());
        s.put("projectiles",game.getGameWorld().getNearbyEntities(new Location(game.getGameWorld(),.5,65,.5),projectileRadiusX,64,projectileRadiusZ).stream().filter(e->e instanceof org.bukkit.entity.Projectile||e instanceof org.bukkit.entity.TNTPrimed).limit(64).map(e->{
            Map<String,Object> projectile=new LinkedHashMap<>();projectile.put("id",e.getEntityId());projectile.put("kind",e.getType().name());projectile.put("pos",List.of(e.getLocation().getX(),e.getLocation().getY(),e.getLocation().getZ()));
            var v=e.getVelocity();projectile.put("velocity",List.of(v.getX(),v.getY(),v.getZ()));if(e instanceof org.bukkit.entity.TNTPrimed tnt)projectile.put("fuse_ticks",tnt.getFuseTicks());return projectile;
        }).toList());
        return s;
    }
    private Map<String,Object> worldObjects(){
        var world=game.getGameWorld();var beds=new ArrayList<Map<String,Object>>();
        for(var xyz:bedPositions){
            var block=world.getBlockAt(xyz[0],xyz[1],xyz[2]);
            if(block.getBlockData() instanceof org.bukkit.block.data.type.Bed bed)beds.add(Map.of(
                "pos",List.of(xyz[0],xyz[1],xyz[2]),"color",block.getType().getKey().getKey().replace("_bed",""),
                "part",bed.getPart().name().toLowerCase(),"facing",bed.getFacing().name().toLowerCase()));
        }
        // World-scoped snapshots bypass the spectator bot's short entity tracking range.
        // Reuse one immutable snapshot for two frames; no disk or HTTP in the tick loop.
        var drops=new ArrayList<Map<String,Object>>();int total=0;
        int cap=Math.max(1,Math.min(1024,plugin.getConfig().getInt("observer-max-drops",256)));
        for(var item:world.getEntitiesByClass(org.bukkit.entity.Item.class)){
            if(!item.isValid()||item.getItemStack().getType().isAir())continue;
            var loc=item.getLocation();if(Math.abs(loc.getX())>projectileRadiusX||Math.abs(loc.getZ())>projectileRadiusZ)continue;
            total++;if(drops.size()>=cap)continue;
            drops.add(Map.of("id",item.getUniqueId().toString(),"entity_id",item.getEntityId(),
                "pos",List.of(loc.getX(),loc.getY(),loc.getZ()),"age",item.getTicksLived(),"item",itemState(item.getItemStack())));
        }
        return Map.of("beds",beds,"drops",drops,"drops_total",total,"drops_truncated",total>cap);
    }
    private Map<String,Object> itemState(ItemStack item){
        if(item==null||item.getType().isAir()||item.getAmount()<1)return Map.of("id","air","count",0);
        Map<String,Object> out=new LinkedHashMap<>();out.put("id",item.getType().getKey().getKey());out.put("count",item.getAmount());
        var meta=item.getItemMeta();out.put("enchanted",meta!=null&&meta.hasEnchants());
        if(meta instanceof PotionMeta potion&&potion.hasColor())out.put("tint",potion.getColor().asRGB());
        if(meta instanceof LeatherArmorMeta leather)out.put("tint",leather.getColor().asRGB());
        if(meta instanceof Damageable damaged)out.put("damage",damaged.getDamage());
        if(meta!=null){out.put("unbreakable",meta.isUnbreakable());if(meta.hasDisplayName())out.put("name",ChatColor.stripColor(meta.getDisplayName()));}
        return out;
    }
    private String useAction(ItemStack item){
        if(item==null)return "NONE";String name=item.getType().name();
        if(Set.of("POTION","MILK_BUCKET","HONEY_BOTTLE").contains(name))return "DRINK";
        if(item.getType().isEdible())return "EAT";
        return Set.of("BOW","CROSSBOW","SHIELD","TRIDENT","SPYGLASS","BRUSH").contains(name)?name:"NONE";
    }
    private int swingDuration(Player player){
        var haste=player.getPotionEffect(org.bukkit.potion.PotionEffectType.HASTE);
        if(haste!=null)return Math.max(1,6-(1+haste.getAmplifier()));
        var fatigue=player.getPotionEffect(org.bukkit.potion.PotionEffectType.MINING_FATIGUE);
        return fatigue==null?6:6+(1+fatigue.getAmplifier())*2;
    }
    private void event(String type, Map<String,Object> data) {
        if (events.size() >= maxEvents) {recordingTruncated=true;return;}
        Map<String,Object> row = new LinkedHashMap<>(data); row.put("tick",tick);row.put("type",type);events.add(row);
    }
    void record(String type,Map<String,Object> data){event(type,data);}
    void markTest(){testRun=true;}
    // Private verification commands are fenced by ArenaLease and always produce unscored test replays.
    void validation(String op,com.google.gson.JsonObject request){
        if(game==null||game.getStatus()!=GameStatus.RUNNING||!testRun)throw new IllegalStateException("Test match is not running");
        if(op.equals("validation_hold")){
            if(game.getConnectedPlayers().stream().anyMatch(p->p.getGameMode()!=GameMode.SURVIVAL))throw new IllegalStateException("All test players must be alive before controlled eliminations");
            testControlsPaused=true;
            var teams=(Map<?,?>)((Map<?,?>)ruleDocument.get("map")).get("teams");
            for(Player player:game.getConnectedPlayers()){
                var team=game.getTeamOfPlayer(player);
                var spawn=(List<?>)((Map<?,?>)teams.get(team.getName())).get("spawn");
                player.teleport(new Location(game.getGameWorld(),((Number)spawn.get(0)).doubleValue(),((Number)spawn.get(1)).doubleValue(),((Number)spawn.get(2)).doubleValue()));
                player.setVelocity(new org.bukkit.util.Vector());player.setFireTicks(0);player.setHealth(Math.min(20,player.getMaxHealth()));
            }
        }else if(op.equals("validation_beds_gone")){
            if(!testControlsPaused)throw new IllegalStateException("Hold test agents first");
            classic.testPhase("beds_gone");
        }else if(op.equals("validation_kill")||op.equals("validation_death")){
            if(!testControlsPaused)throw new IllegalStateException("Hold test agents first");
            String name=request.get("player").getAsString();
            if(!lease.players.contains(name))throw new IllegalArgumentException("Player is not in this reservation");
            Player player=Bukkit.getPlayerExact(name);
            if(player==null||!game.getConnectedPlayers().contains(player)||player.getGameMode()!=GameMode.SURVIVAL)throw new IllegalStateException("Test player is not alive in this arena");
            if(op.equals("validation_kill")&&game.getTeamOfPlayer(player).isTargetBlockExists())throw new IllegalStateException("Remove beds before final-death verification");
            player.setHealth(0);
        }else throw new IllegalArgumentException("Unknown validation operation");
    }
    void abortMatch(){
        game=resolveGame();
        if(game==null)return;
        if(matchId.isEmpty()&&!lease.taskId.isEmpty()){matchId=lease.taskId;recorded=false;}
        if(recorded||matchId.isEmpty())return;
        if(game.getStatus()==GameStatus.WAITING)lease.resetObserved=true;
        winner="";reason="operator_stopped";event("aborted",Map.of("reason",reason));saveMatch("aborted");
        stopAndRestart();
    }
    private void stopAndRestart(){
        game.stop();
        Game stopped=game;
        new org.bukkit.scheduler.BukkitRunnable(){int attempts;public void run(){
            if(stopped.getStatus()==GameStatus.DISABLED){stopped.start();cancel();}
            else if(++attempts>=100)cancel();
        }}.runTaskTimer(plugin,2L,2L);
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void purchased(BedwarsItemBoughtEvent e){
        if(e.getGame()==game)event("purchase",Map.of("player",e.getCustomer().getName(),"item",e.getItem().getType().name(),"amount",e.getItem().getAmount(),"price",e.getPrice()));
    }
    @EventHandler public void started(BedwarsGameStartedEvent e) {
        if (!e.getGame().getName().equals(arenaName)) return;
        game=e.getGame();matchId=lease.taskId.isEmpty()?UUID.randomUUID().toString():lease.taskId;tick=0;winner="";reason="";recorded=false;recordingTruncated=false;testRun=lease.testRun;testControlsPaused=false;frameCount=0;firstFrame=null;lastFrame=null;framePlayers.clear();events.clear();respawnUntil.clear();
        swingTicks.clear();damageTicks.clear();useStarted.clear();digging.clear();
        recorder=new ReplayRecorder(plugin.getDataFolder().toPath().resolve("replays").resolve(matchId+".json"),50,4);
        lease.started(matchId);
        event("match_start", Map.of("players",game.getConnectedPlayers().stream().map(Player::getName).toList()));
    }
    @EventHandler(priority=EventPriority.MONITOR) public void left(BedwarsPlayerLeaveEvent e){
        if(managed&&e.getGame()==game&&!recorded&&!matchId.isEmpty()&&game.getStatus()==GameStatus.RUNNING){
            winner="";reason="participant_disconnected";event("aborted",Map.of("reason",reason));saveMatch("aborted");
            Bukkit.getScheduler().runTask(plugin,this::stopAndRestart);
        }
    }
    @EventHandler public void ending(BedwarsGameEndingEvent e) {
        if (e.getGame()!=game) return;
        winner=e.getWinningTeam()==null?"":e.getWinningTeam().getName();reason=winner.isEmpty()?"draw":"last_team_alive";
        event("result",Map.of("winner",winner,"reason",reason));
    }
    @EventHandler(priority=EventPriority.MONITOR) public void tick(BedwarsGameTickEvent e) {
        if (e.getGame()!=game || e.getStatus()!=GameStatus.RUNNING) return;
        if (e.getCountdown()==0 && e.getNextStatus()==GameStatus.GAME_END_CELEBRATING) {
            winner="";reason="time_limit";event("result",Map.of("winner",winner,"reason",reason));
        }
    }
    @EventHandler public void ended(BedwarsGameEndEvent e) {
        if (e.getGame()!=game || recorded || matchId.isEmpty()) return;
        if (reason.isEmpty()) {reason="stopped_without_result";saveMatch("aborted");}
        else saveMatch("complete");
    }
    @EventHandler public void bed(BedwarsTargetBlockDestroyedEvent e) {
        if(e.getGame()!=game)return;
        event("bed_destroyed",Map.of("team",e.getTeam().getName(),"player",e.getPlayer()==null?"":e.getPlayer().getName()));
        // Eligibility is earned at death; losing the bed preserves an already queued respawn.
    }
    @EventHandler public void death(BedwarsPlayerKilledEvent e) {
        if(e.getGame()!=game)return;
        String name=e.getPlayer().getName();RunningTeam team=game.getTeamOfPlayer(e.getPlayer());boolean canRespawn=team!=null&&team.isTargetBlockExists();
        if(canRespawn)respawnUntil.put(name,tick+100);else respawnUntil.remove(name);
        event("death",Map.of("player",name,"team",team==null?lease.teamOf(name):team.getName(),"final",!canRespawn,"killer",e.getKiller()==null?"":e.getKiller().getName()));
    }
    @EventHandler public void respawn(BedwarsPlayerRespawnedIngameEvent e){if(e.getGame()==game){
        respawnUntil.remove(e.getPlayer().getName());event("respawn",Map.of("player",e.getPlayer().getName(),"team",e.getTeam().getName()));
    }}
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void explosion(EntityExplodeEvent e){
        if(game!=null&&game.getStatus()==GameStatus.RUNNING&&e.getLocation().getWorld().equals(game.getGameWorld()))event("explosion",Map.of("pos",List.of(e.getLocation().getX(),e.getLocation().getY(),e.getLocation().getZ()),"blocks",e.blockList().stream().map(b->List.of(b.getX(),b.getY(),b.getZ())).toList()));
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void placed(BlockPlaceEvent e) {
        if (game==null || game.getStatus()!=GameStatus.RUNNING || !game.getConnectedPlayers().contains(e.getPlayer())) return;
        event("block_place",Map.of("player",e.getPlayer().getName(),"pos",List.of(e.getBlock().getX(),e.getBlock().getY(),e.getBlock().getZ()),"block",e.getBlock().getBlockData().getAsString()));
    }
    private boolean participating(Player p){return game!=null&&game.getStatus()==GameStatus.RUNNING&&game.getConnectedPlayers().contains(p)&&p.getGameMode()==GameMode.SURVIVAL;}
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void swing(PlayerAnimationEvent e){
        if(!participating(e.getPlayer()))return;
        // A new click before the previous arc reaches its midpoint does not reset it.
        if(tick-swingTicks.getOrDefault(e.getPlayer().getName(),-1000L)>=swingDuration(e.getPlayer())/2.0)swingTicks.put(e.getPlayer().getName(),tick);
        event("swing",Map.of("player",e.getPlayer().getName(),"item",e.getPlayer().getInventory().getItemInMainHand().getType().name()));
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void consumed(PlayerItemConsumeEvent e){
        if(participating(e.getPlayer()))event("item_consume",Map.of("player",e.getPlayer().getName(),"item",e.getItem().getType().name(),"action",useAction(e.getItem())));
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void shot(EntityShootBowEvent e){
        if(e.getEntity() instanceof Player p&&participating(p))event("bow_shot",Map.of("player",p.getName(),"force",e.getForce(),"projectile",e.getProjectile().getEntityId()));
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void hurt(EntityDamageEvent e){
        if(!(e.getEntity() instanceof Player p)||!participating(p)||e.getFinalDamage()<=0)return;
        damageTicks.put(p.getName(),tick);String attacker="";
        if(e instanceof EntityDamageByEntityEvent hit){
            if(hit.getDamager() instanceof Player a)attacker=a.getName();
            else if(hit.getDamager() instanceof org.bukkit.entity.Projectile projectile&&projectile.getShooter() instanceof Player a)attacker=a.getName();
        }
        event("damage",Map.of("player",p.getName(),"attacker",attacker,"amount",e.getFinalDamage(),"raw_amount",e.getDamage(),"cause",e.getCause().name()));
    }
    @EventHandler(priority=EventPriority.MONITOR) public void damageProbe(EntityDamageEvent e){
        if(!testRun||!(e.getEntity() instanceof Player p)||!participating(p))return;
        var source=e.getDamageSource();Map<String,Object> row=new LinkedHashMap<>();row.put("player",p.getName());row.put("cancelled",e.isCancelled());row.put("raw",e.getDamage());row.put("cause",e.getCause().name());
        row.put("damager",e instanceof EntityDamageByEntityEvent hit?hit.getDamager().getType().name():"none");row.put("direct",source.getDirectEntity()==null?"none":source.getDirectEntity().getType().name());row.put("causing",source.getCausingEntity()==null?"none":source.getCausingEntity().getType().name());row.put("invulnerable",p.isInvulnerable());row.put("spawn_protected",((org.screamingsandals.bedwars.game.Game)game).isProtectionActive(p));event("test_damage_probe",row);
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void digging(BlockDamageEvent e){
        if(!participating(e.getPlayer()))return;
        var pos=List.of(e.getBlock().getX(),e.getBlock().getY(),e.getBlock().getZ());digging.put(e.getPlayer().getName(),pos);
        event("dig_start",Map.of("player",e.getPlayer().getName(),"pos",pos));
    }
    @EventHandler(priority=EventPriority.MONITOR) public void digAborted(BlockDamageAbortEvent e){digging.remove(e.getPlayer().getName());}
    private void changed(org.bukkit.block.Block block){
        if(game==null||game.getStatus()!=GameStatus.RUNNING||!block.getWorld().equals(game.getGameWorld()))return;
        changedBlocks.put(block.getX()+","+block.getY()+","+block.getZ(),block);
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void bucketEmpty(PlayerBucketEmptyEvent e){if(participating(e.getPlayer())){changed(e.getBlock());event("item_use",Map.of("player",e.getPlayer().getName(),"item",e.getBucket().name(),"action","BUCKET_EMPTY"));}}
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void bucketFill(PlayerBucketFillEvent e){if(participating(e.getPlayer())){changed(e.getBlock());event("item_use",Map.of("player",e.getPlayer().getName(),"item",e.getBucket().name(),"action","BUCKET_FILL"));}}
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void fluid(BlockFromToEvent e){changed(e.getToBlock());}
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void sponge(SpongeAbsorbEvent e){changed(e.getBlock());for(var block:e.getBlocks())changed(block.getBlock());}
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void spread(BlockSpreadEvent e){changed(e.getBlock());}
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void fade(BlockFadeEvent e){changed(e.getBlock());}
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void burn(BlockBurnEvent e){changed(e.getBlock());}
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void ignite(BlockIgniteEvent e){changed(e.getBlock());}
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void broken(BlockBreakEvent e) {
        if(game==null || game.getStatus()!=GameStatus.RUNNING || !game.getConnectedPlayers().contains(e.getPlayer())) return;
        event("block_break",Map.of("player",e.getPlayer().getName(),"pos",List.of(e.getBlock().getX(),e.getBlock().getY(),e.getBlock().getZ())));
        digging.remove(e.getPlayer().getName());
    }
    private void saveMatch(String status) {
        if(recorded)return;recorded=true;lease.saving=true;
        Map<String,Object> match=new LinkedHashMap<>();match.put("arena_id",arenaId);match.put("arena_name",arenaName);match.put("status",testRun?"test":recordingTruncated?"recording_incomplete":status);match.put("match_id",matchId);match.put("rules_version",rulesVersion);match.put("rules_sha256",rulesHash);match.put("rules",ruleDocument);
        match.put("winner",winner);match.put("reason",reason);match.put("events",new ArrayList<>(events));
        match.put("frame_count",frameCount);match.put("frame_players",new ArrayList<>(framePlayers));match.put("recording_format","batched-json-v1");
        var summary=new LinkedHashMap<>(match);summary.put("frames",firstFrame==null?List.of():List.of(firstFrame,lastFrame));
        String id=matchId;
        if(recorder==null)recorder=new ReplayRecorder(plugin.getDataFolder().toPath().resolve("replays").resolve(id+".json"),50,4);
        recordingDone=recorder.finish(gson.toJson(match),gson.toJson(summary)).whenComplete((unused,error)->{
            if(error==null){lease.savedId=id;lease.saving=false;}
            else{lease.error="Replay write failed: "+error;lease.saving=false;plugin.getLogger().severe(lease.error);}
        });
    }
    public void close() {
        if(game!=null&&!recorded&&!matchId.isEmpty()){reason="server_stopped";saveMatch("aborted");}
        stopping=true;try{listener.close();}catch(Exception ignored){}
        for(Socket socket:sockets)try{socket.close();}catch(IOException ignored){}
        try{recordingDone.get(20,TimeUnit.SECONDS);}catch(InterruptedException e){Thread.currentThread().interrupt();}catch(Exception e){plugin.getLogger().warning("Replay shutdown: "+e);}
    }
}
