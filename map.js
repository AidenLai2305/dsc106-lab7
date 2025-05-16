import mapboxgl from "https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";

console.log("Mapbox GL JS Loaded:", mapboxgl);

mapboxgl.accessToken =
  "pk.eyJ1IjoiYWlkZW5sYWkiLCJhIjoiY21hcjc4cDA4MDNlZDJub2w0czkydjZ3aSJ9.bMHoLVtg4P_zBl7Ww2negg";

const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/streets-v12",
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

let timeFilter = -1;

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString("en-US", { timeStyle: "short" });
}

function computeStationTraffic(stations, trips) {
  const departures = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.start_station_id
  );

  const arrivals = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.end_station_id
  );

  return stations.map((station) => {
    let id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function filterTripsbyTime(trips, timeFilter) {
  return timeFilter === -1
    ? trips
    : trips.filter((trip) => {
        const startedMinutes = minutesSinceMidnight(trip.started_at);
        const endedMinutes = minutesSinceMidnight(trip.ended_at);
        return (
          Math.abs(startedMinutes - timeFilter) <= 60 ||
          Math.abs(endedMinutes - timeFilter) <= 60
        );
      });
}

map.on("load", async () => {
  map.addSource("boston_route", {
    type: "geojson",
    data: "https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson",
  });

  map.addLayer({
    id: "bike-lanes",
    type: "line",
    source: "boston_route",
    paint: {
      "line-color": "green",
      "line-width": 3,
      "line-opacity": 0.6,
    },
  });

  map.addSource("cambridge_route", {
    type: "geojson",
    data: "https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson",
  });

  map.addLayer({
    id: "cambridge-bike-lanes",
    type: "line",
    source: "cambridge_route",
    paint: {
      "line-color": "green",
      "line-width": 3,
      "line-opacity": 0.6,
    },
  });

  let jsonData;
  try {
    const jsonurl =
      "https://dsc106.com/labs/lab07/data/bluebikes-stations.json";

    jsonData = await d3.json(jsonurl);

    if (jsonData && jsonData.data && jsonData.data.stations) {
      let stations = jsonData.data.stations;

      const svg = d3.select("#map").append("svg");

      function getCoords(station) {
        const point = new mapboxgl.LngLat(+station.lon, +station.lat);
        const { x, y } = map.project(point);
        return { cx: x, cy: y };
      }

      let trips;
      try {
        const trafficUrl =
          "https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv";

        trips = await d3.csv(trafficUrl, (trip) => {
          trip.started_at = new Date(trip.started_at);
          trip.ended_at = new Date(trip.ended_at);
          return trip;
        });

        stations = computeStationTraffic(jsonData.data.stations, trips);
      } catch (error) {
        console.error("Error loading traffic data:", error);
        trips = [];
      }

      const radiusScale = d3
        .scaleSqrt()
        .domain([0, d3.max(stations, (d) => d.totalTraffic)])
        .range([0, 25]);

      const circles = svg
        .selectAll("circle")
        .data(stations, (d) => d.short_name)
        .enter()
        .append("circle")
        .attr("r", (d) => radiusScale(d.totalTraffic))
        // .attr("fill", "steelblue")
        .attr("stroke", "white")
        .attr("stroke-width", 1)
        .attr("opacity", 0.8)
        .each(function (d) {
          d3.select(this)
            .append("title")
            .text(
              `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
            );
        })
        .style('--departure-ratio', (d) =>
    stationFlow(d.departures / d.totalTraffic),
  );

      function updatePositions() {
        circles
          .attr("cx", (d) => getCoords(d).cx)
          .attr("cy", (d) => getCoords(d).cy);
      }

      updatePositions();

      map.on("move", updatePositions);
      map.on("zoom", updatePositions);
      map.on("resize", updatePositions);
      map.on("moveend", updatePositions);

      const timeSlider = document.getElementById("time-slider");
      const selectedTime = document.getElementById("selected-time");
      const anyTimeLabel = document.getElementById("any-time");

      function updateScatterPlot(timeFilter) {
        const filteredTrips = filterTripsbyTime(trips, timeFilter);

        const filteredStations = computeStationTraffic(stations, filteredTrips);

        timeFilter === -1
          ? radiusScale.range([0, 25])
          : radiusScale.range([3, 50]);

        circles
          .data(filteredStations, (d) => d.short_name)
          .join("circle")
          .attr("r", (d) => radiusScale(d.totalTraffic))
          .style('--departure-ratio', (d) =>
      stationFlow(d.departures / d.totalTraffic),
    );
      }

      function updateTimeDisplay() {
        timeFilter = Number(timeSlider.value);

        if (timeFilter === -1) {
        selectedTime.textContent = "";
        anyTimeLabel.style.visibility = "visible";
        } else {
          selectedTime.textContent = formatTime(timeFilter);
          anyTimeLabel.style.visibility = "hidden";
        }

        updateScatterPlot(timeFilter);
      }

      timeSlider.addEventListener("input", updateTimeDisplay);
      updateTimeDisplay();
    } else {
      console.error("Data structure not as expected:", jsonData);
    }
  } catch (error) {
    console.error("Error loading JSON:", error);
  }
});


let stationFlow = d3.scaleQuantize()
  .domain([0, 1])
  .range([0, 0.5, 1]);