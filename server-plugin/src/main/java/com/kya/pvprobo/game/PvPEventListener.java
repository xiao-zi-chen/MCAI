package com.kya.pvprobo.game;

import org.bukkit.Material;
import org.bukkit.GameMode;
import org.bukkit.Location;
import java.util.List;
import org.bukkit.event.block.Action;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.player.PlayerBucketEmptyEvent;
import org.bukkit.event.player.PlayerBucketFillEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerLoginEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.plugin.Plugin;

public final class PvPEventListener implements Listener {
    private final Plugin plugin;
    private final EpisodeRegistry episodeRegistry;
    private final DuelService duelService;

    public PvPEventListener(Plugin plugin, EpisodeRegistry episodeRegistry, DuelService duelService) {
        this.plugin = plugin;
        this.episodeRegistry = episodeRegistry;
        this.duelService = duelService;
    }

    @EventHandler
    public void onLogin(PlayerLoginEvent event) {
        if (!duelService.canAdmitLogin(event.getPlayer())) {
            event.disallow(PlayerLoginEvent.Result.KICK_FULL, duelService.admissionFullMessage());
        }
    }

    @EventHandler
    public void onDamage(EntityDamageByEntityEvent event) {
        if (event.getEntity() instanceof Player victim && event.getDamager() instanceof Player attacker) {
            if (episodeRegistry.isSpectator(attacker.getName()) || episodeRegistry.isSpectator(victim.getName())) {
                return;
            }
            EpisodeState episodeState = episodeRegistry.stateForPlayer(attacker.getName());
            if (episodeState == null) {
                return;
            }
            if (episodeState.phase().equals("countdown") && episodeState.isRegisteredPlayer(victim.getName())) {
                event.setCancelled(true);
                return;
            }
            if (!CombatHitValidator.isValidHit(attacker, victim)) {
                event.setCancelled(true);
                episodeState.addEvent("damage_rejected_invalid_hit:" + attacker.getName() + ":" + victim.getName());
                return;
            }
            boolean counted = episodeState.recordHit(attacker.getName(), victim.getName());
            if (counted) {
                event.setDamage(0.0);
                victim.setNoDamageTicks(Math.max(victim.getNoDamageTicks(), victim.getMaximumNoDamageTicks()));
                duelService.onEpisodeMaybeFinished(episodeState);
                return;
            }
            episodeState.addEvent("damage_ignored:" + attacker.getName() + ":" + victim.getName());
        }
    }

    @EventHandler
    public void onDeath(PlayerDeathEvent event) {
        if (episodeRegistry.isSpectator(event.getEntity().getName())) {
            return;
        }
        EpisodeState episodeState = episodeRegistry.stateForPlayer(event.getEntity().getName());
        if (episodeState != null) {
            episodeState.playerDied(event.getEntity().getName());
            duelService.onEpisodeMaybeFinished(episodeState);
        }
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        String name = event.getPlayer().getName();
        if (episodeRegistry.isSpectator(name)) {
            event.getPlayer().setGameMode(GameMode.SPECTATOR);
            return;
        }
        duelService.handleJoin(event.getPlayer());
        duelService.giveUtilityItems(event.getPlayer());
        EpisodeState episodeState = episodeRegistry.stateForPlayer(name);
        if (episodeState != null) {
            episodeState.addEvent("join:" + name);
        }
    }

    @EventHandler
    public void onRespawn(PlayerRespawnEvent event) {
        if (episodeRegistry.isSpectator(event.getPlayer().getName())) {
            return;
        }
        Location target = duelService.respawnLocationFor(event.getPlayer());
        if (target != null) {
            event.setRespawnLocation(target);
        }
        plugin.getServer().getScheduler().runTaskLater(plugin, () -> duelService.giveUtilityItems(event.getPlayer()), 2L);
    }

    @EventHandler
    public void onInventoryClick(InventoryClickEvent event) {
        boolean duelMenu = duelService.isDuelMenuTitle(event.getView().getTitle());
        boolean aiBattleMenu = duelService.isAiBattleMenuTitle(event.getView().getTitle());
        if (!duelMenu && !aiBattleMenu) {
            return;
        }
        event.setCancelled(true);
        if (!(event.getWhoClicked() instanceof Player player)) {
            return;
        }
        List<String> messages = aiBattleMenu
            ? duelService.handleAiBattleMenuClick(player, event.getCurrentItem())
            : duelService.handleMenuClick(player, event.getCurrentItem());
        for (String message : messages) {
            player.sendMessage(message);
        }
        if (!messages.isEmpty()) {
            player.closeInventory();
        }
    }

    @EventHandler
    public void onInteract(PlayerInteractEvent event) {
        if (event.getItem() == null) {
            return;
        }
        if (event.getAction() != Action.RIGHT_CLICK_AIR && event.getAction() != Action.RIGHT_CLICK_BLOCK) {
            return;
        }
        Material type = event.getItem().getType();
        if (type != Material.NETHER_STAR
            && type != Material.ENDER_EYE
            && type != Material.WOODEN_SWORD
            && type != Material.DIAMOND_SWORD
            && type != Material.NETHERITE_SWORD
            && type != Material.IRON_SWORD) {
            return;
        }
        for (String message : duelService.handleUtilityItem(event.getPlayer(), event.getItem())) {
            event.getPlayer().sendMessage(message);
        }
        event.setCancelled(true);
    }

    @EventHandler
    public void onMove(PlayerMoveEvent event) {
        if (event.getTo() == null) {
            return;
        }
        if (event.getFrom().getBlockX() == event.getTo().getBlockX()
            && event.getFrom().getBlockY() == event.getTo().getBlockY()
            && event.getFrom().getBlockZ() == event.getTo().getBlockZ()) {
            return;
        }
        duelService.enforceMovementBounds(event.getPlayer());
    }

    @EventHandler
    public void onBlockBreak(BlockBreakEvent event) {
        if (duelService.shouldProtect(event.getPlayer())) {
            event.setCancelled(true);
        }
    }

    @EventHandler
    public void onBlockPlace(BlockPlaceEvent event) {
        if (duelService.shouldProtect(event.getPlayer())) {
            event.setCancelled(true);
        }
    }

    @EventHandler
    public void onBucketFill(PlayerBucketFillEvent event) {
        if (duelService.shouldProtect(event.getPlayer())) {
            event.setCancelled(true);
        }
    }

    @EventHandler
    public void onBucketEmpty(PlayerBucketEmptyEvent event) {
        if (duelService.shouldProtect(event.getPlayer())) {
            event.setCancelled(true);
        }
    }

    @EventHandler
    public void onExplode(EntityExplodeEvent event) {
        event.blockList().clear();
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        duelService.handleQuit(event.getPlayer());
        if (episodeRegistry.isSpectator(event.getPlayer().getName())) {
            return;
        }
        EpisodeState episodeState = episodeRegistry.stateForPlayer(event.getPlayer().getName());
        if (episodeState != null) {
            episodeState.playerQuit(event.getPlayer().getName());
        }
    }
}
