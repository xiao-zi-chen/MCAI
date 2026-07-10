package com.kya.pvprobo.command;

import com.kya.pvprobo.game.DuelService;
import java.util.ArrayList;
import java.util.List;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;
import org.bukkit.entity.Player;

public final class PvPRoboCommand implements CommandExecutor, TabCompleter {
    private static final List<String> PLAYER_ROOT = List.of("help", "guide", "menu", "duel");
    private static final List<String> ADMIN_ROOT = List.of("help", "guide", "menu", "playtest", "spawn", "target", "difficulty", "duel", "arena", "status");
    private static final List<String> ARENA = List.of("player-spawn", "robo-spawn", "bounds-center", "bounds-radius", "status", "clear-build");
    private static final List<String> DIFFICULTIES = List.of("bc", "ppo_mid", "ppo_high", "script_easy", "script_hard", "champion");
    private final DuelService duelService;

    public PvPRoboCommand(DuelService duelService) {
        this.duelService = duelService;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (args.length == 0 || args[0].equalsIgnoreCase("help") || args[0].equalsIgnoreCase("guide")) {
            sendHelp(sender);
            return true;
        }
        if (args[0].equalsIgnoreCase("status")) {
            if (!requireAdmin(sender)) {
                return true;
            }
            sender.sendMessage(duelService.status());
            return true;
        }
        if (args[0].equalsIgnoreCase("menu")) {
            if (sender instanceof Player player) {
                duelService.openMenu(player);
            } else {
                sender.sendMessage("Only an in-game player can open the PVPRobo menu.");
            }
            return true;
        }
        if (args[0].equalsIgnoreCase("playtest")) {
            return handlePlaytest(sender, args);
        }
        String root = args[0].toLowerCase();
        switch (root) {
            case "spawn" -> {
                if (!requireAdmin(sender)) {
                    return true;
                }
                String roboName = args.length >= 2 ? args[1] : "ROBO";
                sender.sendMessage(duelService.setRoboName(roboName));
                sender.sendMessage("Spawn the matching Mineflayer bot through the bot controller before starting the duel.");
                return true;
            }
            case "target" -> {
                if (!requireAdmin(sender)) {
                    return true;
                }
                if (args.length < 2) {
                    sender.sendMessage("Usage: /pvprobo target <player>");
                    return true;
                }
                sender.sendMessage(duelService.setTarget(args[1]));
                return true;
            }
            case "difficulty" -> {
                if (!requireAdmin(sender)) {
                    return true;
                }
                if (args.length < 2) {
                    sender.sendMessage("Usage: /pvprobo difficulty <bc|ppo_mid|ppo_high|script_easy|script_hard|champion>");
                    return true;
                }
                sender.sendMessage(duelService.setDifficulty(args[1]));
                return true;
            }
            case "duel" -> {
                return handleDuel(sender, args);
            }
            case "arena" -> {
                return handleArena(sender, args);
            }
            default -> {
                sender.sendMessage(hasAdminAccess(sender)
                    ? "Usage: /pvprobo <help|menu|playtest|spawn|target|difficulty|duel|arena|status>"
                    : "Usage: /pvprobo <help|menu|duel>");
                return true;
            }
        }
    }

    private void sendHelp(CommandSender sender) {
        sender.sendMessage("PVPRobo local duel commands:");
        sender.sendMessage("/pvprobo menu - Open the local duel menu.");
        sender.sendMessage("Player opponents are grouped as ROBO machine-learned AIs and SCRIPT hand-written AIs.");
        sender.sendMessage("/pvprobo duel start <bc|ppo_mid|ppo_high|champion|script_easy|script_hard> - Start a duel.");
        sender.sendMessage("Menu AI Battle lets you pick fighter 1 and fighter 2, then spectate. AI battles do not affect rankings.");
        sender.sendMessage("/pvprobo duel status - Show duel progress.");
        if (hasAdminAccess(sender)) {
            sender.sendMessage("Admin commands:");
            sender.sendMessage("/pvprobo playtest on|off - Make your OP account experience normal player menus and commands.");
            sender.sendMessage("/pvprobo status - Show current arena, player, ROBO, difficulty, phase, and hits.");
            sender.sendMessage("/pvprobo difficulty <bc|ppo_mid|ppo_high|script_easy|script_hard|champion> - Select the internal difficulty key.");
            sender.sendMessage("/pvprobo duel start <player> <bc|ppo_mid|ppo_high|script_easy|script_hard|champion> [targetHits] - Start a duel for a player.");
            sender.sendMessage("/pvprobo duel stop - Stop the current duel.");
            sender.sendMessage("/pvprobo arena <player-spawn|robo-spawn|bounds-center> - Save your current location for the pasted arena.");
            sender.sendMessage("/pvprobo arena bounds-radius <x> <y> <z> - Save cleanup bounds around the arena.");
            sender.sendMessage("/pvprobo arena status - Show saved duel arena coordinates and auto arena mode.");
            sender.sendMessage("/pvprobo arena clear-build <x> <y> <z> confirm - Clear a mistaken paste around your location.");
            sender.sendMessage("Server owner: the daemon still resolves the internal keys from duel-policies.json.");
        } else if (sender instanceof Player player && duelService.isPlaytestPlayerMode(player)) {
            sender.sendMessage("Playtest player mode is active. Use /pvprobo playtest off to restore admin tools.");
        }
        sender.sendMessage("Default duel arena: PVPRobo auto-generated local arena.");
    }

    private boolean handleDuel(CommandSender sender, String[] args) {
        if (args.length < 2) {
            sender.sendMessage("Usage: /pvprobo duel <start|stop|status>");
            return true;
        }
        String action = args[1].toLowerCase();
        if (action.equals("stop")) {
            if (!requireAdmin(sender)) {
                return true;
            }
            sender.sendMessage(duelService.stop());
            return true;
        }
        if (action.equals("status")) {
            sender.sendMessage(duelService.status());
            return true;
        }
        if (!action.equals("start")) {
            sender.sendMessage(hasAdminAccess(sender)
                ? "Usage: /pvprobo duel start <player> <bc|ppo_mid|ppo_high|script_easy|script_hard|champion> [targetHits]"
                : "Usage: /pvprobo duel start <bc|ppo_mid|ppo_high|champion|script_easy|script_hard>");
            return true;
        }
        if (!hasAdminAccess(sender)) {
            if (!(sender instanceof Player player)) {
                sender.sendMessage("Only an in-game player can start a player duel.");
                return true;
            }
            if (args.length < 3) {
                sender.sendMessage("Usage: /pvprobo duel start <bc|ppo_mid|ppo_high|champion|script_easy|script_hard>");
                return true;
            }
            sender.sendMessage(duelService.start(player.getName(), args[2], 50));
            return true;
        }
        if (args.length < 4) {
            sender.sendMessage("Usage: /pvprobo duel start <player> <bc|ppo_mid|ppo_high|script_easy|script_hard|champion> [targetHits]");
            return true;
        }
        int targetHits = args.length >= 5 ? parseTargetHits(args[4]) : 50;
        sender.sendMessage(duelService.start(args[2], args[3], targetHits));
        return true;
    }

    private boolean handleArena(CommandSender sender, String[] args) {
        if (!requireAdmin(sender)) {
            return true;
        }
        if (args.length < 2) {
            sendMessages(sender, duelService.arenaStatus());
            sender.sendMessage("Usage: /pvprobo arena <player-spawn|robo-spawn|bounds-center|bounds-radius|status|clear-build>");
            return true;
        }
        String action = args[1].toLowerCase();
        if (action.equals("status")) {
            sendMessages(sender, duelService.arenaStatus());
            return true;
        }
        if (action.equals("clear-build")) {
            if (!(sender instanceof Player player)) {
                sender.sendMessage("This arena command must be run by an in-game player standing at the center of the mistaken paste.");
                return true;
            }
            if (args.length < 6 || !args[5].equalsIgnoreCase("confirm")) {
                sender.sendMessage("Usage: /pvprobo arena clear-build <radiusX> <radiusY> <radiusZ> confirm");
                sender.sendMessage("This clears blocks around your current location.");
                return true;
            }
            sender.sendMessage(duelService.clearBuildAround(
                player,
                parseDouble(args[2], 16.0),
                parseDouble(args[3], 8.0),
                parseDouble(args[4], 16.0)
            ));
            return true;
        }
        if (action.equals("bounds-radius")) {
            if (args.length < 5) {
                sender.sendMessage("Usage: /pvprobo arena bounds-radius <x> <y> <z>");
                return true;
            }
            sender.sendMessage(duelService.setDuelBoundsRadius(parseDouble(args[2], 16.0), parseDouble(args[3], 8.0), parseDouble(args[4], 16.0)));
            return true;
        }
        if (!(sender instanceof Player player)) {
            sender.sendMessage("This arena command must be run by an in-game player standing at the desired location.");
            return true;
        }
        switch (action) {
            case "player-spawn" -> sender.sendMessage(duelService.setDuelLocation("player-spawn", player.getLocation()));
            case "robo-spawn" -> sender.sendMessage(duelService.setDuelLocation("robo-spawn", player.getLocation()));
            case "bounds-center" -> sender.sendMessage(duelService.setDuelLocation("bounds.center", player.getLocation()));
            default -> sender.sendMessage("Usage: /pvprobo arena <player-spawn|robo-spawn|bounds-center|bounds-radius|status|clear-build>");
        }
        return true;
    }

    private boolean handlePlaytest(CommandSender sender, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("Only an in-game player can toggle playtest player mode.");
            return true;
        }
        if (!hasRawAdminAccess(sender)) {
            sender.sendMessage("Only OPs or pvprobo.admin users can toggle playtest player mode.");
            return true;
        }
        if (args.length < 2) {
            sender.sendMessage(duelService.isPlaytestPlayerMode(player)
                ? "Playtest player mode is currently on. Use /pvprobo playtest off to restore admin tools."
                : "Playtest player mode is currently off. Use /pvprobo playtest on to test normal player access.");
            return true;
        }
        String value = args[1].toLowerCase();
        if (value.equals("on") || value.equals("player") || value.equals("true")) {
            sender.sendMessage(duelService.setPlaytestPlayerMode(player, true));
            return true;
        }
        if (value.equals("off") || value.equals("admin") || value.equals("false")) {
            sender.sendMessage(duelService.setPlaytestPlayerMode(player, false));
            return true;
        }
        sender.sendMessage("Usage: /pvprobo playtest <on|off>");
        return true;
    }

    private void sendMessages(CommandSender sender, List<String> messages) {
        for (String message : messages) {
            sender.sendMessage(message);
        }
    }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args) {
        if (args.length == 1) {
            List<String> roots = hasAdminAccess(sender) ? ADMIN_ROOT : PLAYER_ROOT;
            if (!hasAdminAccess(sender) && hasRawAdminAccess(sender)) {
                roots = List.of("help", "guide", "menu", "playtest", "duel");
            }
            return matches(roots, args[0]);
        }
        if (args.length == 2 && args[0].equalsIgnoreCase("duel")) {
            return matches(List.of("start", "stop", "status"), args[1]);
        }
        if (args.length == 3 && args[0].equalsIgnoreCase("duel") && args[1].equalsIgnoreCase("start") && !hasAdminAccess(sender)) {
            return matches(DIFFICULTIES, args[2]);
        }
        if (args.length == 2 && args[0].equalsIgnoreCase("arena")) {
            if (!hasAdminAccess(sender)) {
                return List.of();
            }
            return matches(ARENA, args[1]);
        }
        if (args.length == 2 && args[0].equalsIgnoreCase("playtest") && hasRawAdminAccess(sender)) {
            return matches(List.of("on", "off"), args[1]);
        }
        if ((args.length == 2 && args[0].equalsIgnoreCase("difficulty")) || (args.length == 4 && args[0].equalsIgnoreCase("duel"))) {
            if (!hasAdminAccess(sender)) {
                return List.of();
            }
            return matches(DIFFICULTIES, args[args.length - 1]);
        }
        return List.of();
    }

    private int parseTargetHits(String raw) {
        try {
            return Math.max(1, Integer.parseInt(raw));
        } catch (NumberFormatException ignored) {
            return 50;
        }
    }

    private double parseDouble(String raw, double fallback) {
        try {
            return Double.parseDouble(raw);
        } catch (NumberFormatException ignored) {
            return fallback;
        }
    }

    private List<String> matches(List<String> values, String prefix) {
        String normalized = prefix.toLowerCase();
        List<String> matches = new ArrayList<>();
        for (String value : values) {
            if (value.startsWith(normalized)) {
                matches.add(value);
            }
        }
        return matches;
    }

    private boolean requireAdmin(CommandSender sender) {
        if (hasAdminAccess(sender)) {
            return true;
        }
        sender.sendMessage("Only server admins can use that PVPRobo command.");
        if (sender instanceof Player player && duelService.isPlaytestPlayerMode(player)) {
            sender.sendMessage("Playtest player mode is active. Use /pvprobo playtest off to restore admin tools.");
        }
        return false;
    }

    private boolean hasAdminAccess(CommandSender sender) {
        if (sender instanceof Player player) {
            return duelService.hasAdminAccess(player);
        }
        return hasRawAdminAccess(sender);
    }

    private boolean hasRawAdminAccess(CommandSender sender) {
        return sender.isOp() || sender.hasPermission("pvprobo.admin");
    }
}
