# Paris Compass

Paris Compass is a full-stack interactive climate dashboard that compares country-level environmental performance across **CO₂ emissions per capita**, **renewable energy use**, and **ecological footprint**. It was originally conceived for HackRU and completed here as a runnable Java + JavaScript project.

## What the finished project does

- Renders a global **Leaflet.js** choropleth with 190+ country/territory boundaries.
- Loads live country-level emissions and renewable-energy data from **Our World in Data**.
- Supports ecological-footprint data through an adapter that can read either a configured official CSV export or a public compatibility CSV.
- Computes a custom **Climate Compliance Index** from normalized percentile scores.
- Lets users switch between overall, emissions, energy, and footprint layers without reloading the page.
- Provides country search, a leaderboard, detailed metric cards, and score coverage indicators.
- Generates concise country insights through the **Gemini API** without exposing the API key to the browser.
- Uses asynchronous data fetching, request timeouts, retries, caching, and parallel backend refreshes.
- Starts with bundled fallback data so the UI can still demonstrate the project while live sources initialize.

> **Important:** The Climate Compliance Index is a project-defined comparative score. It is **not** an official UN or Paris Agreement compliance rating.

---

## Tech stack

- **Backend:** Java 21, built-in `HttpServer`, `HttpClient`, virtual-thread request executor
- **Frontend:** HTML5, CSS3, vanilla JavaScript ES modules
- **Mapping:** Leaflet.js + OpenStreetMap tiles
- **AI:** Google Gemini API
- **Data:** Our World in Data + ecological-footprint CSV adapter
- **DevOps:** Docker, GitHub Actions

No Maven, Gradle, Node packages, or npm install is required.

---

## Project structure

```text
paris-compass/
├── .github/workflows/ci.yml
├── data/
│   └── fallback-climate.csv
├── src/main/java/com/pariscompass/
│   ├── ParisCompassServer.java
│   ├── http/
│   │   ├── HttpUtil.java
│   │   └── StaticFileHandler.java
│   ├── model/
│   │   ├── CountryClimateData.java
│   │   ├── FootprintPoint.java
│   │   └── MetricPoint.java
│   ├── service/
│   │   ├── ClimateDataService.java
│   │   ├── GeminiService.java
│   │   └── RemoteCsvService.java
│   └── util/
│       ├── CountryCodeResolver.java
│       ├── Csv.java
│       ├── Env.java
│       └── Json.java
├── web/
│   ├── assets/compass.svg
│   ├── css/styles.css
│   ├── js/api.js
│   ├── js/app.js
│   ├── js/map.js
│   └── index.html
├── .env.example
├── .gitignore
├── Dockerfile
├── LICENSE
├── run.bat
├── run.sh
└── README.md
```

---

## Run locally

### Requirements

Install **Java 21 or newer**.

Check it with:

```bash
java -version
javac -version
```

### macOS / Linux

```bash
git clone <your-repository-url>
cd paris-compass
./run.sh
```

Open:

```text
http://localhost:8080
```

### Windows

Run:

```bat
run.bat
```

Then open `http://localhost:8080`.

---

## Enable Gemini insights

1. Copy the environment template:

```bash
cp .env.example .env
```

2. Add your Gemini API key:

```dotenv
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.5-flash
PORT=8080
```

The browser never receives the Gemini key. All AI requests go through the Java backend.

If no Gemini key is configured, the project automatically returns a deterministic local summary instead, so the feature remains usable during demos.

---

## Climate Compliance Index

Each available metric is converted to a **0–100 percentile score** against other countries in the loaded dataset.

### Direction

- **CO₂ emissions per capita:** lower is better
- **Renewable share of final energy:** higher is better
- **Ecological footprint per person:** lower is better

### Weights

```text
Overall = 40% Emissions + 30% Renewable Energy + 30% Ecological Footprint
```

If one metric is unavailable, the remaining available weights are re-normalized. At least two metrics are required for an overall score.

### Status bands

| Overall score | Status |
|---:|---|
| 80–100 | Leading |
| 60–79.9 | Advancing |
| 40–59.9 | Mixed progress |
| < 40 | Lagging |

These are UI categories for this project only.

---

## Live data sources

### CO₂ emissions per capita

Our World in Data Grapher API:

```text
https://ourworldindata.org/grapher/co-emissions-per-capita.csv?v=1&csvType=full&useColumnShortNames=false
```

The backend keeps the latest available observation for each ISO-3 country code.

### Renewable energy

Our World in Data — share of final energy consumption from renewable sources:

```text
https://ourworldindata.org/grapher/share-of-final-energy-consumption-from-renewable-sources.csv?v=1&csvType=full&useColumnShortNames=false
```

### Ecological footprint

For a quick clone-and-run demo, the default adapter reads:

```text
https://raw.githubusercontent.com/DaveSV/Ecological-Footprint-Web-Map/main/footprint.csv
```

For a portfolio/public deployment, use the current official National Ecological Footprint and Biocapacity Accounts data from Global Footprint Network / Footprint Data Foundation and point Paris Compass to the local CSV:

```dotenv
FOOTPRINT_CSV_PATH=/absolute/path/to/your/footprint.csv
```

The adapter expects a CSV where the country name is column 2, ecological footprint is column 3, and biocapacity is column 4, matching the included compatibility format. If your official export uses different columns, update `parseFootprint()` in `ClimateDataService.java`.

---

## Backend API

### Health / data status

```http
GET /api/health
```

### All countries

```http
GET /api/countries
```

### Ranked index

```http
GET /api/index?topic=overall
GET /api/index?topic=emissions
GET /api/index?topic=energy
GET /api/index?topic=eco_footprint
```

### One country

```http
GET /api/country?code=USA
```

### AI country insight

```http
GET /api/insights?code=USA
```

### Refresh remote datasets

```http
POST /api/refresh
```

---

## Performance work represented by the project

The completed implementation contains the technical pieces reflected in the resume description:

- **Parallel backend dataset requests** with `CompletableFuture`
- **Java 21 virtual threads** for concurrent HTTP request handling
- Browser-side **timeouts and retries** with `AbortController`
- Short-lived **GET response caching** in the frontend fetch layer
- Server-side **Gemini response caching** for repeat country requests
- Latest-observation preprocessing so the frontend receives only the records it needs
- Country data indexed by ISO-3 code for constant-time lookups
- One reusable Leaflet GeoJSON layer that is restyled instead of rebuilt on every metric change

These optimizations make the app substantially faster than re-fetching and reparsing every source on every interaction. If you want to retain the exact resume claim of a **30% latency reduction**, benchmark the original and optimized versions and save the measurements in the repository.

---

## Docker

Build and run:

```bash
docker build -t paris-compass .
docker run --rm -p 8080:8080 --env-file .env paris-compass
```

Then open `http://localhost:8080`.

---

## GitHub / deployment suggestions

For a portfolio deployment:

1. Push this folder to a GitHub repository named `paris-compass`.
2. Keep `.env` out of Git; it is already ignored.
3. Configure `GEMINI_API_KEY` as a secret/environment variable on your hosting platform.
4. Deploy the Docker image to Render, Railway, Fly.io, Google Cloud Run, or another Java/Docker host.
5. Add a screenshot/GIF to the README after deployment.

Because the backend is required for the Gemini key and live dataset aggregation, GitHub Pages alone is not sufficient for the full application.

---

## Resume-ready description

**Paris Compass (HackRU)** | Gemini API, Java, JavaScript, HTML/CSS, GitHub, Leaflet.js

- Built an interactive geospatial web application visualizing environmental datasets across 190+ countries using Leaflet.js.
- Implemented dynamic map layers, event handlers, and ISO-3 data binding to render country-level climate performance interactively.
- Integrated Gemini API through asynchronous requests and optimized request handling, caching, and JSON processing for responsive country insights.

---

## License and data attribution

Application source code is released under the MIT License. Third-party datasets and map tiles retain their own licenses and attribution requirements. Review the terms of each source before publishing or redistributing data snapshots.
