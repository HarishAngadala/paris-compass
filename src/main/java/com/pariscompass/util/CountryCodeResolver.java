package com.pariscompass.util;

import java.text.Normalizer;
import java.util.*;

public final class CountryCodeResolver {
    private final Map<String, String> byName = new HashMap<>();

    public CountryCodeResolver() {
        for (String alpha2 : Locale.getISOCountries()) {
            Locale locale = new Locale("", alpha2);
            try {
                byName.put(normalize(locale.getDisplayCountry(Locale.ENGLISH)), locale.getISO3Country().toUpperCase(Locale.ROOT));
            } catch (MissingResourceException ignored) {}
        }

        alias("United States", "USA");
        alias("United States of America", "USA");
        alias("Russia", "RUS");
        alias("Russian Federation", "RUS");
        alias("South Korea", "KOR");
        alias("Republic of Korea", "KOR");
        alias("North Korea", "PRK");
        alias("Democratic People's Republic of Korea", "PRK");
        alias("Iran", "IRN");
        alias("Iran, Islamic Republic of", "IRN");
        alias("Vietnam", "VNM");
        alias("Viet Nam", "VNM");
        alias("Bolivia", "BOL");
        alias("Venezuela", "VEN");
        alias("Tanzania", "TZA");
        alias("Syria", "SYR");
        alias("Laos", "LAO");
        alias("Lao People's Democratic Republic", "LAO");
        alias("Cape Verde", "CPV");
        alias("Cabo Verde", "CPV");
        alias("Swaziland", "SWZ");
        alias("Eswatini", "SWZ");
        alias("Macedonia", "MKD");
        alias("North Macedonia", "MKD");
        alias("Brunei", "BRN");
        alias("Moldova", "MDA");
        alias("Czech Republic", "CZE");
        alias("Czechia", "CZE");
        alias("Taiwan", "TWN");
        alias("Palestine", "PSE");
        alias("State of Palestine", "PSE");
        alias("Ivory Coast", "CIV");
        alias("Côte d'Ivoire", "CIV");
        alias("Congo", "COG");
        alias("Republic of the Congo", "COG");
        alias("Democratic Republic of the Congo", "COD");
        alias("DR Congo", "COD");
        alias("Micronesia", "FSM");
        alias("The Gambia", "GMB");
        alias("Gambia", "GMB");
        alias("Bahamas", "BHS");
        alias("The Bahamas", "BHS");
        alias("Turkey", "TUR");
        alias("Türkiye", "TUR");
        alias("Timor-Leste", "TLS");
        alias("East Timor", "TLS");
        alias("Sao Tome and Principe", "STP");
        alias("São Tomé and Príncipe", "STP");
    }

    public String resolve(String name) {
        if (name == null) return null;
        return byName.get(normalize(name));
    }

    private void alias(String name, String code) {
        byName.put(normalize(name), code);
    }

    private String normalize(String s) {
        String n = Normalizer.normalize(s, Normalizer.Form.NFD).replaceAll("\\p{M}", "");
        return n.toLowerCase(Locale.ROOT)
                .replace('&', ' ')
                .replaceAll("[^a-z0-9]+", " ")
                .trim()
                .replaceAll("\\s+", " ");
    }
}
