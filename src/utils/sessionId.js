export const generateSessionId = () => {
  const now = new Date();
  const datetime = now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0') +
      String(now.getSeconds()).padStart(2, '0');
  const randomStr = Math.random().toString(36).substring(2, 8);
  const userAgent = window.navigator.userAgent.split(/[\\(\\)]/)[1]?.split(';')[0] || 'unknown';
  return `${userAgent.replace(/\\s+/g, '_')}_${datetime}_${randomStr}`;
}; 