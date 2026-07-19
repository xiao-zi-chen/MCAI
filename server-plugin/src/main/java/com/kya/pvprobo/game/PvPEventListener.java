package com.kya.pvprobo.game;

import org.bukkit.GameMode;
import org.bukkit.Location;
import java.util.List;
import org.bukkit.event.block.Action;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.player.PlayerBucketEmptyEvent;
import org.bukkit.event.player.PlayerBucketFillEvent;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerLoginEvent;
import org.bukkit.event.player.PlayerLocaleChangeEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.plugin.Plugin;

public final class PvPEventListener implements Listener {
    private final Plugin plugin;
    private final EpisodeRegistry episodeRegistry;
    private final DuelService duelService;
    private final AfkService afkService;

    public PvPEventListener(Plugin plugin, EpisodeRegistry episodeRegistry, DuelService duelService, AfkService afkService) {
        this.plugin = plugin;
        this.episodeRegistry = episodeRegistry;
        this.duelService = duelService;
        this.afkService = afkService;
    }

    @EventHandler
    public void onLogin(PlayerLoginEvent event) {
        String reservedNameMessage = duelService.reservedLoginNameMessage(event.getPlayer(), event.getHostname());
        if (reservedNameMessage != null) {
            event.disallow(PlayerLoginEvent.Result.KICK_OTHER, reservedNameMessage);
            return;
        }
        if (!duelService.canAdmitLogin(event.getPlayer())) {
            event.disallow(PlayerLoginEvent.Result.KICK_FULL, duelService.admissionFullMessage());
        }
    }

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onDamage(EntityDamageByEntityEvent event) {
        if (event.getEntity() instanceof Player victim && event.getDamager() instanceof Player attacker) {
            afkService.recordActivity(attacker);
            afkService.recordActivity(victim);
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
            if (shouldValidateSyntheticOrBotAttack(attacker, victim) && !CombatHitValidator.isValidHit(attacker, victim)) {
                event.setCancelled(true);
                episodeState.addEvent("damage_rejected_invalid_hit:" + attacker.getName() + ":" + victim.getName());
                return;
            }
            if (canScoreDamage(episodeState, attacker, victim)
                && DuelDamagePolicy.isCountableFinalDamage(event.getFinalDamage())) {
                double safeHealth = DuelDamagePolicy.safePreDamageHealth(victim.getHealth(), victim.getMaxHealth(), event.getFinalDamage());
                if (safeHealth > victim.getHealth()) {
                    victim.setHealth(safeHealth);
                }
            }
        }
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = false)
    public void onDamageMonitor(EntityDamageByEntityEvent event) {
        if (event.getEntity() instanceof Player victim && event.getDamager() instanceof Player attacker) {
            if (episodeRegistry.isSpectator(attacker.getName()) || episodeRegistry.isSpectator(victim.getName())) {
                return;
            }
            EpisodeState episodeState = stateForCombat(attacker, victim);
            if (episodeState == null) {
                return;
            }
            String ignoredReason = CombatDamageDiagnostics.ignoredReason(
                episodeState,
                attacker.getName(),
                victim.getName(),
                event.getFinalDamage(),
                event.isCancelled()
            );
            if (!ignoredReason.isBlank()) {
                episodeState.addEvent(CombatDamageDiagnostics.ignoredEvent(
                    ignoredReason,
                    attacker.getName(),
                    victim.getName(),
                    event.getFinalDamage(),
                    episodeState.phase(),
                    victim.getNoDamageTicks(),
                    attacker.getAttackCooldown()
                ));
                return;
            }
            boolean counted = episodeState.recordHit(attacker.getName(), victim.getName());
            if (!counted) {
                episodeState.addEvent(CombatDamageDiagnostics.ignoredEvent(
                    "record_rejected",
                    attacker.getName(),
                    victim.getName(),
                    event.getFinalDamage(),
                    episodeState.phase(),
                    victim.getNoDamageTicks(),
                    attacker.getAttackCooldown()
                ));
                return;
            }
            if (DuelDamagePolicy.shouldScheduleHealthRestore(event.getFinalDamage())) {
                plugin.getServer().getScheduler().runTask(plugin, () -> {
                    if (victim.isOnline() && !victim.isDead()) {
                        victim.setHealth(DuelDamagePolicy.restoreHealthTarget(victim.getMaxHealth()));
                    }
                });
            }
            duelService.onEpisodeMaybeFinished(episodeState);
        }
    }

    private boolean shouldValidateSyntheticOrBotAttack(Player attacker, Player victim) {
        return CombatValidationPolicy.shouldValidateSyntheticOrBotAttack(
            attacker.getName(),
            victim.getName(),
            plugin.getConfig().getStringList("admission.bot-name-prefixes"),
            plugin.getConfig().getString("duel.default-robo-name", "ROBO"),
            plugin.getConfig().getString("duel.bot-combat-backend", "mineflayer")
        );
    }

    private EpisodeState stateForCombat(Player attacker, Player victim) {
        EpisodeState episodeState = episodeRegistry.stateForPlayer(attacker.getName());
        if (episodeState != null) {
            return episodeState;
        }
        return episodeRegistry.stateForPlayer(victim.getName());
    }

    private boolean canScoreDamage(EpisodeState episodeState, Player attacker, Player victim) {
        return episodeState.active()
            && "hit_count".equals(episodeState.combatMode())
            && episodeState.isRegisteredPlayer(attacker.getName())
            && episodeState.isRegisteredPlayer(victim.getName())
            && !attacker.getName().equals(victim.getName());
    }

    @EventHandler
    public void onDeath(PlayerDeathEvent event) {
        event.getDrops().removeIf(duelService::isUtilityItem);
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
        afkService.recordActivity(event.getPlayer());
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
    public void onLocaleChange(PlayerLocaleChangeEvent event) {
        plugin.getServer().getScheduler().runTask(plugin, () -> duelService.refreshLocalizedPlayer(event.getPlayer()));
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
        afkService.recordActivity(player);
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
    public void onDropItem(PlayerDropItemEvent event) {
        afkService.recordActivity(event.getPlayer());
        if (duelService.isUtilityItem(event.getItemDrop().getItemStack())) {
            event.setCancelled(true);
        }
    }

    @EventHandler
    public void onInteract(PlayerInteractEvent event) {
        afkService.recordActivity(event.getPlayer());
        if (event.getItem() == null) {
            return;
        }
        if (event.getAction() != Action.RIGHT_CLICK_AIR && event.getAction() != Action.RIGHT_CLICK_BLOCK) {
            return;
        }
        if (!duelService.isUtilityItem(event.getItem())) {
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
        afkService.recordActivity(event.getPlayer());
        duelService.enforceMovementBounds(event.getPlayer());
    }

    @EventHandler
    public void onBlockBreak(BlockBreakEvent event) {
        afkService.recordActivity(event.getPlayer());
        if (duelService.shouldProtect(event.getPlayer())) {
            event.setCancelled(true);
        }
    }

    @EventHandler
    public void onBlockPlace(BlockPlaceEvent event) {
        afkService.recordActivity(event.getPlayer());
        if (duelService.shouldProtect(event.getPlayer())) {
            event.setCancelled(true);
        }
    }

    @EventHandler
    public void onBucketFill(PlayerBucketFillEvent event) {
        afkService.recordActivity(event.getPlayer());
        if (duelService.shouldProtect(event.getPlayer())) {
            event.setCancelled(true);
        }
    }

    @EventHandler
    public void onBucketEmpty(PlayerBucketEmptyEvent event) {
        afkService.recordActivity(event.getPlayer());
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
        afkService.forget(event.getPlayer());
        duelService.handleQuit(event.getPlayer());
        if (episodeRegistry.isSpectator(event.getPlayer().getName())) {
            return;
        }
        EpisodeState episodeState = episodeRegistry.stateForPlayer(event.getPlayer().getName());
        if (episodeState != null) {
            episodeState.playerQuit(event.getPlayer().getName());
            duelService.onEpisodeMaybeFinished(episodeState);
        }
    }
}
