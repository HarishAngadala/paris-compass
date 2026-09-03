FROM eclipse-temurin:21-jdk
WORKDIR /app
COPY . .
RUN chmod +x run.sh && mkdir -p build/classes && find src/main/java -name '*.java' -print0 | xargs -0 javac --release 21 -encoding UTF-8 -d build/classes
EXPOSE 8080
CMD ["java", "-cp", "build/classes", "com.pariscompass.ParisCompassServer"]
