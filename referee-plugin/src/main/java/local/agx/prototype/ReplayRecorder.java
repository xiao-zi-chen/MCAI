package local.agx.prototype;

import java.io.*;
import java.nio.channels.Channels;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

/** Bounded batches keep disk IO and whole-match serialization off the tick thread. */
final class ReplayRecorder {
    private final Path target, spool, summary;
    private final ThreadPoolExecutor writer;
    private final int batchSize;
    private List<String> pending = new ArrayList<>();
    private volatile Throwable failure;
    private boolean finished;

    ReplayRecorder(Path target, int batchSize, int queueBatches) {
        this.target=target;this.batchSize=batchSize;
        spool=target.resolveSibling(target.getFileName()+".frames.tmp");
        summary=target.getParent().resolve("results").resolve(target.getFileName());
        writer=new ThreadPoolExecutor(1,1,0,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<>(queueBatches),r->{
            Thread t=new Thread(r,"skyduel-replay-writer");t.setDaemon(true);return t;
        });
    }
    boolean append(String frame) {
        if(finished||failure!=null)return false;
        pending.add(frame);
        return pending.size()<batchSize||flush();
    }
    private boolean flush() {
        if(pending.isEmpty())return failure==null;
        List<String> batch=pending;pending=new ArrayList<>();
        try {writer.execute(()->{
            if(failure!=null)return;
            try {
                Files.createDirectories(target.getParent());
                try(var out=Files.newBufferedWriter(spool,StandardCharsets.UTF_8,StandardOpenOption.CREATE,StandardOpenOption.APPEND)) {
                    for(String frame:batch){out.write(frame);out.newLine();}
                }
            }catch(IOException e){failure=e;}
        });return true;}catch(RejectedExecutionException e){failure=e;return false;}
    }
    CompletableFuture<Void> finish(String metadataJson, String summaryJson) {
        if(finished)throw new IllegalStateException("Recorder already finished");
        finished=true;flush();var done=new CompletableFuture<Void>();
        try {writer.execute(()->{
            try {
                if(failure!=null)throw new IOException("Replay batch failed",failure);
                Files.createDirectories(target.getParent());
                Path temp=target.resolveSibling(target.getFileName()+".tmp");
                try(var channel=FileChannel.open(temp,StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE);
                    var out=new BufferedWriter(Channels.newWriter(channel,StandardCharsets.UTF_8))) {
                    out.write(metadataJson.substring(0,metadataJson.length()-1));out.write(",\n\"frames\":[\n");
                    if(Files.exists(spool))try(var in=Files.newBufferedReader(spool,StandardCharsets.UTF_8)) {
                        boolean first=true;String line;
                        while((line=in.readLine())!=null){if(!first)out.write(",\n");out.write(line);first=false;}
                    }
                    out.write("\n]}\n");out.flush();channel.force(true);
                }
                move(temp,target);
                Files.createDirectories(summary.getParent());
                Path small=summary.resolveSibling(summary.getFileName()+".tmp");
                try(var channel=FileChannel.open(small,StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE)) {
                    var bytes=StandardCharsets.UTF_8.encode(summaryJson);while(bytes.hasRemaining())channel.write(bytes);channel.force(true);
                }
                move(small,summary);Files.deleteIfExists(spool);done.complete(null);
            }catch(Throwable e){failure=e;done.completeExceptionally(e);}
        });}catch(RejectedExecutionException e){failure=e;done.completeExceptionally(e);}
        writer.shutdown();return done;
    }
    private static void move(Path from,Path to)throws IOException {
        try{Files.move(from,to,StandardCopyOption.ATOMIC_MOVE);}catch(AtomicMoveNotSupportedException e){Files.move(from,to);}
    }
}
