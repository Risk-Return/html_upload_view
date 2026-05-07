export function clientIp(request) {
  const xff = request.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    const first = xff.split(',')[0].trim();
    if (first) return first;
  }
  return request.ip || 'unknown';
}
