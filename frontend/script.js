const API = "";

const MAX_POINTS = 24;
const POLL_INTERVAL = 2000;

let chart = null;
let poller = null;

const labels = [];
const predSeries = [];
const vehicleSeries = [];

const $ = (id) => document.getElementById(id);

const elements = {
  loadingOverlay: $("loading-overlay"),
  loadingText: $("loading-text"),
  uploadError: $("upload-error"),
  uploadInput: $("input-video"),
  uploadBtn: $("btn-upload-analyze"),
  runBtn: $("btn-run-yolo"),
  emergencyToggle: $("emergency-toggle"),
};

function setText(id, value = "—") {
  const node = $(id);
  if (node) node.textContent = value;
}

function toggleClass(el, className, force) {
  if (el) el.classList.toggle(className, force);
}

function setLoading(show, message = "Loading...") {
  if (!elements.loadingOverlay) return;

  elements.loadingText.textContent = message;

  toggleClass(elements.loadingOverlay, "hidden", !show);

  elements.loadingOverlay.setAttribute(
    "aria-hidden",
    show ? "false" : "true"
  );

  document.body.style.overflow = show ? "hidden" : "";
}

function showUploadError(message = "") {
  if (!elements.uploadError) return;

  if (!message) {
    elements.uploadError.textContent = "";
    elements.uploadError.classList.add("hidden");
    return;
  }

  elements.uploadError.textContent = message;
  elements.uploadError.classList.remove("hidden");
}

function setBusy(state) {
  elements.runBtn.disabled = state;

  elements.uploadBtn.disabled =
    state || !elements.uploadInput.files?.length;

  elements.uploadInput.disabled = state;
}

async function request(path, options = {}) {
  const response = await fetch(API + path, options);

  const text = await response.text();

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(text || `HTTP ${response.status}`);
  }

  if (!response.ok) {
    throw new Error(
      data.error ||
      data.message ||
      `Request failed (${response.status})`
    );
  }

  return data;
}

function setLights(nsGreen) {
  const nsLights = $("light-ns")?.querySelectorAll(".bulb");
  const ewLights = $("light-ew")?.querySelectorAll(".bulb");

  if (!nsLights || !ewLights) return;

  [...nsLights, ...ewLights].forEach((b) =>
    b.classList.remove("on")
  );

  if (nsGreen) {
    nsLights[2].classList.add("on");
    ewLights[0].classList.add("on");
  } else {
    nsLights[0].classList.add("on");
    ewLights[2].classList.add("on");
  }
}

function updateDashboard(data) {
  if (!data?.counts) return;

  const counts = data.counts;

  setText("metric-total", counts.total_vehicles);
  setText("metric-density", data.density);

  setText("lane-north", counts.north ?? 0);
  setText("lane-south", counts.south ?? 0);
  setText("lane-east", counts.east ?? 0);
  setText("lane-west", counts.west ?? 0);

  if (data.signal_state) {
    const signal = data.signal_state;

    setText(
      "metric-timer",
      signal.active_green_duration_sec
    );

    const nsGreen = signal.north_south?.is_green;

    if (typeof nsGreen === "boolean") {
      setLights(nsGreen);

      setText(
        "active-corridor",
        `Corridor: ${
          nsGreen ? "North–South" : "East–West"
        }`
      );
    }
  }
}

async function pollSignal() {
  const data = await request("/api/get_signal");

  const signal = data.signal_state;

  if (!signal) return;

  const nsGreen = signal.north_south?.is_green;

  setLights(nsGreen);

  setText(
    "active-corridor",
    `Corridor: ${
      nsGreen ? "North–South" : "East–West"
    }`
  );

  setText(
    "metric-timer",
    signal.active_green_duration_sec
  );

  setText("metric-density", signal.density);

  const alert = $("alert-emergency");

  if (
    data.emergency?.active ||
    data.last_emergency_detected
  ) {
    alert.classList.remove("hidden");

    alert.textContent = data.emergency?.active
      ? "Emergency corridor override active"
      : "Emergency vehicle detected";
  } else {
    alert.classList.add("hidden");
  }
}

function updateChart(prediction, vehicleCount) {
  const time = new Date().toLocaleTimeString();

  labels.push(time);
  predSeries.push(prediction);
  vehicleSeries.push(vehicleCount);

  if (labels.length > MAX_POINTS) {
    labels.shift();
    predSeries.shift();
    vehicleSeries.shift();
  }

  chart.data.labels = labels;
  chart.data.datasets[0].data = predSeries;
  chart.data.datasets[1].data = vehicleSeries;

  chart.update("none");
}

async function pollPredict() {
  const data = await request("/api/predict", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  setText("metric-ml", data.level);

  setText(
    "metric-ml-sub",
    `Score ${data.prediction.toFixed(1)} · vehicles used: ${data.vehicle_count_used}`
  );

  updateChart(
    data.prediction,
    data.vehicle_count_used
  );
}

async function runVideo() {
  try {
    showUploadError("");

    setBusy(true);

    setLoading(true, "Running sample detection...");

    const data = await request("/api/process_video", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source: "file",
        path: "../ai/dataset/sample_traffic.mp4",
        max_frames: 30,
      }),
    });

    updateDashboard(data);

  } catch (error) {

    console.error(error);

    showUploadError(
      error.message || "Sample detection failed."
    );

  } finally {

    setBusy(false);

    setLoading(false);
  }
}

async function uploadAndAnalyze() {
  const file = elements.uploadInput.files?.[0];

  if (!file) {
    showUploadError("Choose a video first.");
    return;
  }

  try {
    showUploadError("");

    setBusy(true);

    setLoading(true, "Uploading and analyzing video...");

    const formData = new FormData();

    formData.append("video", file, file.name);
    formData.append("max_frames", "40");

    const response = await fetch(
      API + "/api/upload_video",
      {
        method: "POST",
        body: formData,
      }
    );

    const text = await response.text();

    const data = text ? JSON.parse(text) : {};

    if (!response.ok) {
      throw new Error(
        data.error ||
        `Upload failed (${response.status})`
      );
    }

    updateDashboard(data);

  } catch (error) {

    console.error(error);

    showUploadError(
      error.message || "Upload failed."
    );

  } finally {

    setBusy(false);

    setLoading(false);
  }
}

function onVideoSelected() {
  const file = elements.uploadInput.files?.[0];

  elements.uploadBtn.disabled = !file;

  $("upload-filename").textContent =
    file?.name || "No file selected";

  showUploadError("");
}

async function toggleEmergency() {
  await request("/api/emergency", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      active: elements.emergencyToggle.checked,
      corridor: "north_south",
    }),
  });
}

function initChart() {
  const ctx = $("chart-traffic")?.getContext("2d");

  if (!ctx) return;

  chart = new Chart(ctx, {
    type: "line",

    data: {
      labels: [],
      datasets: [
        {
          label: "ML congestion",
          data: [],
          borderColor: "#3d8bfd",
          tension: 0.3,
          yAxisID: "y",
        },
        {
          label: "Vehicle count",
          data: [],
          borderColor: "#22c55e",
          tension: 0.3,
          yAxisID: "y1",
        },
      ],
    },

    options: {
      responsive: true,

      interaction: {
        mode: "index",
        intersect: false,
      },

      plugins: {
        legend: {
          labels: {
            color: "#cbd5e1",
          },
        },
      },

      scales: {
        y: {
          min: 0,
          max: 100,
          position: "left",
        },

        y1: {
          min: 0,
          position: "right",
          grid: {
            drawOnChartArea: false,
          },
        },
      },
    },
  });
}

function startPolling() {
  if (poller) clearInterval(poller);

  poller = setInterval(async () => {
    try {
      await Promise.all([
        pollSignal(),
        pollPredict(),
      ]);
    } catch (error) {
      console.error(error);
    }
  }, POLL_INTERVAL);
}

async function boot() {
  initChart();

  elements.runBtn.addEventListener(
    "click",
    runVideo
  );

  elements.uploadBtn.addEventListener(
    "click",
    uploadAndAnalyze
  );

  elements.uploadInput.addEventListener(
    "change",
    onVideoSelected
  );

  elements.emergencyToggle.addEventListener(
    "change",
    toggleEmergency
  );

  await runVideo().catch(console.error);

  startPolling();

  pollSignal().catch(console.error);

  pollPredict().catch(console.error);
}

document.addEventListener(
  "DOMContentLoaded",
  boot
);