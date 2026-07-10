package com.kya.pvprobo.thread;

import java.util.concurrent.Callable;
import java.util.concurrent.TimeUnit;
import org.bukkit.Bukkit;
import org.bukkit.plugin.Plugin;

public final class MainThreadBridge {
    private final Plugin plugin;
    private final long timeoutMs;

    public MainThreadBridge(Plugin plugin, long timeoutMs) {
        this.plugin = plugin;
        this.timeoutMs = timeoutMs;
    }

    public <T> T call(Callable<T> task) throws Exception {
        if (Bukkit.isPrimaryThread()) {
            return task.call();
        }
        return Bukkit.getScheduler().callSyncMethod(plugin, task).get(timeoutMs, TimeUnit.MILLISECONDS);
    }
}

