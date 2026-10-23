package local.agx.prototype;

import com.google.gson.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import org.bukkit.*;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;
import org.screamingsandals.bedwars.Main;

/** One isolated recorder/economy per arena; a localhost control plane runs on the server thread. */
public final class SkyDuelReferee extends JavaPlugin {
    private final Map<String,ArenaReferee> arenas=new LinkedHashMap<>();
    private final Set<Socket> sockets=ConcurrentHashMap.newKeySet();
    private final Gson gson=new Gson();
    private ServerSocket control;
    private Map<String,Object> performance=Map.of();
    private long measuredAt;
    private volatile boolean stopping;
    final String bootId=UUID.randomUUID().toString();
    byte[] ruleBytes() throws IOException {
        var local=getDataFolder().toPath().resolve("competition-rules.json");
        if(java.nio.file.Files.exists(local))return java.nio.file.Files.readAllBytes(local);
        try(var input=getResource("competition-rules.json")){return input.readAllBytes();}
    }
    @Override public void onEnable(){
        getConfig().addDefault("observer-port",25600);getConfig().addDefault("control-port",25610);
        getConfig().options().copyDefaults(true);saveConfig();
        var specs=getConfig().getMapList("arenas");
        if(specs.isEmpty())specs=List.of(Map.of("id","arena-1","name","SkyDuel","world","bedwars-v6","observer-port",getConfig().getInt("observer-port"),"managed",false));
        Set<String> worlds=new HashSet<>(),names=new HashSet<>();Set<Integer> ports=new HashSet<>();
        for(var spec:specs){
            String id=Objects.toString(spec.get("id")),name=Objects.toString(spec.get("name")),world=Objects.toString(spec.get("world"));
            int port=((Number)spec.get("observer-port")).intValue();
            if(!id.matches("[a-zA-Z0-9_-]{1,32}")||arenas.containsKey(id)||!worlds.add(world)||!names.add(name)||!ports.add(port))throw new IllegalArgumentException("Arena IDs, names, worlds and observer ports must be unique");
            arenas.put(id,new ArenaReferee(this,id,name,world,port,Boolean.TRUE.equals(spec.get("managed"))));
        }
        getCommand("teamshop").setExecutor((sender,cmd,label,args)->{if(sender instanceof Player p)arenas.values().forEach(a->a.classic().openFor(p));return true;});
        getCommand("skyduel").setExecutor((sender,cmd,label,args)->{
            if(sender instanceof Player)return true;
            var first=arenas.values().iterator().next();
            if(args.length>0&&args[0].equals("status")){sender.sendMessage(gson.toJson(status()));return true;}
            if(args.length==3&&args[0].equals("spectate")){
                try{
                    var arena=arenas.get(args[1]);var camera=Bukkit.getPlayerExact(args[2]);
                    if(arena==null||camera==null||!(camera.getName().startsWith("Camera_")||camera.getName().equals("MapCamera")))throw new IllegalArgumentException("Unknown arena or spectator account");
                    for(var other:arenas.values()){var game=other.resolveGame();if(game!=null&&game.getConnectedPlayers().contains(camera))throw new IllegalArgumentException("A participant cannot be moved as a spectator");}
                    var world=Bukkit.getWorld(arena.worldName);if(world==null)throw new IllegalStateException("Arena world is not loaded");
                    var map=JsonParser.parseString(new String(ruleBytes(),StandardCharsets.UTF_8)).getAsJsonObject().getAsJsonObject("map");
                    var low=map.getAsJsonArray("build_min");var high=map.getAsJsonArray("build_max");
                    double x=Math.max(Math.abs(low.get(0).getAsDouble()),Math.abs(high.get(0).getAsDouble())),z=Math.max(Math.abs(low.get(2).getAsDouble()),Math.abs(high.get(2).getAsDouble()));
                    int distance=Math.max(6,(int)Math.ceil(Math.hypot(x,z)/16)+2);if(distance>16)throw new IllegalArgumentException("Map exceeds configured spectator coverage limit");
                    camera.setGameMode(GameMode.SPECTATOR);camera.setViewDistance(distance);camera.setSendViewDistance(distance);camera.setSimulationDistance(2);
                    if(!camera.teleport(new Location(world,.5,map.get("surface_y").getAsDouble()+26,.5,0,45)))throw new IllegalStateException("Spectator teleport was rejected");
                    sender.sendMessage(gson.toJson(Map.of("ok",true,"arena_id",arena.arenaId,"world",world.getName(),"world_key",world.getKey().toString(),"view_distance",distance)));
                }catch(Exception error){sender.sendMessage(gson.toJson(Map.of("ok",false,"error",Objects.toString(error.getMessage(),"Spectator setup failed"))));}
                return true;
            }
            if(args.length>0&&args[0].equals("abort")){arenas.values().forEach(ArenaReferee::abortMatch);sender.sendMessage("Local matches aborted and saved");return true;}
            if(args.length>0&&args[0].equals("lock")){getConfig().set("debug-controls",false);saveConfig();return true;}
            if(args.length>0&&args[0].equals("test")){getConfig().set("debug-controls",true);first.markTest();return true;}
            if(!getConfig().getBoolean("debug-controls",false)){sender.sendMessage("Debug controls disabled");return true;}
            if(args.length==4&&args[0].equals("grant")){
                Player p=Bukkit.getPlayerExact(args[1]);var resource=Main.getSpawnerType(args[2]);int n=Integer.parseInt(args[3]);
                if(p!=null&&resource!=null&&n>0&&n<=256){arenas.values().stream().filter(a->p.getWorld().getName().equals(a.worldName)).forEach(ArenaReferee::markTest);p.getInventory().addItem(resource.getStack(n));}
            }else if(args.length==2&&args[0].equals("phase"))first.classic().testPhase(args[1]);
            return true;
        });
        try{control=new ServerSocket();control.bind(new InetSocketAddress("127.0.0.1",getConfig().getInt("control-port")));}catch(IOException e){throw new IllegalStateException(e);}
        Thread accept=new Thread(()->{while(!stopping)try{
            Socket socket=control.accept();if(sockets.size()>=16){socket.close();continue;}sockets.add(socket);
            Thread client=new Thread(()->serve(socket),"skyduel-control-client");client.setDaemon(true);client.start();
        }catch(IOException e){if(!stopping)getLogger().warning(e.getMessage());}},"skyduel-control");accept.setDaemon(true);accept.start();
    }
    private Map<String,Object> performance(){
        long now=System.nanoTime();if(now-measuredAt<500_000_000L&&!performance.isEmpty())return performance;
        double[] ticks=Arrays.stream(Bukkit.getServer().getTickTimes()).filter(n->n>0).mapToDouble(n->n/1_000_000.0).sorted().toArray();
        Map<String,Object> window=new LinkedHashMap<>();window.put("count",ticks.length);
        if(ticks.length>0){window.put("mean_ms",Arrays.stream(ticks).average().orElse(0));window.put("p95_ms",ticks[(int)Math.ceil(ticks.length*.95)-1]);window.put("p99_ms",ticks[(int)Math.ceil(ticks.length*.99)-1]);window.put("max_ms",ticks[ticks.length-1]);window.put("over_50ms",Arrays.stream(ticks).filter(n->n>50).count());}
        var memory=java.lang.management.ManagementFactory.getMemoryMXBean().getHeapMemoryUsage();
        long gcCount=0,gcTime=0;for(var gc:java.lang.management.ManagementFactory.getGarbageCollectorMXBeans()){gcCount+=Math.max(0,gc.getCollectionCount());gcTime+=Math.max(0,gc.getCollectionTime());}
        performance=Map.of("tick_window",window,"heap",Map.of("used_mb",memory.getUsed()/1048576,"committed_mb",memory.getCommitted()/1048576,"max_mb",memory.getMax()/1048576),"gc",Map.of("count",gcCount,"time_ms",gcTime));measuredAt=now;return performance;
    }
    private Map<String,Object> status(){return Map.of("boot_id",bootId,"tps",Bukkit.getTPS()[0],"mspt",Bukkit.getAverageTickTime(),"performance",performance(),"arenas",arenas.values().stream().map(a->a.lease().status()).toList());}
    private Object dispatch(JsonObject req)throws IOException{
        String op=req.get("op").getAsString();if(op.equals("status"))return status();
        ArenaReferee arena=arenas.get(req.get("arena_id").getAsString());if(arena==null)throw new IllegalArgumentException("Unknown arena");
        if(!arena.managed)throw new IllegalStateException("Arena is not managed");
        return arena.lease().command(op,req);
    }
    private void serve(Socket socket){
        try(socket;var in=new BufferedReader(new InputStreamReader(socket.getInputStream(),StandardCharsets.UTF_8));var out=new BufferedWriter(new OutputStreamWriter(socket.getOutputStream(),StandardCharsets.UTF_8))){
            while(!stopping){
                StringBuilder buffer=new StringBuilder();int ch;while((ch=in.read())!=-1&&ch!='\n'){if(buffer.length()>=8192)throw new IOException("Control request too large");buffer.append((char)ch);}if(ch==-1)break;
                JsonObject request=JsonParser.parseString(buffer.toString()).getAsJsonObject();String id=request.has("id")?request.get("id").getAsString():"";
                CompletableFuture<Object> result=new CompletableFuture<>();Bukkit.getScheduler().runTask(this,()->{try{result.complete(dispatch(request));}catch(Exception e){result.completeExceptionally(e);}});
                Map<String,Object> response;
                try{response=Map.of("id",id,"ok",true,"data",result.get(15,TimeUnit.SECONDS));}
                catch(Exception e){response=Map.of("id",id,"ok",false,"error",Objects.toString(e.getCause()==null?e.getMessage():e.getCause().getMessage(),"Control failure"));}
                out.write(gson.toJson(response));out.newLine();out.flush();
            }
        }catch(Exception e){if(!stopping)getLogger().fine("Control connection closed: "+e.getMessage());}finally{sockets.remove(socket);}
    }
    @Override public void onDisable(){stopping=true;if(control!=null)try{control.close();}catch(IOException ignored){}for(var s:sockets)try{s.close();}catch(IOException ignored){}arenas.values().forEach(ArenaReferee::close);}
}
