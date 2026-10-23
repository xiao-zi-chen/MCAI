package local.agx.prototype;

import com.google.gson.*;
import java.io.*;
import java.nio.*;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import org.bukkit.*;
import org.screamingsandals.bedwars.api.game.GameStatus;

/** A reservation never expires into an occupied arena. All commands are fenced by task + token. */
final class ArenaLease {
    private final SkyDuelReferee plugin;
    private final ArenaReferee arena;
    private final Path journal;
    private final Gson gson=new Gson();
    private record ExpectedBed(int x,int y,int z,Material material,org.bukkit.block.BlockFace facing,org.bukkit.block.data.type.Bed.Part part) {}
    private final List<ExpectedBed> bedBlocks=new ArrayList<>();
    String taskId="",token="",startedId="",lastReleased="";
    List<String> players=List.of();
    List<String> teamNames=List.of();
    int playersPerTeam,requiredPlayers;
    String teamOf(String name){int index=players.indexOf(name);return index<0?"":teamNames.get(index/playersPerTeam);}
    boolean launched,resetObserved=true,testRun;
    volatile boolean saving;
    volatile String savedId="",error="";
    ArenaLease(SkyDuelReferee plugin,ArenaReferee arena){
        this.plugin=plugin;this.arena=arena;journal=plugin.getDataFolder().toPath().resolve("leases").resolve(arena.arenaId+".json");
        try{
            var rules=JsonParser.parseString(new String(plugin.ruleBytes(),StandardCharsets.UTF_8)).getAsJsonObject();
            var teams=rules.getAsJsonObject("map").getAsJsonObject("teams");
            teamNames=new ArrayList<>(teams.keySet());playersPerTeam=rules.getAsJsonObject("match").get("players_per_team").getAsInt();requiredPlayers=teamNames.size()*playersPerTeam;
            for(var team:teams.entrySet()){
                var spec=team.getValue().getAsJsonObject();var xyz=spec.getAsJsonArray("bed");int x=xyz.get(0).getAsInt(),y=xyz.get(1).getAsInt(),z=xyz.get(2).getAsInt();
                var foot=spec.getAsJsonArray("bed_foot");
                int fx=foot==null?x-Integer.signum(spec.get("base_block_x").getAsInt()):foot.get(0).getAsInt();
                int fy=foot==null?y:foot.get(1).getAsInt(),fz=foot==null?z:foot.get(2).getAsInt();
                var facing=x>fx?org.bukkit.block.BlockFace.EAST:x<fx?org.bukkit.block.BlockFace.WEST:z>fz?org.bukkit.block.BlockFace.SOUTH:org.bukkit.block.BlockFace.NORTH;
                var material=Material.valueOf(spec.get("color").getAsString().toUpperCase(Locale.ROOT)+"_BED");
                bedBlocks.add(new ExpectedBed(x,y,z,material,facing,org.bukkit.block.data.type.Bed.Part.HEAD));
                bedBlocks.add(new ExpectedBed(fx,fy,fz,material,facing,org.bukkit.block.data.type.Bed.Part.FOOT));
            }
        }catch(IOException e){throw new IllegalStateException(e);}
        if(Files.exists(journal))try{
            JsonObject row=JsonParser.parseString(Files.readString(journal)).getAsJsonObject();
            taskId=row.get("task_id").getAsString();token=row.get("token").getAsString();lastReleased=row.has("last_released")?row.get("last_released").getAsString():"";
            if(!taskId.isEmpty()){error="server_restarted_during_reservation";resetObserved=false;}
        }catch(Exception e){error="Unreadable reservation journal";resetObserved=false;}
    }
    static void durableWrite(Path target,String text)throws IOException{
        Files.createDirectories(target.getParent());Path temp=target.resolveSibling(target.getFileName()+".tmp");
        try(var channel=FileChannel.open(temp,StandardOpenOption.CREATE,StandardOpenOption.TRUNCATE_EXISTING,StandardOpenOption.WRITE)){
            ByteBuffer bytes=StandardCharsets.UTF_8.encode(text);while(bytes.hasRemaining())channel.write(bytes);channel.force(true);
        }
        try{Files.move(temp,target,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);}catch(AtomicMoveNotSupportedException e){Files.move(temp,target,StandardCopyOption.REPLACE_EXISTING);}
    }
    private void persist()throws IOException{durableWrite(journal,gson.toJson(Map.of("task_id",taskId,"token",token,"players",players,"boot_id",plugin.bootId,"last_released",lastReleased,"test_run",testRun)));}
    void started(String id){startedId=id;resetObserved=false;}
    private boolean bedsReady(){
        World world=Bukkit.getWorld(arena.worldName);if(world==null)return false;
        for(var expected:bedBlocks){
            var block=world.getBlockAt(expected.x(),expected.y(),expected.z());
            if(block.getType()!=expected.material()||!(block.getBlockData() instanceof org.bukkit.block.data.type.Bed bed)||bed.getFacing()!=expected.facing()||bed.getPart()!=expected.part())return false;
        }
        return true;
    }
    Map<String,Object> status(){
        var game=arena.resolveGame();String gameState=game==null?"missing":game.getStatus().name().toLowerCase();
        boolean empty=game!=null&&game.getConnectedPlayers().isEmpty();
        boolean restored=game!=null&&game.getStatus()==GameStatus.WAITING&&empty&&resetObserved&&bedsReady();
        boolean saved=!taskId.isEmpty()&&savedId.equals(taskId);
        String state=!error.isEmpty()?"quarantined":taskId.isEmpty()?(restored?"available":"unavailable"):
            saved?(restored?"ready_to_release":"resetting"):saving?"saving":!startedId.isEmpty()?"running":"reserved";
        Map<String,Object> row=new LinkedHashMap<>();row.put("arena_id",arena.arenaId);row.put("arena_name",arena.arenaName);row.put("world",arena.worldName);row.put("managed",arena.managed);
        row.put("beds_ready",bedsReady());row.put("test_run",testRun);row.put("required_players",requiredPlayers);row.put("players_per_team",playersPerTeam);row.put("team_names",teamNames);
        row.put("state",state);row.put("game_state",gameState);row.put("task_id",taskId);row.put("started_id",startedId);row.put("last_released",lastReleased);row.put("launched",launched);
        row.put("players",game==null?List.of():game.getConnectedPlayers().stream().map(p->p.getName()).toList());row.put("assigned",players);row.put("saved",saved);row.put("restored",restored);row.put("error",error);return row;
    }
    Object command(String op,JsonObject req)throws IOException{
        String id=req.get("task_id").getAsString(),key=req.get("token").getAsString();
        if(!id.matches("[a-zA-Z0-9_-]{1,64}")||!key.matches("[a-zA-Z0-9_-]{16,80}"))throw new IllegalArgumentException("Invalid task or fence token");
        if(op.equals("reserve")){
            if(taskId.equals(id)&&token.equals(key))return status();
            if(!status().get("state").equals("available"))throw new IllegalStateException("Arena is not available");
            List<String> names=new ArrayList<>();for(var value:req.getAsJsonArray("players")){String name=value.getAsString();if(!name.matches("[A-Za-z0-9_]{3,16}"))throw new IllegalArgumentException("Invalid player name");names.add(name);}
            if(names.size()!=requiredPlayers||names.stream().map(s->s.toLowerCase(Locale.ROOT)).distinct().count()!=requiredPlayers)throw new IllegalArgumentException(requiredPlayers+" different players required");
            taskId=id;token=key;players=List.copyOf(names);launched=false;startedId="";savedId="";saving=false;resetObserved=false;testRun=false;arena.reserved();
            try{persist();}catch(IOException e){error="reservation_write_failed";throw e;}return status();
        }
        if(op.equals("release")&&taskId.isEmpty()&&lastReleased.equals(id+"/"+key))return status();
        if(!taskId.equals(id)||!token.equals(key))throw new IllegalStateException("Stale reservation token");
        if(op.equals("validation_start")){
            if(!savedId.isEmpty())throw new IllegalStateException("Match already saved");
            testRun=true;persist();arena.markTest();return status();
        }
        if(op.startsWith("validation_")){
            if(!testRun||saving||!savedId.isEmpty())throw new IllegalStateException("An active test reservation is required");
            arena.validation(op,req);return status();
        }
        if(op.equals("launch")){
            if(!error.isEmpty())throw new IllegalStateException(error);
            boolean grant=!launched;launched=true;return Map.of("granted",grant);
        }
        if(op.equals("abort")){arena.abortMatch();return status();}
        if(op.equals("release")){
            if(!status().get("state").equals("ready_to_release"))throw new IllegalStateException("Result or map reset is not ready");
            lastReleased=id+"/"+key;taskId="";token="";players=List.of();launched=false;startedId="";testRun=false;
            try{persist();}catch(IOException e){error="release_write_failed";throw e;}return status();
        }
        if(op.equals("quarantine")){error="scheduler_quarantined";return status();}
        throw new IllegalArgumentException("Unknown control operation");
    }
}
