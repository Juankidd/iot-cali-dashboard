const MAX_POINTS = 288; // 24h at 5-minute equivalent history density for demo
const UPDATE_MS = 5000;
let running = true;
let timer;
let history = [];
let previous = null;

const $ = (id) => document.getElementById(id);
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const noise = (amplitude = 1) => (Math.random() - 0.5) * 2 * amplitude;
const round = (n, d = 1) => Number(n.toFixed(d));

function caliNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(new Date()).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
  return new Date(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}-05:00`);
}

function formatCaliClock(date = new Date()) {
  $('caliTime').textContent = new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(date);
  $('caliDate').textContent = new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota', weekday: 'short', day: '2-digit', month: 'short'
  }).format(date);
}

function solarFactor(hour) {
  if (hour < 5.7 || hour > 18.2) return 0;
  const normalized = (hour - 5.7) / (18.2 - 5.7);
  return Math.sin(Math.PI * normalized);
}

function simulateAt(date, last = null) {
  const hour = date.getHours() + date.getMinutes()/60;
  const solar = solarFactor(hour);

  const airBase = 23.2 + 7.1 * Math.pow(solar, 0.7) - (hour < 6 ? 1.2 : 0);
  let airTemp = airBase + noise(0.45);
  let soilTemp = 23.7 + 3.2 * Math.pow(Math.max(0, solar), 0.8) + noise(0.25);

  const rainChance = (hour > 14 && hour < 19) ? 0.08 : 0.015;
  const rainPulse = Math.random() < rainChance ? Math.random()*7 + 2 : 0;
  let soilMoisture = last ? last.soilMoisture - (0.015 + solar*0.05) + noise(0.16) + rainPulse : 63 + noise(4);
  soilMoisture = clamp(soilMoisture, 32, 88);

  let ph = last ? last.ph + noise(0.015) : 6.25 + noise(0.12);
  ph = clamp(ph, 5.65, 6.9);

  let radiation = solar === 0 ? 0 : clamp(880 * Math.pow(solar, 1.15) + noise(45), 0, 980);
  if (rainPulse > 0) radiation *= 0.45;

  const airHumidity = clamp(84 - solar*34 + noise(4) + (rainPulse > 0 ? 8 : 0), 45, 96);
  const feelsLike = airTemp + Math.max(0, (airHumidity - 65) * 0.025);

  return {
    time: new Date(date),
    airTemp: round(airTemp), soilTemp: round(soilTemp), soilMoisture: round(soilMoisture),
    ph: round(ph, 2), radiation: Math.round(radiation), airHumidity: Math.round(airHumidity),
    feelsLike: round(feelsLike)
  };
}

function seedHistory() {
  history = [];
  const now = caliNow();
  let last = null;
  for (let i = 48; i >= 0; i--) {
    const t = new Date(now.getTime() - i * 30 * 60 * 1000);
    const row = simulateAt(t, last);
    history.push(row);
    last = row;
  }
  previous = history.at(-2);
}

Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
Chart.defaults.color = '#6d7d77';
Chart.defaults.borderColor = '#e8eeeb';

const commonOptions = {
  responsive: true, maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { display: false },
    tooltip: { backgroundColor: '#10261f', padding: 10, cornerRadius: 10, titleFont: { weight: 700 } }
  },
  scales: {
    x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { size: 10 } } },
    y: { grid: { color: '#eef2f0' }, ticks: { font: { size: 10 } } }
  }
};

const temperatureChart = new Chart($('temperatureChart'), {
  type: 'line',
  data: { labels: [], datasets: [
    { label: 'Ambiente', data: [], borderColor: '#1f7a5a', backgroundColor: 'rgba(31,122,90,.08)', fill: true, tension: .38, borderWidth: 2.2, pointRadius: 0 },
    { label: 'Suelo', data: [], borderColor: '#d18b47', backgroundColor: 'transparent', fill: false, tension: .35, borderWidth: 2, pointRadius: 0 }
  ]}, options: commonOptions
});

const soilChart = new Chart($('soilChart'), {
  type: 'line',
  data: { labels: [], datasets: [
    { label: 'Humedad %', data: [], borderColor: '#3a84b8', tension: .35, borderWidth: 2, pointRadius: 0, yAxisID: 'y' },
    { label: 'pH', data: [], borderColor: '#8f63b8', tension: .35, borderWidth: 2, pointRadius: 0, yAxisID: 'y1' }
  ]},
  options: { ...commonOptions, scales: {
    x: commonOptions.scales.x,
    y: { min: 20, max: 100, grid: { color: '#eef2f0' }, ticks: { font: { size: 10 } } },
    y1: { min: 4, max: 8, position: 'right', grid: { drawOnChartArea: false }, ticks: { font: { size: 10 } } }
  }}
});

const radiationChart = new Chart($('radiationChart'), {
  type: 'bar',
  data: { labels: [], datasets: [{ label: 'Radiación', data: [], backgroundColor: 'rgba(230,166,59,.72)', borderRadius: 7, maxBarThickness: 18 }] },
  options: { ...commonOptions, scales: { x: commonOptions.scales.x, y: { beginAtZero: true, suggestedMax: 1000, grid: { color: '#eef2f0' }, ticks: { font: { size: 10 } } } } }
});


// --- Mapa IoT de Cali ---
const CALI_COORDS = [3.4516, -76.5320];
let iotMap = null;
let caliMarker = null;

function initIoTMap() {
  if (typeof L === 'undefined' || !$('iotMap')) return;

  iotMap = L.map('iotMap', {
    zoomControl: true,
    scrollWheelZoom: false
  }).setView(CALI_COORDS, 12);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(iotMap);

  const icon = L.divIcon({
    className: '',
    html: '<div class="iot-marker"></div>',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -14]
  });

  caliMarker = L.marker(CALI_COORDS, { icon, title: 'Cali · Sensor Cali-01' }).addTo(iotMap);
  caliMarker.on('click', () => {
    updateMapData(history.at(-1), true);
  });

  $('citySelector')?.addEventListener('change', (e) => {
    if (e.target.value === 'cali') {
      iotMap.flyTo(CALI_COORDS, 13, { duration: .8 });
      updateMapData(history.at(-1), true);
    }
  });

  setTimeout(() => iotMap.invalidateSize(), 100);
}

function updateMapData(d, openPopup = false) {
  if (!d) return;
  const score = computeScore(d);
  $('mapAirTemp').textContent = `${d.airTemp.toFixed(1)} °C`;
  $('mapSoilTemp').textContent = `${d.soilTemp.toFixed(1)} °C`;
  $('mapSoilMoisture').textContent = `${d.soilMoisture.toFixed(1)}%`;
  $('mapPh').textContent = d.ph.toFixed(2);
  $('mapRadiation').textContent = `${d.radiation} W/m²`;
  $('mapHealth').textContent = `${score}/100`;
  $('mapUpdated').textContent = new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false
  }).format(d.time);

  if (caliMarker) {
    const popup = `
      <div class="iot-popup">
        <strong>Cali · Sensor Cali-01</strong>
        <div class="iot-popup-grid">
          <span>T. ambiente</span><b>${d.airTemp.toFixed(1)} °C</b>
          <span>T. suelo</span><b>${d.soilTemp.toFixed(1)} °C</b>
          <span>Humedad suelo</span><b>${d.soilMoisture.toFixed(1)}%</b>
          <span>pH</span><b>${d.ph.toFixed(2)}</b>
          <span>Radiación</span><b>${d.radiation} W/m²</b>
          <span>Índice ambiental</span><b>${score}/100</b>
        </div>
      </div>`;
    caliMarker.bindPopup(popup);
    if (openPopup) caliMarker.openPopup();
  }
}

function trendText(now, before) {
  const d = round(now - before);
  return `${d >= 0 ? '↗' : '↘'} ${Math.abs(d).toFixed(1)}`;
}

function computeScore(d) {
  let s = 100;
  s -= Math.abs(d.airTemp - 27) * 2;
  s -= Math.abs(d.soilTemp - 25.5) * 1.3;
  if (d.soilMoisture < 45) s -= (45-d.soilMoisture)*1.3;
  if (d.soilMoisture > 78) s -= (d.soilMoisture-78)*.8;
  s -= Math.abs(d.ph - 6.3) * 9;
  return Math.round(clamp(s, 55, 99));
}

function updateHero(d) {
  const hour = d.time.getHours() + d.time.getMinutes()/60;
  const score = computeScore(d);
  $('healthScore').textContent = score;
  $('radialGauge').style.setProperty('--value', score);
  $('heroTemp').textContent = d.airTemp.toFixed(1);
  $('feelsLike').textContent = `${d.feelsLike.toFixed(1)}°C`;
  $('airHumidity').textContent = `${d.airHumidity}%`;

  let weatherText = 'Cálido y parcialmente despejado';
  let icon = '⛅';
  if (d.radiation === 0) { weatherText = 'Noche cálida y húmeda'; icon = '🌙'; }
  else if (d.radiation > 700) { weatherText = 'Alta radiación y cielo mayormente despejado'; icon = '☀'; }
  else if (d.radiation < 250 && hour > 6 && hour < 18) { weatherText = 'Nubosidad variable'; icon = '☁'; }
  $('weatherText').textContent = weatherText;
  $('weatherIcon').textContent = icon;

  const badge = $('overallBadge');
  if (score >= 82) { badge.textContent = 'Óptima'; badge.className = 'badge good'; $('overallMessage').textContent = 'Las variables se mantienen en rangos favorables para un cultivo tropical.'; }
  else { badge.textContent = 'Atención'; badge.className = 'badge warn'; $('overallMessage').textContent = 'Una o más variables se alejan del rango de referencia y conviene revisarlas.'; }
}

function updateMetrics(d) {
  $('airTemp').textContent = d.airTemp.toFixed(1);
  $('soilTemp').textContent = d.soilTemp.toFixed(1);
  $('soilMoisture').textContent = d.soilMoisture.toFixed(1);
  $('ph').textContent = d.ph.toFixed(2);
  $('radiation').textContent = d.radiation;
  if (previous) {
    $('airTempTrend').textContent = trendText(d.airTemp, previous.airTemp);
    $('soilTempTrend').textContent = trendText(d.soilTemp, previous.soilTemp);
  }

  $('moistureStatus').textContent = d.soilMoisture < 45 ? 'Baja' : d.soilMoisture > 78 ? 'Alta' : 'Adecuada';
  $('moistureStatus').className = `metric-status ${d.soilMoisture < 45 || d.soilMoisture > 78 ? 'warn' : 'ok'}`;
  $('phStatus').textContent = d.ph < 5.5 || d.ph > 7 ? 'Revisar' : 'Balanceado';
  $('phStatus').className = `metric-status ${d.ph < 5.5 || d.ph > 7 ? 'warn' : 'ok'}`;
  $('radiationStatus').textContent = d.radiation === 0 ? 'Inactiva' : d.radiation > 800 ? 'Alta' : 'Activa';
  $('radiationStatus').className = `metric-status ${d.radiation > 900 ? 'warn' : 'ok'}`;
  $('dayPhase').textContent = d.radiation === 0 ? 'Fase nocturna' : d.radiation > 650 ? 'Radiación intensa' : 'Fase diurna';
}

function updateCharts() {
  const labels = history.map(d => new Intl.DateTimeFormat('es-CO', { timeZone:'America/Bogota', hour:'2-digit', minute:'2-digit', hour12:false }).format(d.time));
  temperatureChart.data.labels = labels;
  temperatureChart.data.datasets[0].data = history.map(d => d.airTemp);
  temperatureChart.data.datasets[1].data = history.map(d => d.soilTemp);
  temperatureChart.update('none');

  soilChart.data.labels = labels;
  soilChart.data.datasets[0].data = history.map(d => d.soilMoisture);
  soilChart.data.datasets[1].data = history.map(d => d.ph);
  soilChart.update('none');

  radiationChart.data.labels = labels;
  radiationChart.data.datasets[0].data = history.map(d => d.radiation);
  radiationChart.update('none');

  const avgM = history.reduce((a,b)=>a+b.soilMoisture,0)/history.length;
  const avgP = history.reduce((a,b)=>a+b.ph,0)/history.length;
  const peak = Math.max(...history.map(d=>d.radiation));
  $('avgMoisture').textContent = `${avgM.toFixed(1)}%`;
  $('avgPh').textContent = avgP.toFixed(2);
  $('radiationPeak').textContent = `Pico ${peak} W/m²`;
}

function updateInsights(d) {
  const insightData = [];
  if (d.soilMoisture < 45) insightData.push(['Riego sugerido','La humedad del suelo está por debajo del rango operativo de referencia.']);
  else if (d.soilMoisture > 78) insightData.push(['Suelo muy húmedo','La humedad elevada podría justificar revisar drenaje o riego reciente.']);
  else insightData.push(['Humedad adecuada','El suelo conserva una humedad compatible con condiciones estables de cultivo.']);

  if (d.radiation > 800) insightData.push(['Radiación elevada','La carga solar es alta; la temperatura ambiente puede aumentar durante las próximas horas.']);
  else if (d.radiation === 0) insightData.push(['Periodo nocturno','La radiación es nula y la humedad relativa del aire tiende a recuperarse.']);
  else insightData.push(['Radiación moderada','La disponibilidad solar se mantiene dentro de un patrón diurno esperado.']);

  insightData.push(['pH estable', `El pH simulado se encuentra en ${d.ph.toFixed(2)}, dentro del rango de referencia configurado.`]);
  $('insights').innerHTML = insightData.map(([t,txt]) => `<div class="insight"><strong>${t}</strong><span>${txt}</span></div>`).join('');
}

function updateTable() {
  const rows = history.slice(-8).reverse().map(d => {
    const status = computeScore(d) >= 82 ? 'Normal' : 'Revisar';
    const time = new Intl.DateTimeFormat('es-CO', { timeZone:'America/Bogota', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }).format(d.time);
    return `<tr><td>${time}</td><td>${d.airTemp.toFixed(1)} °C</td><td>${d.soilTemp.toFixed(1)} °C</td><td>${d.soilMoisture.toFixed(1)}%</td><td>${d.ph.toFixed(2)}</td><td>${d.radiation} W/m²</td><td><span class="table-status">${status}</span></td></tr>`;
  }).join('');
  $('dataTable').innerHTML = rows;
}

function render() {
  const d = history.at(-1);
  updateHero(d); updateMetrics(d); updateCharts(); updateInsights(d); updateTable(); updateMapData(d); formatCaliClock();
}

function tick() {
  const now = caliNow();
  previous = history.at(-1);
  const d = simulateAt(now, previous);
  history.push(d);
  if (history.length > MAX_POINTS) history.shift();
  render();
}

function downloadCSV() {
  const headers = ['timestamp_cali','temp_ambiente_c','temp_suelo_c','humedad_suelo_pct','ph','radiacion_w_m2','humedad_aire_pct'];
  const lines = history.map(d => [
    new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(d.time).replace(' ','T'),
    d.airTemp,d.soilTemp,d.soilMoisture,d.ph,d.radiation,d.airHumidity
  ].join(','));
  const blob = new Blob([[headers.join(','),...lines].join('\n')], { type:'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'agrosense_cali_iot.csv'; a.click(); URL.revokeObjectURL(url);
}

$('pauseBtn').addEventListener('click', () => {
  running = !running;
  $('pauseBtn').textContent = running ? 'Pausar' : 'Reanudar';
  if (running) timer = setInterval(tick, UPDATE_MS); else clearInterval(timer);
});
$('downloadBtn').addEventListener('click', downloadCSV);
document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(btn.dataset.target)?.scrollIntoView({ behavior:'smooth', block:'start' });
}));

$('footerYear').textContent = new Date().getFullYear();
seedHistory(); initIoTMap(); render();
setInterval(formatCaliClock, 1000);
timer = setInterval(tick, UPDATE_MS);
