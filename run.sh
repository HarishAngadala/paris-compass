#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
rm -rf build/classes
mkdir -p build/classes
find src/main/java -name '*.java' -print0 | xargs -0 javac --release 21 -encoding UTF-8 -d build/classes
exec java -cp build/classes com.pariscompass.ParisCompassServer
