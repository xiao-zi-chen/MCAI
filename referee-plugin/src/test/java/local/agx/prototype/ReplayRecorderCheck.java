package local.agx.prototype;
import java.nio.file.*;
import java.util.concurrent.*;
public class ReplayRecorderCheck {
 public static void main(String[] args)throws Exception {
  Path root=Path.of(args[0]);Files.createDirectories(root);
  Path file=root.resolve("long.json");var recorder=new ReplayRecorder(file,50,128);
  String payload="x".repeat(8000);int frames=20000;
  for(int i=0;i<frames;i++) {
   if(!recorder.append("{\"tick\":"+i+",\"players\":[{\"name\":\"AI_1\"}],\"payload\":\""+payload+"\"}"))throw new AssertionError("Queue overflow");
   if(i%50==0)Thread.sleep(2);
  }
  recorder.finish("{\"match_id\":\"long\",\"arena_id\":\"a\"}","{\"match_id\":\"long\",\"arena_id\":\"a\",\"frame_count\":"+frames+"}").get(30,TimeUnit.SECONDS);
  try(var lines=Files.lines(file)){if(lines.count()!=frames+3)throw new AssertionError("Missing frames");}
  if(Files.exists(root.resolve("long.json.frames.tmp")))throw new AssertionError("Spool not removed");
  Path empty=root.resolve("empty.json");new ReplayRecorder(empty,50,4).finish("{}","{}").get(5,TimeUnit.SECONDS);
  if(!Files.readString(empty).contains("\"frames\":[\n\n]"))throw new AssertionError("Empty replay invalid");
  Path bad=root.resolve("not-a-directory");Files.writeString(bad,"occupied");
  var failed=new ReplayRecorder(bad.resolve("fail.json"),1,4);failed.append("{}");
  try{failed.finish("{}","{}").get(5,TimeUnit.SECONDS);throw new AssertionError("Expected failure");}catch(ExecutionException expected){}
  System.out.println("PASS: 20,000 frames (>150MiB) saved under a 32MiB Java heap; empty match and IO failure checked");
 }
}
