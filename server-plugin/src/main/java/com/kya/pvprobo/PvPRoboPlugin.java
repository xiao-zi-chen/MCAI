package com.kya.pvprobo;

import com.kya.pvprobo.command.PvPRoboCommand;
import com.kya.pvprobo.control.ControlServer;
import com.kya.pvprobo.control.PluginCommandHandler;
import com.kya.pvprobo.game.AfkService;
import com.kya.pvprobo.game.ArenaService;
import com.kya.pvprobo.game.DuelService;
import com.kya.pvprobo.game.EpisodeRegistry;
import com.kya.pvprobo.game.PvPEventListener;
import com.kya.pvprobo.game.ReplayService;
import com.kya.pvprobo.game.SkinProfileService;
import com.kya.pvprobo.game.SnapshotService;
import com.kya.pvprobo.monitoring.MonitoringServer;
import com.kya.pvprobo.monitoring.MonitoringStore;
import com.kya.pvprobo.monitoring.RecordingCatalog;
import com.kya.pvprobo.thread.MainThreadBridge;
import java.util.List;
import org.bukkit.command.PluginCommand;
import org.bukkit.plugin.java.JavaPlugin;

public final class PvPRoboPlugin extends JavaPlugin {
    private ControlServer controlServer;
    private MonitoringStore monitoringStore;
    private MonitoringServer monitoringServer;
    private AfkService afkService;

    @Override
    public void onEnable() {
        saveDefaultConfig();

        List<String> spectators = getConfig().getStringList("spectators.usernames");
        EpisodeRegistry episodeRegistry = new EpisodeRegistry(
            getConfig().getInt("episode.max-ticks", 2400),
            getConfig().getInt("episode.target-hits", 5),
            spectators
        );
        MainThreadBridge mainThread = new MainThreadBridge(this, getConfig().getLong("control.request-timeout-ms", 2000L));
        ArenaService arenaService = new ArenaService(this, episodeRegistry);
        SnapshotService snapshotService = new SnapshotService();
        DuelService duelService = new DuelService(this, episodeRegistry, arenaService);
        ReplayService replayService = new ReplayService(this);
        afkService = new AfkService(this, duelService);
        afkService.start();
        monitoringStore = new MonitoringStore(this, duelService);
        monitoringStore.start();
        monitoringServer = new MonitoringServer(this, monitoringStore, new RecordingCatalog(this));
        monitoringServer.start();

        getServer().getPluginManager().registerEvents(new PvPEventListener(this, episodeRegistry, duelService, afkService), this);
        getServer().getPluginManager().registerEvents(new SkinProfileService(this), this);
        PluginCommand command = getCommand("pvprobo");
        if (command != null) {
            PvPRoboCommand executor = new PvPRoboCommand(duelService, replayService);
            command.setExecutor(executor);
            command.setTabCompleter(executor);
        }

        PluginCommandHandler handler = new PluginCommandHandler(
            getDescription().getVersion(),
            mainThread,
            episodeRegistry,
            arenaService,
            snapshotService,
            duelService
        );

        String host = getConfig().getString("control.host", "127.0.0.1");
        int port = getConfig().getInt("control.port", 25580);
        controlServer = new ControlServer(getLogger(), host, port, handler);
        controlServer.start();
    }

    @Override
    public void onDisable() {
        if (controlServer != null) {
            controlServer.close();
        }
        if (monitoringServer != null) {
            monitoringServer.close();
        }
        if (monitoringStore != null) {
            monitoringStore.close();
        }
        if (afkService != null) {
            afkService.close();
        }
    }
}
