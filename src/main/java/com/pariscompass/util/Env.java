package com.pariscompass.util;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class Env {
    private static final Map<String, String> DOT_ENV = loadDotEnv();

    private Env() {}

    public static String get(String key) {
        return get(key, null);
    }

    public static String get(String key, String fallback) {
        String system = System.getenv(key);
        if (system != null && !system.isBlank()) return system.trim();
        return DOT_ENV.getOrDefault(key, fallback);
    }

    public static int getInt(String key, int fallback) {
        try { return Integer.parseInt(get(key, String.valueOf(fallback))); }
        catch (Exception ignored) { return fallback; }
    }

    private static Map<String, String> loadDotEnv() {
        Map<String, String> values = new HashMap<>();
        Path path = Path.of(".env");
        if (!Files.exists(path)) return values;
        try {
            List<String> lines = Files.readAllLines(path);
            for (String raw : lines) {
                String line = raw.trim();
                if (line.isEmpty() || line.startsWith("#")) continue;
                int idx = line.indexOf('=');
                if (idx <= 0) continue;
                String key = line.substring(0, idx).trim();
                String value = line.substring(idx + 1).trim();
                if ((value.startsWith("\"") && value.endsWith("\"")) ||
                    (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.substring(1, value.length() - 1);
                }
                values.put(key, value);
            }
        } catch (IOException ignored) {}
        return values;
    }
}
