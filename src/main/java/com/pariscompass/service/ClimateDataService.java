package com.pariscompass.service;

import com.pariscompass.model.CountryClimateData;
import com.pariscompass.model.FootprintPoint;
import com.pariscompass.model.MetricPoint;
import com.pariscompass.util.CountryCodeResolver;
import com.pariscompass.util.Csv;
import com.pariscompass.util.Env;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.stream.Collectors;

public final class ClimateDataService {
    public static final String EMISSIONS_URL = "https://ourworldindata.org/grapher/co-emissions-per-capita.csv?v=1&csvType=full&useColumnShortNames=false";
    public static final String RENEWABLE_URL = "https://ourworldindata.org/grapher/share-of-final-energy-consumption-from-renewable-sources.csv?v=1&csvType=full&useColumnShortNames=false";
    public static final String FOOTPRINT_FALLBACK_URL = "https://raw.githubusercontent.com/DaveSV/Ecological-Footprint-Web-Map/main/footprint.csv";

    private final RemoteCsvService remote = new RemoteCsvService();
    private final CountryCodeResolver codes = new CountryCodeResolver();
    private final ExecutorService ioExecutor = Executors.newFixedThreadPool(3);
    private final AtomicBoolean refreshing = new AtomicBoolean(false);

    private volatile Map<String, CountryClimateData> countries = Map.of();
    private volatile Instant lastRefresh;
    private volatile String lastRefreshMessage = "Data has not been loaded yet.";

    public ClimateDataService() {
        loadFallback();
    }

    public CompletableFuture<Map<String, Object>> refreshAsync() {
        if (!refreshing.compareAndSet(false, true)) {
            return CompletableFuture.completedFuture(refreshStatus());
        }

        CompletableFuture<Map<String, MetricPoint>> emissionsFuture = CompletableFuture.supplyAsync(() -> {
            try { return parseOwidLatest(remote.fetch(EMISSIONS_URL)); }
            catch (Exception e) { System.err.println("Emissions data: " + e.getMessage()); return Map.of(); }
        }, ioExecutor);

        CompletableFuture<Map<String, MetricPoint>> renewableFuture = CompletableFuture.supplyAsync(() -> {
            try { return parseOwidLatest(remote.fetch(RENEWABLE_URL)); }
            catch (Exception e) { System.err.println("Renewable data: " + e.getMessage()); return Map.of(); }
        }, ioExecutor);

        CompletableFuture<Map<String, FootprintPoint>> footprintFuture = CompletableFuture.supplyAsync(() -> {
            try { return loadFootprintSource(); }
            catch (Exception e) { System.err.println("Footprint data: " + e.getMessage()); return Map.of(); }
        }, ioExecutor);

        return CompletableFuture.allOf(emissionsFuture, renewableFuture, footprintFuture)
                .thenApply(ignored -> {
                    Map<String, CountryClimateData> merged = merge(
                            emissionsFuture.join(), renewableFuture.join(), footprintFuture.join());
                    if (merged.size() >= 50) {
                        countries = Collections.unmodifiableMap(merged);
                        lastRefresh = Instant.now();
                        long complete = merged.values().stream().filter(c -> c.coverage() == 3).count();
                        lastRefreshMessage = "Loaded " + merged.size() + " countries/territories; " + complete + " have all three metrics.";
                    } else {
                        lastRefreshMessage = "Remote refresh returned too little data; retained bundled fallback data.";
                    }
                    return refreshStatus();
                })
                .whenComplete((result, error) -> refreshing.set(false));
    }

    public List<Map<String, Object>> allCountries() {
        return countries.values().stream()
                .sorted(Comparator.comparing(CountryClimateData::name, String.CASE_INSENSITIVE_ORDER))
                .map(CountryClimateData::toMap)
                .toList();
    }

    public CountryClimateData country(String iso3) {
        if (iso3 == null) return null;
        return countries.get(iso3.toUpperCase(Locale.ROOT));
    }

    public List<Map<String, Object>> index(String topic) {
        String normalized = topic == null ? "overall" : topic.toLowerCase(Locale.ROOT);
        return countries.values().stream()
                .map(c -> {
                    Double score = switch (normalized) {
                        case "emissions" -> c.emissionsScore();
                        case "energy" -> c.energyScore();
                        case "eco_footprint", "footprint" -> c.footprintScore();
                        default -> c.overallScore();
                    };
                    if (score == null) return null;
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("iso3", c.iso3());
                    row.put("name", c.name());
                    row.put("score", Math.round(score * 10.0) / 10.0);
                    row.put("status", c.status());
                    row.put("coverage", c.coverage());
                    return row;
                })
                .filter(Objects::nonNull)
                .sorted((a, b) -> Double.compare((Double) b.get("score"), (Double) a.get("score")))
                .toList();
    }

    public Map<String, Object> refreshStatus() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("refreshing", refreshing.get());
        m.put("lastRefresh", lastRefresh == null ? null : lastRefresh.toString());
        m.put("message", lastRefreshMessage);
        m.put("countryCount", countries.size());
        m.put("sources", List.of(
                Map.of("metric", "emissions", "name", "Our World in Data — CO₂ emissions per capita", "url", EMISSIONS_URL),
                Map.of("metric", "energy", "name", "Our World in Data — renewable share of final energy", "url", RENEWABLE_URL),
                Map.of("metric", "eco_footprint", "name", "Ecological footprint dataset adapter", "url", footprintSourceLabel())
        ));
        return m;
    }

    private Map<String, CountryClimateData> merge(Map<String, MetricPoint> emissions,
                                                   Map<String, MetricPoint> renewables,
                                                   Map<String, FootprintPoint> footprints) {
        Map<String, CountryClimateData> merged = new HashMap<>();

        emissions.forEach((iso3, point) -> {
            CountryClimateData c = merged.computeIfAbsent(iso3, k -> new CountryClimateData(iso3, point.name()));
            c.setName(point.name());
            c.setEmissions(point.value(), point.year());
        });
        renewables.forEach((iso3, point) -> {
            CountryClimateData c = merged.computeIfAbsent(iso3, k -> new CountryClimateData(iso3, point.name()));
            c.setName(point.name());
            c.setRenewable(point.value(), point.year());
        });
        footprints.forEach((iso3, point) -> {
            CountryClimateData c = merged.computeIfAbsent(iso3, k -> new CountryClimateData(iso3, point.name()));
            c.setName(point.name());
            c.setFootprint(point.footprint(), point.biocapacity());
        });

        Map<String, Double> emissionScores = percentileScores(merged, CountryClimateData::emissionsPerCapita, false);
        Map<String, Double> energyScores = percentileScores(merged, CountryClimateData::renewableShare, true);
        Map<String, Double> footprintScores = percentileScores(merged, CountryClimateData::ecologicalFootprint, false);

        merged.values().forEach(c -> {
            Double e = emissionScores.get(c.iso3());
            Double r = energyScores.get(c.iso3());
            Double f = footprintScores.get(c.iso3());
            Double overall = weightedOverall(e, r, f);
            c.setScores(e, r, f, overall);
        });
        return merged;
    }

    private interface MetricGetter { Double get(CountryClimateData country); }

    private Map<String, Double> percentileScores(Map<String, CountryClimateData> data, MetricGetter getter, boolean higherIsBetter) {
        List<CountryClimateData> present = data.values().stream()
                .filter(c -> getter.get(c) != null && Double.isFinite(getter.get(c)))
                .sorted(Comparator.comparingDouble(c -> getter.get(c)))
                .toList();
        Map<String, Double> scores = new HashMap<>();
        if (present.isEmpty()) return scores;
        if (present.size() == 1) {
            scores.put(present.get(0).iso3(), 50.0);
            return scores;
        }
        for (int i = 0; i < present.size(); i++) {
            double percentile = 100.0 * i / (present.size() - 1.0);
            double score = higherIsBetter ? percentile : 100.0 - percentile;
            scores.put(present.get(i).iso3(), score);
        }
        return scores;
    }

    private Double weightedOverall(Double emissions, Double energy, Double footprint) {
        int present = (emissions == null ? 0 : 1) + (energy == null ? 0 : 1) + (footprint == null ? 0 : 1);
        if (present < 2) return null;
        double total = 0;
        double weight = 0;
        if (emissions != null) { total += emissions * 0.40; weight += 0.40; }
        if (energy != null) { total += energy * 0.30; weight += 0.30; }
        if (footprint != null) { total += footprint * 0.30; weight += 0.30; }
        return total / weight;
    }

    private Map<String, MetricPoint> parseOwidLatest(String csv) {
        String[] lines = csv.split("\\R");
        if (lines.length < 2) return Map.of();
        List<String> header = Csv.parseLine(lines[0]);
        int entityIdx = indexOfIgnoreCase(header, "Entity");
        int codeIdx = indexOfIgnoreCase(header, "Code");
        int yearIdx = indexOfIgnoreCase(header, "Year");
        int valueIdx = header.size() - 1;
        if (entityIdx < 0 || codeIdx < 0 || yearIdx < 0) return Map.of();

        Map<String, MetricPoint> latest = new HashMap<>();
        for (int i = 1; i < lines.length; i++) {
            if (lines[i].isBlank()) continue;
            List<String> row = Csv.parseLine(lines[i]);
            if (row.size() <= Math.max(valueIdx, Math.max(entityIdx, Math.max(codeIdx, yearIdx)))) continue;
            String code = row.get(codeIdx).trim();
            if (!code.matches("[A-Z]{3}")) continue;
            try {
                int year = Integer.parseInt(row.get(yearIdx));
                String raw = row.get(valueIdx);
                if (raw == null || raw.isBlank()) continue;
                double value = Double.parseDouble(raw);
                String name = row.get(entityIdx);
                MetricPoint current = latest.get(code);
                if (current == null || year > current.year()) latest.put(code, new MetricPoint(code, name, value, year));
            } catch (NumberFormatException ignored) {}
        }
        return latest;
    }

    private Map<String, FootprintPoint> loadFootprintSource() throws IOException, InterruptedException {
        String configured = Env.get("FOOTPRINT_CSV_PATH");
        String csv;
        if (configured != null && !configured.isBlank()) {
            csv = Files.readString(Path.of(configured));
        } else {
            csv = remote.fetch(FOOTPRINT_FALLBACK_URL);
        }
        return parseFootprint(csv);
    }

    private String footprintSourceLabel() {
        String configured = Env.get("FOOTPRINT_CSV_PATH");
        return configured == null || configured.isBlank() ? FOOTPRINT_FALLBACK_URL : configured;
    }

    private Map<String, FootprintPoint> parseFootprint(String csv) {
        String[] lines = csv.split("\\R");
        Map<String, FootprintPoint> result = new HashMap<>();
        for (int i = 1; i < lines.length; i++) {
            if (lines[i].isBlank()) continue;
            List<String> row = Csv.parseLine(lines[i]);
            if (row.size() < 4) continue;
            String name = row.get(1).trim();
            if (name.equalsIgnoreCase("World")) continue;
            String iso3 = codes.resolve(name);
            if (iso3 == null) continue;
            try {
                double footprint = Double.parseDouble(row.get(2));
                Double biocapacity = row.get(3).isBlank() ? null : Double.parseDouble(row.get(3));
                result.put(iso3, new FootprintPoint(iso3, canonicalName(name), footprint, biocapacity));
            } catch (NumberFormatException ignored) {}
        }
        return result;
    }

    private String canonicalName(String name) {
        return switch (name) {
            case "Russia" -> "Russia";
            case "South Korea" -> "South Korea";
            case "North Korea" -> "North Korea";
            case "Swaziland" -> "Eswatini";
            case "Macedonia" -> "North Macedonia";
            default -> name;
        };
    }

    private int indexOfIgnoreCase(List<String> header, String name) {
        for (int i = 0; i < header.size(); i++) if (header.get(i).equalsIgnoreCase(name)) return i;
        return -1;
    }

    private void loadFallback() {
        Path path = Path.of("data", "fallback-climate.csv");
        if (!Files.exists(path)) return;
        try {
            List<String> lines = Files.readAllLines(path);
            Map<String, CountryClimateData> fallback = new HashMap<>();
            for (int i = 1; i < lines.size(); i++) {
                List<String> row = Csv.parseLine(lines.get(i));
                if (row.size() < 8) continue;
                CountryClimateData c = new CountryClimateData(row.get(0), row.get(1));
                c.setEmissions(parseDouble(row.get(2)), parseInt(row.get(3)));
                c.setRenewable(parseDouble(row.get(4)), parseInt(row.get(5)));
                c.setFootprint(parseDouble(row.get(6)), parseDouble(row.get(7)));
                fallback.put(c.iso3(), c);
            }
            countries = Collections.unmodifiableMap(mergeFromExisting(fallback));
            lastRefreshMessage = "Loaded bundled fallback data while live datasets initialize.";
        } catch (IOException ignored) {}
    }

    private Map<String, CountryClimateData> mergeFromExisting(Map<String, CountryClimateData> merged) {
        Map<String, Double> e = percentileScores(merged, CountryClimateData::emissionsPerCapita, false);
        Map<String, Double> r = percentileScores(merged, CountryClimateData::renewableShare, true);
        Map<String, Double> f = percentileScores(merged, CountryClimateData::ecologicalFootprint, false);
        merged.values().forEach(c -> c.setScores(e.get(c.iso3()), r.get(c.iso3()), f.get(c.iso3()), weightedOverall(e.get(c.iso3()), r.get(c.iso3()), f.get(c.iso3()))));
        return merged;
    }

    private Double parseDouble(String s) { try { return s == null || s.isBlank() ? null : Double.parseDouble(s); } catch (Exception e) { return null; } }
    private Integer parseInt(String s) { try { return s == null || s.isBlank() ? null : Integer.parseInt(s); } catch (Exception e) { return null; } }
}
