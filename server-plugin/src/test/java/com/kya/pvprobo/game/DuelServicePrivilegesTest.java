package com.kya.pvprobo.game;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.nio.file.Path;
import java.util.List;
import org.bukkit.GameMode;
import org.bukkit.Server;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;
import org.bukkit.scheduler.BukkitScheduler;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

final class DuelServicePrivilegesTest {
    @TempDir
    Path dataFolder;

    @ParameterizedTest
    @ValueSource(strings = {"offline", "online"})
    void preservesServerGrantedOperatorPrivileges(String authMode) {
        DuelService service = service(authMode);
        TestPlayer admin = new TestPlayer("LocalAdmin", true, false);

        service.enforcePlayerPrivileges(admin.player);
        service.enforcePlayerPrivileges(admin.player);

        assertTrue(admin.operator);
        assertEquals(GameMode.CREATIVE, admin.gameMode);
        assertTrue(service.hasAdminAccess(admin.player));
    }

    @ParameterizedTest
    @ValueSource(strings = {"offline", "online"})
    void acceptsExplicitAdminPermissionWithoutGrantingOp(String authMode) {
        DuelService service = service(authMode);
        TestPlayer admin = new TestPlayer("PermissionAdmin", false, true);

        service.enforcePlayerPrivileges(admin.player);

        assertFalse(admin.operator);
        assertEquals(GameMode.CREATIVE, admin.gameMode);
        assertTrue(service.hasAdminAccess(admin.player));
    }

    @ParameterizedTest
    @ValueSource(strings = {"offline", "online"})
    void restrictsOrdinaryPlayersWithoutGrantingPrivileges(String authMode) {
        DuelService service = service(authMode);
        TestPlayer visitor = new TestPlayer("Visitor", false, false);

        service.enforcePlayerPrivileges(visitor.player);

        assertFalse(visitor.operator);
        assertEquals(GameMode.ADVENTURE, visitor.gameMode);
        assertFalse(service.hasAdminAccess(visitor.player));
    }

    @Test
    void repositoryOwnerNameDoesNotBypassServerPermissions() {
        DuelService service = service("online");
        TestPlayer visitor = new TestPlayer("KyaKayKya", false, false);

        service.enforcePlayerPrivileges(visitor.player);

        assertEquals(GameMode.ADVENTURE, visitor.gameMode);
        assertFalse(service.hasAdminAccess(visitor.player));
    }

    @Test
    void respectsOperatorRevocationByTheServer() {
        DuelService service = service("offline");
        TestPlayer admin = new TestPlayer("LocalAdmin", true, false);
        service.enforcePlayerPrivileges(admin.player);

        admin.operator = false;
        service.enforcePlayerPrivileges(admin.player);

        assertFalse(admin.operator);
        assertEquals(GameMode.ADVENTURE, admin.gameMode);
        assertFalse(service.hasAdminAccess(admin.player));
    }

    @Test
    void keepsBotsAndConfiguredSpectatorsExemptFromPlayerGameMode() {
        DuelService service = service("offline");
        for (String name : List.of("ROBO", "Viewer")) {
            TestPlayer player = new TestPlayer(name, false, false);

            service.enforcePlayerPrivileges(player.player);

            assertFalse(player.operator);
            assertEquals(GameMode.CREATIVE, player.gameMode);
            assertFalse(service.hasAdminAccess(player.player));
        }
    }

    @Test
    void serverOperatorsCanJoinWhenHumanSlotsAreFullAndAreNotAfkKicked() {
        DuelService service = service("offline");
        TestPlayer admin = new TestPlayer("LocalAdmin", true, false);
        TestPlayer visitor = new TestPlayer("Visitor", false, false);

        assertTrue(service.canAdmitLogin(admin.player));
        assertFalse(service.canAdmitLogin(visitor.player));
        assertFalse(service.shouldAfkCheck(admin.player));
        assertTrue(service.shouldAfkCheck(visitor.player));
    }

    private DuelService service(String authMode) {
        YamlConfiguration config = new YamlConfiguration();
        config.set("admission.player-auth-mode", authMode);
        config.set("admission.protect-reserved-names-in-offline-mode", true);
        config.set("admission.max-human-players", 0);
        BukkitScheduler scheduler = proxy(BukkitScheduler.class, (self, method, args) -> {
            if (method.getName().equals("runTaskLater")) {
                return null;
            }
            throw new UnsupportedOperationException(method.getName());
        });
        Server server = proxy(Server.class, (self, method, args) -> switch (method.getName()) {
            case "getScheduler" -> scheduler;
            case "getOnlinePlayers" -> List.of();
            default -> throw new UnsupportedOperationException(method.getName());
        });
        Plugin plugin = proxy(Plugin.class, (self, method, args) -> switch (method.getName()) {
            case "getConfig" -> config;
            case "getDataFolder" -> dataFolder.toFile();
            case "getName" -> "PVPRobo";
            case "getServer" -> server;
            default -> throw new UnsupportedOperationException(method.getName());
        });
        EpisodeRegistry registry = new EpisodeRegistry(2400, 50, List.of("Viewer"));
        return new DuelService(plugin, registry, new ArenaService(plugin, registry));
    }

    private static <T> T proxy(Class<T> type, InvocationHandler handler) {
        return type.cast(Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[] {type}, handler));
    }

    private static final class TestPlayer implements InvocationHandler {
        private final String name;
        private final boolean adminPermission;
        private final Player player;
        private boolean operator;
        private GameMode gameMode = GameMode.CREATIVE;

        private TestPlayer(String name, boolean operator, boolean adminPermission) {
            this.name = name;
            this.operator = operator;
            this.adminPermission = adminPermission;
            this.player = proxy(Player.class, this);
        }

        @Override
        public Object invoke(Object self, Method method, Object[] args) {
            return switch (method.getName()) {
                case "getName" -> name;
                case "isOp" -> operator;
                case "setOp" -> {
                    operator = (boolean) args[0];
                    yield null;
                }
                case "hasPermission" -> adminPermission && "pvprobo.admin".equals(args[0]);
                case "getGameMode" -> gameMode;
                case "setGameMode" -> {
                    gameMode = (GameMode) args[0];
                    yield null;
                }
                default -> throw new UnsupportedOperationException(method.getName());
            };
        }
    }
}
