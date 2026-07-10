package com.kya.pvprobo.control;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.logging.Level;
import java.util.logging.Logger;

public final class ControlServer implements AutoCloseable {
    private final Logger logger;
    private final String host;
    private final int port;
    private final PluginCommandHandler handler;
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final ExecutorService clientExecutor = Executors.newCachedThreadPool();
    private Thread acceptThread;
    private ServerSocket serverSocket;

    public ControlServer(Logger logger, String host, int port, PluginCommandHandler handler) {
        this.logger = logger;
        this.host = host;
        this.port = port;
        this.handler = handler;
    }

    public void start() {
        if (!running.compareAndSet(false, true)) {
            return;
        }
        acceptThread = new Thread(this::acceptLoop, "pvprobo-control-accept");
        acceptThread.setDaemon(true);
        acceptThread.start();
    }

    private void acceptLoop() {
        try {
            InetAddress bindAddress = InetAddress.getByName(host);
            if (!bindAddress.isLoopbackAddress()) {
                throw new IllegalStateException("Control server host must be loopback: " + host);
            }
            serverSocket = new ServerSocket(port, 50, bindAddress);
            logger.info("PVPRobo control server listening on " + host + ":" + port);
            while (running.get()) {
                Socket socket = serverSocket.accept();
                if (!socket.getInetAddress().isLoopbackAddress()) {
                    socket.close();
                    continue;
                }
                clientExecutor.execute(() -> handleClient(socket));
            }
        } catch (IOException | RuntimeException ex) {
            if (running.get()) {
                logger.log(Level.SEVERE, "PVPRobo control server failed", ex);
            }
        }
    }

    private void handleClient(Socket socket) {
        try (socket;
             BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
             BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8))) {
            String line;
            while (running.get() && (line = reader.readLine()) != null) {
                Map<String, Object> response = handler.handle(line);
                writer.write(JsonProtocol.encode(response));
                writer.newLine();
                writer.flush();
            }
        } catch (IOException ex) {
            logger.log(Level.FINE, "PVPRobo client disconnected", ex);
        }
    }

    @Override
    public void close() {
        running.set(false);
        try {
            if (serverSocket != null) {
                serverSocket.close();
            }
        } catch (IOException ignored) {
        }
        clientExecutor.shutdownNow();
    }
}

