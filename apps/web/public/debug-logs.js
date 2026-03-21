// Debug utility to view persistent authentication logs
// Run this in the browser console to see logs that survive page reloads

function viewDebugLogs() {
  const logs = JSON.parse(localStorage.getItem('perfana_debug_logs') || '[]');

  if (logs.length === 0) {
    console.log('📭 No debug logs found');
    return;
  }

  console.log(`📊 Found ${logs.length} debug logs:`);
  console.log('=====================================');

  logs.forEach((log, index) => {
    const time = new Date(log.timestamp).toLocaleTimeString();
    console.log(`[${index + 1}] ${time} - ${log.message}`, log.data || '');
  });

  console.log('=====================================');
  console.log('💡 To clear logs: clearDebugLogs()');

  return logs;
}

function clearDebugLogs() {
  localStorage.removeItem('perfana_debug_logs');
  console.log('🧹 Debug logs cleared');
}

function getLatestLogs(count = 10) {
  const logs = JSON.parse(localStorage.getItem('perfana_debug_logs') || '[]');
  return logs.slice(-count);
}

function filterLogs(keyword) {
  const logs = JSON.parse(localStorage.getItem('perfana_debug_logs') || '[]');
  return logs.filter(log =>
    log.message.toLowerCase().includes(keyword.toLowerCase()) ||
    JSON.stringify(log.data).toLowerCase().includes(keyword.toLowerCase())
  );
}

// Auto-expose functions to global scope
window.viewDebugLogs = viewDebugLogs;
window.clearDebugLogs = clearDebugLogs;
window.getLatestLogs = getLatestLogs;
window.filterLogs = filterLogs;

console.log('🔧 Debug utilities loaded:');
console.log('- viewDebugLogs() - View all authentication logs');
console.log('- clearDebugLogs() - Clear stored logs');
console.log('- getLatestLogs(n) - Get last n logs');
console.log('- filterLogs(keyword) - Filter logs by keyword');