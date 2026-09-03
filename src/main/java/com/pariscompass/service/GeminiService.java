package com.pariscompass.service;

import com.pariscompass.model.CountryClimateData;
import com.pariscompass.util.Env;
import com.pariscompass.util.Json;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class GeminiService {
    private record CacheEntry(String text, Instant expiresAt) {}

    private static final Pattern TEXT_PATTERN = Pattern.compile("\\\"text\\\"\\s*:\\s*\\\"((?:\\\\.|[^\\\"\\\\])*)\\\"");
    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(6))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();
    private final Map<String, CacheEntry> cache = new ConcurrentHashMap<>();

    public Map<String, Object> insight(CountryClimateData country) {
        String cacheKey = country.iso3() + ":" + country.emissionsYear() + ":" + country.renewableYear();
        CacheEntry cached = cache.get(cacheKey);
        if (cached != null && Instant.now().isBefore(cached.expiresAt())) {
            return response(country.iso3(), cached.text(), "cache");
        }

        String apiKey = Env.get("GEMINI_API_KEY");
        if (apiKey == null || apiKey.isBlank()) {
            return response(country.iso3(), fallbackInsight(country), "local");
        }

        try {
            String text = callGemini(country, apiKey);
            cache.put(cacheKey, new CacheEntry(text, Instant.now().plus(Duration.ofHours(6))));
            return response(country.iso3(), text, "gemini");
        } catch (Exception e) {
            System.err.println("Gemini insight failed: " + e.getMessage());
            return response(country.iso3(), fallbackInsight(country), "local-fallback");
        }
    }

    private String callGemini(CountryClimateData country, String apiKey) throws IOException, InterruptedException {
        String model = Env.get("GEMINI_MODEL", "gemini-2.5-flash");
        String endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" +
                URLEncoder.encode(model, StandardCharsets.UTF_8) + ":generateContent?key=" +
                URLEncoder.encode(apiKey, StandardCharsets.UTF_8);

        String prompt = buildPrompt(country);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("contents", java.util.List.of(Map.of(
                "role", "user",
                "parts", java.util.List.of(Map.of("text", prompt))
        )));
        body.put("generationConfig", Map.of(
                "temperature", 0.25,
                "maxOutputTokens", 260
        ));

        HttpRequest request = HttpRequest.newBuilder(URI.create(endpoint))
                .timeout(Duration.ofSeconds(20))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(Json.stringify(body)))
                .build();
        HttpResponse<String> result = client.send(request, HttpResponse.BodyHandlers.ofString());
        if (result.statusCode() < 200 || result.statusCode() >= 300) {
            throw new IOException("Gemini returned HTTP " + result.statusCode());
        }

        Matcher matcher = TEXT_PATTERN.matcher(result.body());
        if (!matcher.find()) throw new IOException("Gemini response did not contain text");
        String text = Json.unescape(matcher.group(1)).trim();
        if (text.isBlank()) throw new IOException("Gemini returned an empty insight");
        return text;
    }

    private String buildPrompt(CountryClimateData c) {
        return "You are the analysis layer for Paris Compass, a climate data dashboard. " +
                "Write a concise 2-3 sentence country insight for " + c.name() + ". " +
                "Use only the supplied metrics; do not invent policies, targets, or causes. " +
                "Explain strengths and weaknesses relative to other countries because scores are percentile-based. " +
                "Do not use markdown bullets. Metrics: " +
                "CO2 emissions per capita=" + value(c.emissionsPerCapita(), " tonnes/person", c.emissionsYear()) + "; " +
                "renewable share of final energy=" + value(c.renewableShare(), "%", c.renewableYear()) + "; " +
                "ecological footprint=" + value(c.ecologicalFootprint(), " gha/person", null) + "; " +
                "Paris Compass scores (0-100, higher is better): emissions=" + score(c.emissionsScore()) +
                ", energy=" + score(c.energyScore()) + ", footprint=" + score(c.footprintScore()) +
                ", overall=" + score(c.overallScore()) + ".";
    }

    private String fallbackInsight(CountryClimateData c) {
        StringBuilder s = new StringBuilder();
        s.append(c.name()).append(" is classified as ").append(c.status().toLowerCase()).append(" in the Paris Compass index");
        if (c.overallScore() != null) s.append(" with an overall score of ").append(Math.round(c.overallScore())).append("/100");
        s.append(". ");

        String best = null, worst = null;
        double bestScore = -1, worstScore = 101;
        if (c.emissionsScore() != null) { best = "per-capita emissions"; worst = "per-capita emissions"; bestScore = worstScore = c.emissionsScore(); }
        if (c.energyScore() != null && c.energyScore() > bestScore) { best = "renewable energy share"; bestScore = c.energyScore(); }
        if (c.energyScore() != null && c.energyScore() < worstScore) { worst = "renewable energy share"; worstScore = c.energyScore(); }
        if (c.footprintScore() != null && c.footprintScore() > bestScore) { best = "ecological footprint"; bestScore = c.footprintScore(); }
        if (c.footprintScore() != null && c.footprintScore() < worstScore) { worst = "ecological footprint"; worstScore = c.footprintScore(); }

        if (best != null && worst != null && !best.equals(worst)) {
            s.append("Its strongest relative dimension is ").append(best).append(", while ").append(worst).append(" is the largest area for improvement.");
        } else {
            s.append("The dashboard currently has partial data for this country, so the comparison should be interpreted cautiously.");
        }
        return s.toString();
    }

    private Map<String, Object> response(String iso3, String text, String source) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("iso3", iso3);
        m.put("insight", text);
        m.put("source", source);
        return m;
    }

    private String value(Double v, String unit, Integer year) {
        if (v == null) return "unavailable";
        return String.format("%.2f%s%s", v, unit, year == null ? "" : " (" + year + ")");
    }

    private String score(Double v) { return v == null ? "unavailable" : String.format("%.1f", v); }
}
