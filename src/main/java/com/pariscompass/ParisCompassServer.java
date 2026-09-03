package com.pariscompass;

import com.pariscompass.http.HttpUtil;
import com.pariscompass.http.StaticFileHandler;
import com.pariscompass.model.CountryClimateData;
import com.pariscompass.service.ClimateDataService;
import com.pariscompass.service.GeminiService;
import com.pariscompass.util.Env;
import com.sun.net.httpserver.HttpServer;

import java.net.InetSocketAddress;
import java.nio.file.Path;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.Executors;

public final class ParisCompassServer {
    public static void main(String[] args) throws Exception {
        int port = Env.getInt("PORT", 8080);
        ClimateDataService climate = new ClimateDataService();
        GeminiService gemini = new GeminiService();

        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
        server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());

        server.createContext("/api/health", exchange -> {
            if (!exchange.getRequestMethod().equalsIgnoreCase("GET")) { HttpUtil.methodNotAllowed(exchange, "GET"); return; }
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("status", "ok");
            body.put("service", "paris-compass");
            body.put("time", Instant.now().toString());
            body.put("data", climate.refreshStatus());
            HttpUtil.json(exchange, 200, body);
        });

        server.createContext("/api/countries", exchange -> {
            if (!exchange.getRequestMethod().equalsIgnoreCase("GET")) { HttpUtil.methodNotAllowed(exchange, "GET"); return; }
            HttpUtil.json(exchange, 200, Map.of("countries", climate.allCountries(), "meta", climate.refreshStatus()));
        });

        server.createContext("/api/index", exchange -> {
            if (!exchange.getRequestMethod().equalsIgnoreCase("GET")) { HttpUtil.methodNotAllowed(exchange, "GET"); return; }
            String topic = HttpUtil.queryParams(exchange).getOrDefault("topic", "overall");
            HttpUtil.json(exchange, 200, Map.of("topic", topic, "ranking", climate.index(topic)));
        });

        server.createContext("/api/country", exchange -> {
            if (!exchange.getRequestMethod().equalsIgnoreCase("GET")) { HttpUtil.methodNotAllowed(exchange, "GET"); return; }
            String code = HttpUtil.queryParams(exchange).get("code");
            CountryClimateData country = climate.country(code);
            if (country == null) { HttpUtil.notFound(exchange, "Country not found for ISO3 code: " + code); return; }
            HttpUtil.json(exchange, 200, country.toMap());
        });

        server.createContext("/api/insights", exchange -> {
            if (!exchange.getRequestMethod().equalsIgnoreCase("GET")) { HttpUtil.methodNotAllowed(exchange, "GET"); return; }
            String code = HttpUtil.queryParams(exchange).get("code");
            CountryClimateData country = climate.country(code);
            if (country == null) { HttpUtil.notFound(exchange, "Country not found for ISO3 code: " + code); return; }
            HttpUtil.json(exchange, 200, gemini.insight(country));
        });

        server.createContext("/api/refresh", exchange -> {
            if (!exchange.getRequestMethod().equalsIgnoreCase("POST")) { HttpUtil.methodNotAllowed(exchange, "POST"); return; }
            climate.refreshAsync();
            HttpUtil.json(exchange, 202, Map.of("message", "Refresh started", "status", climate.refreshStatus()));
        });

        server.createContext("/", new StaticFileHandler(Path.of("web")));

        Runtime.getRuntime().addShutdownHook(new Thread(() -> server.stop(1)));
        server.start();
        System.out.println("Paris Compass running at http://localhost:" + port);
        System.out.println("Loading live climate datasets asynchronously...");
        climate.refreshAsync().thenAccept(status -> System.out.println(status.get("message")));
    }
}
