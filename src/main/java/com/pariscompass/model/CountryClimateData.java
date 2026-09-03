package com.pariscompass.model;

import java.util.LinkedHashMap;
import java.util.Map;

public final class CountryClimateData {
    private final String iso3;
    private String name;
    private Double emissionsPerCapita;
    private Integer emissionsYear;
    private Double renewableShare;
    private Integer renewableYear;
    private Double ecologicalFootprint;
    private Double biocapacity;
    private Double emissionsScore;
    private Double energyScore;
    private Double footprintScore;
    private Double overallScore;

    public CountryClimateData(String iso3, String name) {
        this.iso3 = iso3;
        this.name = name;
    }

    public String iso3() { return iso3; }
    public String name() { return name; }
    public Double emissionsPerCapita() { return emissionsPerCapita; }
    public Integer emissionsYear() { return emissionsYear; }
    public Double renewableShare() { return renewableShare; }
    public Integer renewableYear() { return renewableYear; }
    public Double ecologicalFootprint() { return ecologicalFootprint; }
    public Double biocapacity() { return biocapacity; }
    public Double emissionsScore() { return emissionsScore; }
    public Double energyScore() { return energyScore; }
    public Double footprintScore() { return footprintScore; }
    public Double overallScore() { return overallScore; }

    public void setName(String name) { if (name != null && !name.isBlank()) this.name = name; }
    public void setEmissions(Double value, Integer year) { this.emissionsPerCapita = value; this.emissionsYear = year; }
    public void setRenewable(Double value, Integer year) { this.renewableShare = value; this.renewableYear = year; }
    public void setFootprint(Double footprint, Double biocapacity) { this.ecologicalFootprint = footprint; this.biocapacity = biocapacity; }
    public void setScores(Double emissions, Double energy, Double footprint, Double overall) {
        this.emissionsScore = emissions;
        this.energyScore = energy;
        this.footprintScore = footprint;
        this.overallScore = overall;
    }

    public int coverage() {
        int n = 0;
        if (emissionsPerCapita != null) n++;
        if (renewableShare != null) n++;
        if (ecologicalFootprint != null) n++;
        return n;
    }

    public String status() {
        if (overallScore == null) return "Insufficient data";
        if (overallScore >= 80) return "Leading";
        if (overallScore >= 60) return "Advancing";
        if (overallScore >= 40) return "Mixed progress";
        return "Lagging";
    }

    public Map<String, Object> toMap() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("iso3", iso3);
        m.put("name", name);
        m.put("emissionsPerCapita", round(emissionsPerCapita, 3));
        m.put("emissionsYear", emissionsYear);
        m.put("renewableShare", round(renewableShare, 2));
        m.put("renewableYear", renewableYear);
        m.put("ecologicalFootprint", round(ecologicalFootprint, 2));
        m.put("biocapacity", round(biocapacity, 2));
        m.put("emissionsScore", round(emissionsScore, 1));
        m.put("energyScore", round(energyScore, 1));
        m.put("footprintScore", round(footprintScore, 1));
        m.put("overallScore", round(overallScore, 1));
        m.put("coverage", coverage());
        m.put("status", status());
        return m;
    }

    private static Double round(Double value, int places) {
        if (value == null || value.isNaN() || value.isInfinite()) return null;
        double scale = Math.pow(10, places);
        return Math.round(value * scale) / scale;
    }
}
