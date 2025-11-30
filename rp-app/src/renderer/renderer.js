// DOM Elements
const clientIdInput = document.getElementById('clientId');
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const updateBtn = document.getElementById('updateBtn');
const clearBtn = document.getElementById('clearBtn');
const statusDot = document.querySelector('.status-dot');
const statusText = document.querySelector('.status-text');

// Activity fields
const activityType = document.getElementById('activityType');
const details = document.getElementById('details');
const state = document.getElementById('state');
const largeImageKey = document.getElementById('largeImageKey');
const largeImageText = document.getElementById('largeImageText');
const smallImageKey = document.getElementById('smallImageKey');
const smallImageText = document.getElementById('smallImageText');
const useTimestamp = document.getElementById('useTimestamp');
const timestampOptions = document.getElementById('timestampOptions');
const endTimeGroup = document.getElementById('endTimeGroup');
const endTime = document.getElementById('endTime');
const button1Label = document.getElementById('button1Label');
const button1Url = document.getElementById('button1Url');
const button2Label = document.getElementById('button2Label');
const button2Url = document.getElementById('button2Url');

let isConnected = false;

// Status update handler
function updateStatus(status) {
  statusDot.className = 'status-dot';

  switch (status) {
    case 'connected':
    case 'ready':
      statusDot.classList.add('connected');
      statusText.textContent = 'Connected';
      isConnected = true;
      break;
    case 'disconnected':
      statusDot.classList.add('disconnected');
      statusText.textContent = 'Disconnected';
      isConnected = false;
      break;
    case 'error':
      statusDot.classList.add('connecting');
      statusText.textContent = 'Reconnecting...';
      break;
    case 'activity_updated':
      statusText.textContent = 'Connected - Active';
      break;
    case 'activity_cleared':
      statusText.textContent = 'Connected';
      break;
  }

  updateButtonStates();
}

// Update button states based on connection
function updateButtonStates() {
  connectBtn.disabled = isConnected || !clientIdInput.value.trim();
  disconnectBtn.disabled = !isConnected;
  updateBtn.disabled = !isConnected;
  clearBtn.disabled = !isConnected;
}

// Connect to Discord
async function connect() {
  const clientId = clientIdInput.value.trim();
  if (!clientId) {
    alert('Please enter a Discord Application ID');
    return;
  }

  statusDot.className = 'status-dot connecting';
  statusText.textContent = 'Connecting...';
  connectBtn.disabled = true;

  const initResult = await window.discord.init(clientId);
  if (!initResult.success) {
    alert('Failed to initialize: ' + initResult.error);
    updateStatus('disconnected');
    return;
  }

  const connectResult = await window.discord.connect();
  if (!connectResult.success) {
    alert('Failed to connect: ' + connectResult.error);
    updateStatus('disconnected');
  }
}

// Disconnect from Discord
async function disconnect() {
  await window.discord.disconnect();
  updateStatus('disconnected');
}

// Get activity data from form
function getActivityData() {
  const timestampMode = document.querySelector('input[name="timestampMode"]:checked')?.value;

  return {
    type: parseInt(activityType.value),
    details: details.value,
    state: state.value,
    largeImageKey: largeImageKey.value,
    largeImageText: largeImageText.value,
    smallImageKey: smallImageKey.value,
    smallImageText: smallImageText.value,
    useTimestamp: useTimestamp.checked,
    timestampMode: timestampMode,
    endTime: parseInt(endTime.value) || 0,
    button1Label: button1Label.value,
    button1Url: button1Url.value,
    button2Label: button2Label.value,
    button2Url: button2Url.value,
  };
}

// Update presence
async function updatePresence() {
  const activity = getActivityData();
  const result = await window.discord.updateActivity(activity);
  if (!result.success) {
    alert('Failed to update presence: ' + result.error);
  }
}

// Clear presence
async function clearPresence() {
  const result = await window.discord.clearActivity();
  if (!result.success) {
    alert('Failed to clear presence: ' + result.error);
  }
}

// Toggle timestamp options visibility
function toggleTimestampOptions() {
  timestampOptions.style.display = useTimestamp.checked ? 'block' : 'none';
  updateEndTimeVisibility();
}

// Toggle end time visibility based on timestamp mode
function updateEndTimeVisibility() {
  const timestampMode = document.querySelector('input[name="timestampMode"]:checked')?.value;
  endTimeGroup.style.display = (useTimestamp.checked && timestampMode === 'remaining') ? 'block' : 'none';
}

// Event listeners
connectBtn.addEventListener('click', connect);
disconnectBtn.addEventListener('click', disconnect);
updateBtn.addEventListener('click', updatePresence);
clearBtn.addEventListener('click', clearPresence);
clientIdInput.addEventListener('input', updateButtonStates);
useTimestamp.addEventListener('change', toggleTimestampOptions);

document.querySelectorAll('input[name="timestampMode"]').forEach(radio => {
  radio.addEventListener('change', updateEndTimeVisibility);
});

// Listen for status updates from main process
window.discord.onStatus(updateStatus);

// Initial button state
updateButtonStates();
